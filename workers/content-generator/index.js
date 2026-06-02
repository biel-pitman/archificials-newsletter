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
 *   ANTHROPIC_API_KEY, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 *
 * Required bindings:
 *   NEWSLETTER_BUCKET (R2 bucket)
 */

import { getActiveVerticals, getVertical, SUPABASE, WEBFLOW, BRAND } from '../../shared/config';
import { createRecord, queryRecords, updateRecord } from '../../shared/supabase';

// Use SUPABASE.tables for table name references (same keys as old AIRTABLE.tables)
const AIRTABLE = SUPABASE;
import { draftReviewEmail, sendEmail } from '../../shared/email-templates';
import { buildDraftingPrompt, buildBlogExpansionPrompt } from './prompts';

// ─── WEBFLOW CMS ───

async function createWebflowBlogDraft(blogPost, vertical, env) {
  const wordCount = blogPost.word_count || 800;
  const readingTime = `${Math.ceil(wordCount / 200)} Min Read`;

  // Map FAQ fields to Webflow CMS slugs (note inconsistent naming)
  const faqFieldData = {};
  if (blogPost.faq && blogPost.faq.length >= 5) {
    for (let i = 0; i < 5; i++) {
      const qNum = i + 1;
      faqFieldData[`question-${qNum}`] = blogPost.faq[i].question;
      faqFieldData[`answer-${qNum}`] = blogPost.faq[i].answer;
      // Snippets: snippet1, snippet2 (no dash), snippet-3, snippet-4, snippet-5 (with dash)
      const snippetSlug = qNum <= 2 ? `snippet${qNum}` : `snippet-${qNum}`;
      faqFieldData[snippetSlug] = blogPost.faq[i].snippet;
    }
  }

  const res = await fetch(`${WEBFLOW.apiBase}/collections/${WEBFLOW.blogCollectionId}/items`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.WEBFLOW_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      isArchived: false,
      isDraft: true,
      fieldData: {
        name: blogPost.seo_title,
        slug: blogPost.slug,
        'blog---body-content': blogPost.html_body,
        'blog---short-description': blogPost.meta_description || '',
        'blog---category': vertical.blogCategory,
        'blog-post---author': BRAND.founder,
        'blog---author-subtitle': `${BRAND.founderTitle}, ${BRAND.name}`,
        'blog---reading-time': readingTime,
        ...faqFieldData
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Webflow CMS create failed (${res.status}): ${err}`);
    return null;
  }

  const item = await res.json();
  const blogUrl = `${WEBFLOW.blogBaseUrl}/${blogPost.slug}`;
  return { itemId: item.id, blogUrl, slug: blogPost.slug };
}

// ─── BEEHIIV API ───

async function createBeehiivDraft(draft, vertical, env) {
  const pubId = vertical.beehiivPubId;
  if (!pubId) {
    console.log(`  No Beehiiv publication ID for ${vertical.slug}, skipping`);
    return null;
  }

  const htmlContent = buildBeehiivHtml(draft, vertical);

  const res = await fetch(`https://api.beehiiv.com/v2/publications/${pubId}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.BEEHIIV_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: draft.subject_line,
      subtitle: draft.preview_text || '',
      status: 'draft',
      content: [{ type: 'html', html: htmlContent }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    // Beehiiv Posts API requires Enterprise plan
    if (res.status === 403) {
      console.log(`  Beehiiv API requires Enterprise plan, skipping auto-draft for ${vertical.slug}`);
    } else {
      console.error(`Beehiiv draft create failed (${res.status}): ${errText}`);
    }
    return null;
  }

  const post = await res.json();
  const postData = post.data || post;
  return {
    postId: postData.id,
    webUrl: postData.web_url || null,
    previewUrl: postData.thumbnail_url || null
  };
}

function buildBeehiivHtml(draft, vertical) {
  const radarHtml = (draft.radar || []).map(r =>
    `<p><strong>${r.headline}</strong> ${r.body}${r.source_url ? ` <a href="${r.source_url}">Source</a>` : ''}</p>`
  ).join('');

  const assessmentBlock = draft.close.assessment_cta && draft.close.assessment_url
    ? `<p style="text-align:center;"><a href="${draft.close.assessment_url}" style="background:#e27308;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:bold;">${draft.close.assessment_cta}</a></p>`
    : '';

  const contactBlock = draft.close.contact_cta && draft.close.contact_url
    ? `<p style="text-align:center;"><a href="${draft.close.contact_url}">${draft.close.contact_cta}</a></p>`
    : '';

  return `
    <h2>${draft.anchor.title}</h2>
    ${draft.anchor.full.split('\n').map(p => p.trim() ? `<p>${p}</p>` : '').join('')}
    ${draft.anchor.blog_cta && draft.anchor.blog_url ? `<p><a href="${draft.anchor.blog_url}">${draft.anchor.blog_cta}</a></p>` : ''}

    <hr>
    <h2>The Radar</h2>
    ${radarHtml}

    <hr>
    <h2>The Quick Win: ${draft.quick_win.tool_name}</h2>
    <p>${draft.quick_win.body}</p>

    <hr>
    <p>${draft.close.personal_note}</p>
    <p><em>${draft.close.reply_prompt}</em></p>
    ${assessmentBlock}
    ${contactBlock}
  `;
}

// ─── CLAUDE API ───

async function callGemini(prompt, apiKey, jsonPattern) {
  console.log('  Falling back to Gemini 2.5 Pro');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
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
  if (!jsonMatch) throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

async function callLLM(prompt, env, { maxTokens = 8192, jsonPattern = /\{[\s\S]*\}/, retries = 3 } = {}) {
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

  if (env.GEMINI_API_KEY) {
    console.warn(`Claude failed: ${lastError.message}. Trying Gemini fallback.`);
    return callGemini(prompt, env.GEMINI_API_KEY, jsonPattern);
  }

  throw lastError;
}

// ─── POST-PROCESSING: EM DASHES + BANNED WORDS ───

const BANNED_WORDS_REGEX = new RegExp(
  '\\b(' + [
    // Verbs
    'delves?', 'delving', 'leverag(?:es?|ing|ed)', 'fosters?', 'fostering',
    'unleash(?:es|ing|ed)?', 'underscores?', 'underscoring',
    'optimiz(?:es?|ing|ed)', 'streamlin(?:es?|ing|ed)',
    'harness(?:es|ing|ed)?', 'empowers?', 'empowering',
    'unlocks?', 'unlocking', 'elevat(?:es?|ing|ed)',
    'demystif(?:y|ies|ying|ied)', 'embarks?', 'embarking',
    'navigat(?:es?|ing|ed)', 'elucidat(?:es?|ing|ed)',
    'unravel(?:s|ing|ed)?', 'showcas(?:es?|ing|ed)',
    'exemplif(?:y|ies|ying|ied)', 'propel(?:s|ling|led)?',
    'supercharg(?:es?|ing|ed)',
    // Nouns
    'tapestry', 'tapestries', 'landscape(?:s)?', 'realm(?:s)?',
    'beacon(?:s)?', 'cornerstone(?:s)?', 'testament',
    'paradigm(?:s)?', 'metamorphos(?:is|es)', 'plethora',
    'myriad', 'nuance(?:s|d)?', 'ecosystem(?:s)?',
    'labyrinth(?:s)?', 'embodiment', 'trajectory', 'trajectories',
    // Adjectives
    'cutting-edge', 'seamless(?:ly)?', 'robust(?:ly)?',
    'multifaceted', 'pivotal(?:ly)?', 'innovative(?:ly)?',
    'transformative(?:ly)?', 'profound(?:ly)?',
    'paramount', 'next-generation',
    // Filler
    'actually', 'simply', 'merely', 'essentially', 'ultimately',
    'furthermore', 'moreover', 'additionally', 'arguably'
  ].join('|') + ')\\b',
  'gi'
);

function cleanAISlop(obj) {
  let json = JSON.stringify(obj);

  // Em dashes and en dashes
  json = json.replace(/\u2014/g, ', ').replace(/\u2013/g, ', ');

  // Banned words: remove them and clean up leftover grammar artifacts
  json = json.replace(BANNED_WORDS_REGEX, '');

  // Clean up double spaces, orphaned commas, leading commas after periods
  json = json.replace(/  +/g, ' ');
  json = json.replace(/,\s*,/g, ',');
  json = json.replace(/\.\s*,/g, '.');
  json = json.replace(/,\s*\./g, '.');
  json = json.replace(/\s+([.,;:])/g, '$1');

  return JSON.parse(json);
}

// ─── URL VALIDATION ───

async function validateUrl(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*'
  };

  // Try GET with browser headers (many sites block HEAD and bot User-Agents)
  try {
    const res = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
    return { url, status: res.status, valid: res.status < 400 };
  } catch (err) {
    return { url, status: 0, valid: false, error: err.message };
  }
}

async function extractAndValidateUrls(draft) {
  const checks = [];

  if (draft.radar) {
    for (const item of draft.radar) {
      if (item.source_url) checks.push({ location: `Radar: ${item.headline}`, url: item.source_url, type: 'radar', item });
    }
  }
  if (draft.anchor?.source_url) {
    checks.push({ location: 'Anchor', url: draft.anchor.source_url, type: 'anchor' });
  }

  const results = [];
  for (const check of checks) {
    const result = await validateUrl(check.url);
    results.push({ ...check, ...result });
  }

  // Remove broken links from the draft instead of just flagging them
  const broken = results.filter(r => !r.valid);
  for (const b of broken) {
    if (b.type === 'radar' && b.item) {
      console.log(`  Removing broken radar link: ${b.url} (${b.status})`);
      delete b.item.source_url;
    }
    if (b.type === 'anchor') {
      console.log(`  Removing broken anchor link: ${b.url} (${b.status})`);
      delete draft.anchor.source_url;
    }
  }

  const allValid = broken.length === 0;
  return { allValid, results, broken };
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
        filter: { vertical: `eq.${vertical.slug}`, status: 'neq.failed' },
        sort: [{ field: 'created_at', direction: 'desc' }],
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
      filter: { vertical: `eq.${vertical.slug}`, status: 'eq.generated' },
      sort: [{ field: 'created_at', direction: 'desc' }],
      maxRecords: 1
    },
    env.SUPABASE_SERVICE_KEY
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
  const previousEdition = await getPreviousEdition(vertical, env.SUPABASE_SERVICE_KEY);

  // Step 4: Generate newsletter draft
  const draftPrompt = buildDraftingPrompt(
    vertical, topics, edition, month, year, previousEdition
  );
  let draft = await callLLM(draftPrompt, env, { maxTokens: 8192, jsonPattern: /\{[\s\S]*\}/ });
  draft = cleanAISlop(draft);
  console.log(`  Newsletter draft generated: "${draft.subject_line}"`);

  // Step 4b: Validate source URLs
  const linkValidation = await extractAndValidateUrls(draft);
  if (linkValidation.broken.length > 0) {
    console.log(`  WARNING: ${linkValidation.broken.length} broken link(s):`);
    linkValidation.broken.forEach(b => console.log(`    [${b.status}] ${b.location}: ${b.url}`));
  } else {
    console.log(`  All ${linkValidation.results.length} source links validated`);
  }

  // Step 5: Generate blog expansion
  const blogPrompt = buildBlogExpansionPrompt(vertical, draft.anchor, topics, month, year);
  let blogPost = await callLLM(blogPrompt, env, { maxTokens: 8192, jsonPattern: /\{[\s\S]*\}/ });
  blogPost = cleanAISlop(blogPost);
  console.log(`  Blog expansion generated: "${blogPost.seo_title}" (${blogPost.word_count} words)`);

  // Step 5b: Create Webflow blog draft
  let webflowResult = null;
  if (env.WEBFLOW_API_KEY) {
    try {
      webflowResult = await createWebflowBlogDraft(blogPost, vertical, env);
      if (webflowResult) {
        console.log(`  Webflow blog draft created: ${webflowResult.blogUrl}`);
        // Inject the blog URL into the newsletter draft
        draft.anchor.blog_url = webflowResult.blogUrl;
      }
    } catch (err) {
      console.error(`  Webflow blog creation failed: ${err.message}`);
    }
  }

  // Step 5c: Create Beehiiv newsletter draft
  let beehiivResult = null;
  if (env.BEEHIIV_API_KEY) {
    try {
      beehiivResult = await createBeehiivDraft(draft, vertical, env);
      if (beehiivResult) {
        console.log(`  Beehiiv draft created: ${beehiivResult.postId}`);
      }
    } catch (err) {
      console.error(`  Beehiiv draft creation failed: ${err.message}`);
    }
  }

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
      created_at: now.toISOString()
    },
    env.SUPABASE_SERVICE_KEY
  );

  // Mark research as consumed
  await updateRecord(
    AIRTABLE.tables.research,
    research.id,
    { status: 'consumed' },
    env.SUPABASE_SERVICE_KEY
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
    vertical, edition, month, year, draft, blogPost, linkValidation,
    webflowResult, beehiivResult
  });
  await sendEmail(emailData, env.RESEND_API_KEY);

  return {
    vertical: vertical.name,
    edition,
    subject_line: draft.subject_line,
    blog_title: blogPost.seo_title,
    blog_url: webflowResult?.blogUrl || null,
    beehiiv_draft: beehiivResult?.postId || null,
    airtableRecordId: draftRecord.id
  };
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

async function verifyHmac(message, token, secret) {
  const expected = await generateHmac(message, secret);
  return token === expected;
}

// ─── WORKER EXPORT ───

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Approve via link (GET with HMAC token)
    if (url.pathname === '/approve') {
      const token = url.searchParams.get('token');
      const selections = url.searchParams.get('selections') || 'defaults';

      if (!token) {
        return new Response('Missing token', { status: 401 });
      }

      const message = `approve:${selections}`;
      const valid = await verifyHmac(message, token, env.ANTHROPIC_API_KEY);
      if (!valid) {
        return new Response('Invalid token', { status: 403 });
      }

      // Parse selections or use defaults
      const opts = {};
      if (selections !== 'defaults') {
        try {
          // Format: law:0,1,2|architecture:1,2,0|education:0,2,3
          const parsed = {};
          selections.split('|').forEach(part => {
            const [slug, indices] = part.split(':');
            parsed[slug.trim()] = indices.split(',').map(i => parseInt(i.trim()));
          });
          opts.selections = parsed;
        } catch (e) {
          // Fall through to defaults
        }
      }

      // Pre-flight: verify research records exist for each active vertical
      // before committing to generation. Return a clear error page if not.
      const verticals = getActiveVerticals();
      const preflightResults = await Promise.all(
        verticals.map(async (vertical) => {
          try {
            const records = await queryRecords(
              AIRTABLE.tables.research,
              {
                filter: { vertical: `eq.${vertical.slug}`, status: 'eq.generated' },
                sort: [{ field: 'created_at', direction: 'desc' }],
                maxRecords: 1
              },
              env.SUPABASE_SERVICE_KEY
            );
            return { vertical: vertical.name, slug: vertical.slug, found: records.length > 0 };
          } catch (err) {
            return { vertical: vertical.name, slug: vertical.slug, found: false, error: err.message };
          }
        })
      );

      const missing = preflightResults.filter(r => !r.found);
      if (missing.length > 0) {
        const missingList = missing.map(r =>
          `<li><strong>${r.vertical}</strong>${r.error ? `: ${r.error}` : ' (no research with status=generated)'}</li>`
        ).join('');
        return new Response(`
          <html><body style="font-family: Arial, sans-serif; max-width: 640px; margin: 40px auto; padding: 20px;">
            <h1 style="color: #c0392b;">Generation Could Not Start</h1>
            <p>No research records with <code>status=generated</code> were found for:</p>
            <ul>${missingList}</ul>
            <p style="color: #666; font-size: 14px;">
              The research engine may not have run yet, or the records were already consumed by a previous generation run.
              Check Supabase > newsletter_research and look for rows with status=generated.
            </p>
            <p style="font-size: 14px;">
              To re-trigger research: <code>POST https://newsletter-research-engine.law-firm-ai-scorer.workers.dev/trigger</code>
            </p>
          </body></html>
        `, { status: 400, headers: { 'Content-Type': 'text/html' } });
      }

      // Run each vertical's generation directly in its own ctx.waitUntil promise.
      // This avoids the self-invoke HTTP fetch pattern, which timed out before
      // generateForVertical could complete (2-3 min wall clock for two LLM calls).
      for (const vertical of verticals) {
        const verticalOpts = {
          selections: opts.selections?.[vertical.slug] || null
        };
        ctx.waitUntil(
          generateForVertical(vertical, env, verticalOpts)
            .then(result => {
              console.log(`${vertical.name}: generated "${result.subject_line}"`);
            })
            .catch(async (err) => {
              console.error(`${vertical.name}: generation failed — ${err.message}`);
              if (env.RESEND_API_KEY) {
                try {
                  await sendEmail({
                    from: 'Archificials Pipeline <pipeline@archificials.com>',
                    to: 'biel@archificials.com',
                    subject: `Newsletter Generation Failed: ${vertical.name}`,
                    html: `
                      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;">
                        <h2 style="color:#c0392b;">Generation failed: ${vertical.name}</h2>
                        <p><strong>Error:</strong> ${err.message}</p>
                        <p style="color:#666;font-size:13px;">
                          Re-run this vertical manually:<br>
                          <code>Invoke-WebRequest -Method POST -Uri "https://newsletter-content-generator.law-firm-ai-scorer.workers.dev/generate/${vertical.slug}" -ContentType "application/json" -Body '{}' -UseBasicParsing</code>
                        </p>
                      </div>
                    `
                  }, env.RESEND_API_KEY);
                } catch (emailErr) {
                  console.error(`Could not send failure notification: ${emailErr.message}`);
                }
              }
            })
        );
      }

      return new Response(`
        <html><body style="font-family:Arial,sans-serif;max-width:640px;margin:40px auto;text-align:center;">
          <h1 style="color:#1a1a2e;">Content Generation Started</h1>
          <p>Research records confirmed for ${verticals.length} vertical${verticals.length !== 1 ? 's' : ''}. Drafts are generating now.</p>
          <p>You will receive a review email per vertical as each one completes. If anything fails, you will receive an error notification.</p>
          <p style="color:#666;">You can close this tab.</p>
        </body></html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }

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
