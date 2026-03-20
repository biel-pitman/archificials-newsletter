/**
 * Content Generator Worker
 *
 * Cloudflare Worker triggered via HTTP POST after research is reviewed.
 * For each vertical with approved topics:
 *   1. Fetches approved research from Airtable
 *   2. Selects topics (approved picks or top-ranked defaults)
 *   3. Calls Claude API to generate newsletter draft
 *   4. Calls Claude API to generate blog expansion
 *   5. Stores drafts in Airtable and R2
 *   6. Emails Biel the draft for review
 *
 * Routes:
 *   POST /generate           - Generate drafts for all active verticals
 *   POST /generate/:vertical - Generate draft for a single vertical
 *   GET  /health             - Health check
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY, AIRTABLE_API_KEY, RESEND_API_KEY
 *
 * Required bindings:
 *   NEWSLETTER_BUCKET (R2 bucket)
 */

import { getActiveVerticals, getVertical, AIRTABLE } from '../../shared/config';
import { createRecord, queryRecords, updateRecord } from '../../shared/airtable';
import { draftReviewEmail, sendEmail } from '../../shared/email-templates';
import { buildDraftingPrompt, buildBlogExpansionPrompt } from './prompts';

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
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude returned non-JSON: ${text.slice(0, 300)}`);

  return JSON.parse(jsonMatch[0]);
}

// ─── TOPIC SELECTION ───

/**
 * Select topics from research findings.
 * If Biel provided selections, use those. Otherwise, use top-ranked defaults.
 *
 * @param {Array} findings - Research findings from Airtable
 * @param {Array|null} selections - Biel's manual picks (indices), or null for defaults
 * @returns {object} { anchor, radar: [], quickWin }
 */
function selectTopics(findings, selections = null) {
  // Sort by relevance
  const sorted = [...findings].sort((a, b) => b.relevance - a.relevance);

  if (selections && selections.length > 0) {
    // Manual selection by index
    const selected = selections.map(i => findings[i]).filter(Boolean);
    return categorizeTopics(selected.length > 0 ? selected : sorted);
  }

  return categorizeTopics(sorted);
}

function categorizeTopics(sortedFindings) {
  // Find best anchor candidate
  const anchorCandidates = sortedFindings.filter(f => f.section === 'anchor');
  const anchor = anchorCandidates[0] || sortedFindings[0];

  // Find radar candidates (exclude anchor)
  const radarCandidates = sortedFindings
    .filter(f => f !== anchor && (f.section === 'radar' || f.section === 'anchor'))
    .slice(0, 2);

  // Find quick win candidate
  const quickWinCandidates = sortedFindings.filter(f => f.section === 'quickWin' && f !== anchor);
  const quickWin = quickWinCandidates[0] || sortedFindings.find(f => f !== anchor && !radarCandidates.includes(f)) || sortedFindings[sortedFindings.length - 1];

  return { anchor, radar: radarCandidates, quickWin };
}

// ─── GET PREVIOUS EDITION ───

async function getPreviousEdition(vertical, apiKey) {
  try {
    const records = await queryRecords(
      AIRTABLE.tables.drafts,
      {
        filterByFormula: `AND({vertical} = "${vertical.slug}", {status} != "failed")`,
        sort: [{ field: 'created', direction: 'desc' }],
        maxRecords: 1
      },
      apiKey
    );

    if (records.length > 0 && records[0].fields.newsletter_json) {
      return JSON.parse(records[0].fields.newsletter_json);
    }
    return null;
  } catch (e) {
    console.error('Failed to fetch previous edition:', e.message);
    return null;
  }
}

// ─── GENERATE FOR ONE VERTICAL ───

async function generateForVertical(vertical, env, options = {}) {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const year = now.getFullYear();
  const day = now.getDate();
  const edition = options.edition || (day <= 15 ? 1 : 2);

  console.log(`Generating content: ${vertical.name}, Edition ${edition}`);

  // Step 1: Fetch latest research from Airtable
  const researchRecords = await queryRecords(
    AIRTABLE.tables.research,
    {
      filterByFormula: `AND({vertical} = "${vertical.slug}", {status} = "generated")`,
      sort: [{ field: 'created', direction: 'desc' }],
      maxRecords: 1
    },
    env.AIRTABLE_API_KEY
  );

  if (researchRecords.length === 0) {
    throw new Error(`No research found for ${vertical.slug}. Run research-engine first.`);
  }

  const research = researchRecords[0];
  const findings = JSON.parse(research.fields.findings_json);

  // Step 2: Select topics
  const topics = selectTopics(findings, options.selections || null);
  console.log(`  Anchor: ${topics.anchor.headline}`);
  console.log(`  Radar: ${topics.radar.map(r => r.headline).join(', ')}`);
  console.log(`  Quick Win: ${topics.quickWin.headline}`);

  // Step 3: Get previous edition for continuity
  const previousEdition = await getPreviousEdition(vertical, env.AIRTABLE_API_KEY);

  // Step 4: Generate newsletter draft
  const draftPrompt = buildDraftingPrompt(
    vertical, topics, edition, month, year, previousEdition
  );
  const draft = await callClaude(draftPrompt, env.ANTHROPIC_API_KEY);
  console.log(`  Newsletter draft generated: "${draft.subject_line}"`);

  // Step 5: Generate blog expansion
  const blogPrompt = buildBlogExpansionPrompt(vertical, draft.anchor, month, year);
  const blogPost = await callClaude(blogPrompt, env.ANTHROPIC_API_KEY);
  console.log(`  Blog expansion generated: "${blogPost.seo_title}" (${blogPost.word_count} words)`);

  // Step 6: Store in Airtable
  const draftRecord = await createRecord(
    AIRTABLE.tables.drafts,
    {
      vertical: vertical.slug,
      edition_number: edition,
      month: `${month} ${year}`,
      subject_line: draft.subject_line,
      newsletter_json: JSON.stringify(draft),
      blog_json: JSON.stringify(blogPost),
      research_record_id: research.id,
      status: 'drafted',
      created: now.toISOString()
    },
    env.AIRTABLE_API_KEY
  );

  // Mark research as consumed
  await updateRecord(
    AIRTABLE.tables.research,
    research.id,
    { status: 'consumed' },
    env.AIRTABLE_API_KEY
  );

  // Step 7: Store in R2
  const r2Key = `newsletter/${vertical.slug}/${year}-${String(now.getMonth() + 1).padStart(2, '0')}/edition-${edition}/draft.json`;
  await env.NEWSLETTER_BUCKET.put(r2Key, JSON.stringify({
    vertical: vertical.slug,
    edition, month, year,
    newsletter: draft,
    blog: blogPost,
    topics,
    airtableRecordId: draftRecord.id,
    generatedAt: now.toISOString()
  }));

  // Step 8: Email Biel the draft
  const emailData = draftReviewEmail({
    vertical, edition, month, year, draft
  });
  await sendEmail(emailData, env.RESEND_API_KEY);

  return {
    vertical: vertical.name,
    edition,
    subject_line: draft.subject_line,
    blog_title: blogPost.seo_title,
    airtableRecordId: draftRecord.id
  };
}

// ─── WORKER EXPORT ───

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'content-generator' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate for all active verticals
    if (request.method === 'POST' && url.pathname === '/generate') {
      try {
        const body = request.headers.get('content-type')?.includes('json')
          ? await request.json()
          : {};

        const verticals = getActiveVerticals();
        const results = [];

        for (const vertical of verticals) {
          try {
            const result = await generateForVertical(vertical, env, {
              edition: body.edition || undefined,
              selections: body.selections?.[vertical.slug] || null
            });
            results.push(result);
          } catch (err) {
            console.error(`Failed for ${vertical.name}: ${err.message}`);
            results.push({ vertical: vertical.name, error: err.message });
          }
        }

        return new Response(JSON.stringify({ success: true, results }, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Generate for a single vertical
    if (request.method === 'POST' && url.pathname.startsWith('/generate/')) {
      const slug = url.pathname.split('/generate/')[1];
      const vertical = getVertical(slug);

      if (!vertical) {
        return new Response(JSON.stringify({ error: `Unknown vertical: ${slug}` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        const body = request.headers.get('content-type')?.includes('json')
          ? await request.json()
          : {};

        const result = await generateForVertical(vertical, env, {
          edition: body.edition || undefined,
          selections: body.selections || null
        });

        return new Response(JSON.stringify({ success: true, result }, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};
