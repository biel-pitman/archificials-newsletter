/**
 * Research Engine Worker
 *
 * Cloudflare Worker that runs on a cron schedule (1st and 10th of each month).
 * For each active vertical:
 *   1. Calls Gemini with Google Search grounding for deep, cited research
 *   2. Structures the grounded findings via Claude (or Gemini without grounding)
 *   3. Stores findings in Supabase
 *   4. Stores raw JSON in R2
 *   5. Emails Biel a research digest via Resend
 *
 * Fallback: If Gemini grounding fails, falls back to Brave Search + LLM analysis.
 *
 * Also exposes POST /trigger for manual runs.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY, GEMINI_API_KEY, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 *
 * Optional env vars:
 *   BRAVE_API_KEY (fallback only)
 *
 * Required bindings:
 *   NEWSLETTER_BUCKET (R2 bucket)
 */

import { getActiveVerticals, getVertical, BRAND, SUPABASE } from '../../shared/config';
import { createRecord, queryRecords } from '../../shared/supabase';

// Use SUPABASE.tables for table name references (same keys as old AIRTABLE.tables)
const AIRTABLE = SUPABASE;
import { researchDigestEmail, sendEmail } from '../../shared/email-templates';
import { buildResearchPrompt, buildSearchQueries, buildGroundingPrompt, buildStructuringPrompt } from './prompts';
import { lintContentDeep, buildRewritePrompt } from '../../shared/style-lint';

// ─── GEMINI WITH GOOGLE SEARCH GROUNDING ───

/**
 * Call Gemini with Google Search grounding enabled.
 * The model searches the web itself and returns text with citation metadata.
 *
 * Returns: { text, groundingChunks, groundingSupports, searchQueries }
 */
async function callGeminiGrounded(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 8192 }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini grounding failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('Gemini returned no candidates');

  const text = candidate.content?.parts?.[0]?.text || '';
  const meta = candidate.groundingMetadata || {};

  return {
    text,
    groundingChunks: meta.groundingChunks || [],
    groundingSupports: meta.groundingSupports || [],
    searchQueries: meta.webSearchQueries || []
  };
}

// ─── BRAVE SEARCH (FALLBACK) ───

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

// ─── LLM CALLS (for structuring step) ───

async function callClaude(prompt, env, { maxTokens = 4096, jsonPattern = /\[[\s\S]*\]/, retries = 3 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (res.status === 529 || res.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`Claude API returned ${res.status}, retrying in ${wait}ms (attempt ${attempt}/${retries})`);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        lastError = new Error(`Claude API overloaded after ${retries} attempts`);
        break;
      }

      if (!res.ok) {
        const err = await res.text();
        lastError = new Error(`Claude API failed (${res.status}): ${err}`);
        break;
      }

      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      const jsonMatch = text.match(jsonPattern);
      if (!jsonMatch) throw new Error(`Claude returned non-JSON: ${text.slice(0, 300)}`);
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      lastError = err;
      break;
    }
  }
  throw lastError;
}

async function callGeminiPlain(prompt, apiKey, jsonPattern = /\[[\s\S]*\]/) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192 }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = text.match(jsonPattern);
  if (!jsonMatch) throw new Error(`Gemini returned non-JSON: ${text.slice(0, 300)}`);
  return JSON.parse(jsonMatch[0]);
}

/**
 * Structure grounded text into JSON findings.
 * Tries Claude first, falls back to Gemini (without grounding).
 */
async function structureFindings(prompt, env) {
  try {
    return await callClaude(prompt, env, { maxTokens: 4096, jsonPattern: /\[[\s\S]*\]/ });
  } catch (claudeErr) {
    console.warn(`Claude structuring failed: ${claudeErr.message}. Trying Gemini.`);
    if (env.GEMINI_API_KEY) {
      return await callGeminiPlain(prompt, env.GEMINI_API_KEY, /\[[\s\S]*\]/);
    }
    throw claudeErr;
  }
}

// ─── POST-PROCESSING: EM DASHES ───
//
// Banned words are NOT deleted here: blind regex deletion mangles grammar
// ("The landscape there is" becomes "The there is"). The lint + rewrite
// loop fixes them grammatically; survivors get flagged.

function cleanAISlop(obj) {
  let json = JSON.stringify(obj);
  json = json.replace(/\u2014/g, ', ').replace(/\u2013/g, ', ');
  json = json.replace(/,\s*,/g, ',');
  return JSON.parse(json);
}

// ─── STYLE ENFORCEMENT: LINT + FORCED REWRITE ───

/**
 * Lint findings. If violations are found, force a rewrite (up to maxPasses),
 * re-linting after each pass. Survivors are logged; the digest email content
 * will have been through at least one corrective pass.
 */
async function enforceFindingsStyle(findings, env, maxPasses = 2) {
  let result = await lintContentDeep(findings, env);
  let passes = 0;

  while (!result.clean && passes < maxPasses) {
    passes++;
    console.log(`  Style lint (findings): ${result.violations.length} violation(s), rewrite pass ${passes}`);
    result.violations.slice(0, 5).forEach(v => console.log(`    [${v.rule}] ${v.excerpt.slice(0, 90)}`));

    try {
      const rewritePrompt = buildRewritePrompt(findings, result.violations);
      const rewritten = await structureFindings(rewritePrompt, env);
      findings = cleanAISlop(rewritten);
    } catch (err) {
      console.error(`  Style rewrite failed (findings, pass ${passes}): ${err.message}`);
      break;
    }

    result = await lintContentDeep(findings, env);
  }

  if (!result.clean) {
    console.warn(`  Style lint (findings): ${result.violations.length} violation(s) SURVIVED ${passes} rewrite pass(es)`);
  }

  return findings;
}

// ─── GET PREVIOUS TOPICS ───

async function getPreviousTopics(vertical, apiKey) {
  try {
    const records = await queryRecords(
      AIRTABLE.tables.research,
      {
        filter: { vertical: `eq.${vertical.slug}` },
        sort: [{ field: 'created_at', direction: 'desc' }],
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

// ─── GROUNDED RESEARCH (PRIMARY PATH) ───

/**
 * Run deep research for one vertical using Gemini + Google Search grounding.
 *
 * Step 1: Gemini reads the web and produces a grounded report with citations.
 * Step 2: Claude (or Gemini) structures the report into the JSON format the pipeline expects.
 */
async function groundedResearch(vertical, previousTopics, env) {
  console.log(`  Using Gemini grounded research for ${vertical.name}`);

  // Step 1: Grounded research call
  const groundingPrompt = buildGroundingPrompt(vertical, previousTopics);
  const grounded = await callGeminiGrounded(groundingPrompt, env.GEMINI_API_KEY);

  console.log(`  Grounding returned ${grounded.groundingChunks.length} source chunks, ${grounded.searchQueries.length} queries`);

  // Extract citation map: index -> { url, title }
  const citations = grounded.groundingChunks.map(chunk => ({
    url: chunk.web?.uri || '',
    title: chunk.web?.title || '',
    domain: chunk.web?.domain || ''
  }));

  // Step 2: Structure the grounded text + citations into JSON findings
  const structuringPrompt = buildStructuringPrompt(
    vertical,
    grounded.text,
    citations,
    grounded.groundingSupports,
    previousTopics
  );

  let findings = await structureFindings(structuringPrompt, env);
  findings = cleanAISlop(findings);
  findings = await enforceFindingsStyle(findings, env);

  return {
    findings,
    meta: {
      method: 'gemini-grounded',
      searchQueries: grounded.searchQueries,
      citationCount: citations.length,
      rawText: grounded.text
    }
  };
}

// ─── BRAVE FALLBACK RESEARCH ───

async function braveResearch(vertical, previousTopics, env) {
  console.log(`  Falling back to Brave Search for ${vertical.name}`);
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const year = now.getFullYear();

  const queries = buildSearchQueries(vertical, month, year);
  const searchResultSets = [];
  for (const q of queries) {
    const results = await braveSearch(q, env.BRAVE_API_KEY);
    searchResultSets.push(results);
  }
  const allResults = searchResultSets.flat();

  const seen = new Set();
  const uniqueResults = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`  ${uniqueResults.length} unique results from ${queries.length} queries`);

  const prompt = buildResearchPrompt(vertical, uniqueResults, previousTopics);
  let findings;
  try {
    findings = await callClaude(prompt, env, { maxTokens: 4096, jsonPattern: /\[[\s\S]*\]/ });
  } catch (claudeErr) {
    if (env.GEMINI_API_KEY) {
      console.warn(`Claude failed: ${claudeErr.message}. Trying Gemini.`);
      findings = await callGeminiPlain(prompt, env.GEMINI_API_KEY, /\[[\s\S]*\]/);
    } else {
      throw claudeErr;
    }
  }
  findings = cleanAISlop(findings);
  findings = await enforceFindingsStyle(findings, env);

  return {
    findings,
    meta: {
      method: 'brave-fallback',
      queries,
      rawResultCount: allResults.length,
      uniqueResultCount: uniqueResults.length
    }
  };
}

// ─── ENQUEUE RUN (replaces runResearchPipeline) ───

/**
 * Enqueue one message per active vertical into the research queue.
 * Returns immediately — each vertical is processed in its own Worker invocation
 * via the queue consumer below, avoiding waitUntil() time limits on fetch handlers.
 */
async function enqueueRun(env) {
  const verticals = getActiveVerticals();
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const year = now.getFullYear();
  const edition = now.getDate() <= 15 ? 1 : 2;
  const runId = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-e${edition}-${Date.now()}`;

  // Store run state in KV so the last consumer to finish can send the digest email
  await env.RESEARCH_STATE.put(runId, JSON.stringify({
    total: verticals.length,
    completed: 0,
    results: [],
    month, year, edition,
    startedAt: now.toISOString()
  }), { expirationTtl: 3600 });

  for (const vertical of verticals) {
    await env.RESEARCH_QUEUE.send({ runId, verticalSlug: vertical.slug, month, year, edition });
  }

  console.log(`Research pipeline starting: ${month} ${year}, Edition ${edition} (runId: ${runId})`);
  return runId;
}

// ─── PER-VERTICAL PROCESSING (called by queue consumer) ───

async function processVertical(verticalSlug, month, year, edition, env) {
  const vertical = getVertical(verticalSlug);
  console.log(`Researching: ${vertical.name}`);

  const previousTopics = await getPreviousTopics(vertical, env.SUPABASE_SERVICE_KEY);

  let result;
  try {
    if (!env.GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY set');
    result = await groundedResearch(vertical, previousTopics, env);
  } catch (groundErr) {
    console.warn(`  Grounded research failed: ${groundErr.message}`);
    if (env.BRAVE_API_KEY) {
      result = await braveResearch(vertical, previousTopics, env);
    } else {
      throw new Error(`Both grounded and Brave research failed. Grounding: ${groundErr.message}`);
    }
  }

  const { findings, meta } = result;
  console.log(`  ${findings.length} findings generated via ${meta.method}`);

  const now = new Date();
  let airtableRecordId = null;

  try {
    const airtableRecord = await createRecord(
      AIRTABLE.tables.research,
      {
        vertical: vertical.slug,
        month: `${month} ${year}`,
        edition_number: edition,
        findings_json: JSON.stringify(findings),
        findings_count: findings.length,
        status: 'generated',
        created_at: now.toISOString()
      },
      env.SUPABASE_SERVICE_KEY
    );
    airtableRecordId = airtableRecord.id;
    console.log(`  Supabase record: ${airtableRecordId}`);
  } catch (dbErr) {
    console.error(`  Supabase write failed for ${vertical.name}: ${dbErr.message}`);
  }

  try {
    const r2Key = `newsletter/${vertical.slug}/${year}-${String(now.getMonth() + 1).padStart(2, '0')}/edition-${edition}/research.json`;
    await env.NEWSLETTER_BUCKET.put(r2Key, JSON.stringify({
      vertical: vertical.slug,
      month, year, edition,
      meta,
      findings,
      airtableRecordId,
      generatedAt: now.toISOString()
    }));
    console.log(`  R2 stored: ${r2Key}`);
  } catch (r2Err) {
    console.error(`  R2 write failed for ${vertical.name}: ${r2Err.message}`);
  }

  return { vertical, findings, airtableRecordId };
}

// ─── RUN STATE + DIGEST EMAIL (aggregator) ───

/**
 * After each vertical finishes, update KV state.
 * When all verticals are done, send the digest email.
 */
async function updateRunState(runId, result, env) {
  const raw = await env.RESEARCH_STATE.get(runId);
  if (!raw) {
    console.error(`Run state missing for runId: ${runId}`);
    return;
  }

  const state = JSON.parse(raw);
  state.completed += 1;
  state.results.push({
    slug: result.vertical.slug,
    name: result.vertical.name,
    findings: result.findings,
    airtableRecordId: result.airtableRecordId || null,
    error: result.error || null
  });

  await env.RESEARCH_STATE.put(runId, JSON.stringify(state), { expirationTtl: 3600 });

  if (state.completed < state.total) {
    console.log(`Run ${runId}: ${state.completed}/${state.total} verticals complete`);
    return;
  }

  // All verticals done — send digest email
  console.log(`Run ${runId}: all verticals complete, sending digest`);
  const { month, year, edition } = state;

  const verticalResults = state.results.map(r => ({
    vertical: getVertical(r.slug),
    findings: r.findings,
    airtableRecordId: r.airtableRecordId
  }));

  try {
    const contentBase = 'https://newsletter-content-generator.law-firm-ai-scorer.workers.dev';
    const approveToken = await generateHmac('approve:defaults', env.ANTHROPIC_API_KEY);
    const approveUrl = `${contentBase}/approve?selections=defaults&token=${approveToken}`;

    const successfulVerticals = verticalResults.filter(v => v.findings.length > 0);
    const selectionLinks = {};

    for (const v of successfulVerticals) {
      const slug = v.vertical.slug;
      const topIndices = v.findings
        .map((f, i) => ({ i, relevance: f.relevance }))
        .sort((a, b) => b.relevance - a.relevance)
        .map(x => x.i);

      const combos = [];
      for (let i = 0; i < Math.min(topIndices.length, 6); i++) {
        const idx = topIndices[i];
        const selectionsStr = `${slug}:${idx}`;
        const token = await generateHmac(`approve:${selectionsStr}`, env.ANTHROPIC_API_KEY);
        combos.push({
          index: idx,
          headline: v.findings[idx].headline,
          url: `${contentBase}/approve?selections=${encodeURIComponent(selectionsStr)}&token=${token}`
        });
      }
      selectionLinks[slug] = combos;
    }

    const emailData = researchDigestEmail({
      month, year, edition,
      verticalResults: successfulVerticals,
      approveUrl,
      selectionLinks
    });
    await sendEmail(emailData, env.RESEND_API_KEY);
    console.log('Research digest email sent');
  } catch (err) {
    console.error(`Email send failed: ${err.message}`);
  }
}

// ─── HMAC UTILS ───

async function generateHmac(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── WORKER EXPORT ───

export default {
  // Cron trigger: 14th and 28th of each month at 8am UTC
  async scheduled(event, env, ctx) {
    ctx.waitUntil(enqueueRun(env));
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
      const runId = await enqueueRun(env);
      return new Response(JSON.stringify({
        status: 'accepted',
        runId,
        message: 'Research pipeline started. Digest email will arrive when the run completes.'
      }, null, 2), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  },

  // Queue consumer: processes one vertical per invocation
  async queue(batch, env) {
    for (const message of batch.messages) {
      const { runId, verticalSlug, month, year, edition } = message.body;
      let findingResult;

      try {
        findingResult = await processVertical(verticalSlug, month, year, edition, env);
      } catch (err) {
        console.error(`FAILED ${verticalSlug}: ${err.message}`);
        const { getVertical } = require('../../shared/config');
        findingResult = { vertical: getVertical(verticalSlug), findings: [], error: err.message };
      }

      // Always ack so failed verticals don't block the queue forever
      message.ack();
      await updateRunState(runId, findingResult, env);
    }
  },
};
