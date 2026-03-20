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

import { getActiveVerticals, getVertical, AIRTABLE, WEBFLOW, BRAND } from '../../shared/config';
import { createRecord, queryRecords, updateRecord } from '../../shared/airtable';
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

// ─── EM DASH CLEANUP ───

function removeEmDashes(obj) {
  const json = JSON.stringify(obj);
  // Replace em dashes (—) and en dashes (–) with comma-space
  const cleaned = json.replace(/\u2014/g, ', ').replace(/\u2013/g, ', ');
  return JSON.parse(cleaned);
}

// ─── URL VALIDATION ───

async function extractAndValidateUrls(draft) {
  const urls = [];

  // Collect URLs from radar items
  if (draft.radar) {
    for (const item of draft.radar) {
      if (item.source_url) urls.push({ location: `Radar: ${item.headline}`, url: item.source_url });
    }
  }

  // Collect anchor source URL if present
  if (draft.anchor?.source_url) {
    urls.push({ location: 'Anchor', url: draft.anchor.source_url });
  }

  const results = [];
  for (const { location, url } of urls) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      results.push({ location, url, status: res.status, valid: res.status < 400 });
    } catch (err) {
      results.push({ location, url, status: 0, valid: false, error: err.message });
    }
  }

  const allValid = results.every(r => r.valid);
  const broken = results.filter(r => !r.valid);
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
  let draft = await callClaude(draftPrompt, env.ANTHROPIC_API_KEY);
  draft = removeEmDashes(draft);
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
  let blogPost = await callClaude(blogPrompt, env.ANTHROPIC_API_KEY);
  blogPost = removeEmDashes(blogPost);
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
      created: now.toISOString().split('T')[0]
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

      // Run generation in background
      const verticals = getActiveVerticals();
      const resultPromise = (async () => {
        const results = [];
        for (const vertical of verticals) {
          try {
            const result = await generateForVertical(vertical, env, {
              selections: opts.selections?.[vertical.slug] || null
            });
            results.push(result);
          } catch (err) {
            results.push({ vertical: vertical.name, error: err.message });
          }
        }
        return results;
      })();
      ctx.waitUntil(resultPromise);

      return new Response(`
        <html><body style="font-family: Arial, sans-serif; max-width: 640px; margin: 40px auto; text-align: center;">
          <h1 style="color: #1a1a2e;">Content Generation Started</h1>
          <p>Drafts are being generated for all active verticals. You will receive review emails shortly.</p>
          <p style="color: #666;">You can close this tab.</p>
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
