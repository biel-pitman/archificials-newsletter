/**
 * Research Engine Worker
 *
 * Cloudflare Worker that runs on a cron schedule (1st and 10th of each month).
 * For each active vertical:
 *   1. Runs 5 Brave Search queries
 *   2. Sends results to Claude API for structured analysis
 *   3. Stores findings in Airtable
 *   4. Stores raw JSON in R2
 *   5. Emails Biel a research digest via Resend
 *
 * Also exposes POST /trigger for manual runs.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY, BRAVE_API_KEY, AIRTABLE_API_KEY, RESEND_API_KEY
 *
 * Required bindings:
 *   NEWSLETTER_BUCKET (R2 bucket)
 */

import { getActiveVerticals, AIRTABLE } from '../../shared/config';
import { createRecord, queryRecords } from '../../shared/airtable';
import { researchDigestEmail, sendEmail } from '../../shared/email-templates';
import { buildResearchPrompt, buildSearchQueries } from './prompts';

// ─── BRAVE SEARCH ───

async function braveSearch(query, apiKey, count = 10) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey }
  });

  if (!res.ok) {
    console.error(`Brave search failed for "${query}": ${res.status}`);
    return [];
  }

  const data = await res.json();
  return (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description,
    age: r.age || null
  }));
}

// ─── CLAUDE API ───

async function callClaude(prompt, apiKey, model = 'claude-sonnet-4-20250514') {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  // Parse JSON from response (handle markdown code blocks if present)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Claude returned non-JSON: ${text.slice(0, 200)}`);

  return JSON.parse(jsonMatch[0]);
}

// ─── GET PREVIOUS TOPICS ───

async function getPreviousTopics(vertical, apiKey) {
  try {
    const records = await queryRecords(
      AIRTABLE.tables.research,
      {
        filterByFormula: `{vertical} = "${vertical.slug}"`,
        sort: [{ field: 'created', direction: 'desc' }],
        maxRecords: 2
      },
      apiKey
    );

    const topics = [];
    for (const rec of records) {
      try {
        const findings = JSON.parse(rec.fields.findings_json || '[]');
        findings.forEach(f => topics.push(f.headline));
      } catch (e) { /* skip malformed */ }
    }
    return topics;
  } catch (e) {
    console.error('Failed to fetch previous topics:', e.message);
    return [];
  }
}

// ─── MAIN RESEARCH PIPELINE ───

async function runResearchPipeline(env) {
  const verticals = getActiveVerticals();
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const year = now.getFullYear();
  const day = now.getDate();
  const edition = day <= 15 ? 1 : 2;

  console.log(`Research pipeline starting: ${month} ${year}, Edition ${edition}`);

  const verticalResults = [];

  for (const vertical of verticals) {
    console.log(`Researching: ${vertical.name}`);

    try {
      // Step 1: Run 5 Brave Search queries
      const queries = buildSearchQueries(vertical, month, year);
      const searchPromises = queries.map(q => braveSearch(q, env.BRAVE_API_KEY));
      const searchResultSets = await Promise.all(searchPromises);
      const allResults = searchResultSets.flat();

      // Deduplicate by URL
      const seen = new Set();
      const uniqueResults = allResults.filter(r => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      });

      console.log(`  ${uniqueResults.length} unique results from ${queries.length} queries`);

      // Step 2: Get previous topics to avoid repeats
      const previousTopics = await getPreviousTopics(vertical, env.AIRTABLE_API_KEY);

      // Step 3: Call Claude for structured analysis
      const prompt = buildResearchPrompt(vertical, uniqueResults, previousTopics);
      const findings = await callClaude(prompt, env.ANTHROPIC_API_KEY);

      console.log(`  ${findings.length} findings generated`);

      // Step 4: Store in Airtable
      const airtableRecord = await createRecord(
        AIRTABLE.tables.research,
        {
          vertical: vertical.slug,
          month: `${month} ${year}`,
          edition_number: edition,
          findings_json: JSON.stringify(findings),
          findings_count: findings.length,
          status: 'generated',
          created: now.toISOString()
        },
        env.AIRTABLE_API_KEY
      );

      console.log(`  Airtable record: ${airtableRecord.id}`);

      // Step 5: Store raw JSON in R2
      const r2Key = `newsletter/${vertical.slug}/${year}-${String(now.getMonth() + 1).padStart(2, '0')}/edition-${edition}/research.json`;
      await env.NEWSLETTER_BUCKET.put(r2Key, JSON.stringify({
        vertical: vertical.slug,
        month, year, edition,
        queries,
        rawResultCount: allResults.length,
        uniqueResultCount: uniqueResults.length,
        findings,
        airtableRecordId: airtableRecord.id,
        generatedAt: now.toISOString()
      }));

      console.log(`  R2 stored: ${r2Key}`);

      verticalResults.push({ vertical, findings, airtableRecordId: airtableRecord.id });

    } catch (err) {
      console.error(`  FAILED for ${vertical.name}: ${err.message}`);
      verticalResults.push({ vertical, findings: [], error: err.message });
    }
  }

  // Step 6: Send digest email to Biel
  try {
    const emailData = researchDigestEmail({
      month, year, edition,
      verticalResults: verticalResults.filter(v => v.findings.length > 0)
    });
    await sendEmail(emailData, env.RESEND_API_KEY);
    console.log('Research digest email sent');
  } catch (err) {
    console.error(`Email send failed: ${err.message}`);
  }

  return {
    success: true,
    month, year, edition,
    verticals: verticalResults.map(v => ({
      name: v.vertical.name,
      findings: v.findings.length,
      error: v.error || null
    }))
  };
}

// ─── WORKER EXPORT ───

export default {
  // Cron trigger: 1st and 10th of each month at 8am UTC (2am CT)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runResearchPipeline(env));
  },

  // HTTP trigger for manual runs and health checks
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'research-engine' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (request.method === 'POST' && url.pathname === '/trigger') {
      // Optional: add HMAC validation here for production
      const result = await runResearchPipeline(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
