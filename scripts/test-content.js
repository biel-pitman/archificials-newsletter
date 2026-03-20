#!/usr/bin/env node
/**
 * Local test script for the Content Generator.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/test-content.js [vertical]
 *
 * Uses mock research findings to test the drafting pipeline.
 * Outputs the newsletter draft and blog expansion to stdout.
 */

const { getVertical, getActiveVerticals } = require('../shared/config');
const { buildDraftingPrompt, buildBlogExpansionPrompt } = require('../workers/content-generator/prompts');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('Required env var: ANTHROPIC_API_KEY');
  process.exit(1);
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) { throw new Error(`Claude: ${res.status} ${await res.text()}`); }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Non-JSON response: ${text.slice(0, 300)}`);
  return JSON.parse(match[0]);
}

// Mock research findings for testing
const MOCK_FINDINGS = {
  law: {
    anchor: {
      headline: 'Legal AI governance frameworks expected by 80% of firms',
      summary: 'Gartner projects 80% of organizations will have formal AI governance by end of 2026.',
      sourceUrl: 'https://example.com/gartner-legal-ai',
      suggestedAngle: 'Frame as a competitive urgency play: firms without governance are falling behind.'
    },
    radar: [
      { headline: 'Lexis+ AI adds predictive case outcomes', source: 'Artificial Lawyer', sourceUrl: 'https://example.com/lexis' },
      { headline: 'Contract cycle times drop 40% with CLM automation', source: 'Bloomberg Law', sourceUrl: 'https://example.com/clm' }
    ],
    quickWin: {
      headline: 'Hona.ai automates client intake in 20 minutes',
      suggestedAngle: 'Free tool, immediate ROI, perfect Monday morning win.'
    }
  },
  architecture: {
    anchor: {
      headline: 'Firms save $300K in non-billable hours with BIM AI',
      summary: 'Ware Malcomb and BSB Design report $300K annual savings from AI-integrated BIM workflows.',
      sourceUrl: 'https://example.com/bim-savings',
      suggestedAngle: 'Lead with the documentation grind pain point, Biel knows this firsthand.'
    },
    radar: [
      { headline: 'V-Ray 7 AI denoising cuts render times 70%', source: 'AEC Magazine', sourceUrl: 'https://example.com/vray' },
      { headline: 'Digital twin adoption to triple by 2027', source: 'ArchDaily', sourceUrl: 'https://example.com/twins' }
    ],
    quickWin: {
      headline: 'ArchiVinci converts sketches to renders in 60 seconds',
      suggestedAngle: 'Free tier, no learning curve, perfect for early client conversations.'
    }
  },
  education: {
    anchor: {
      headline: 'Teachers using AI save 5.9 hours per week',
      summary: 'New data shows weekly AI users save nearly 6 hours, equivalent to 6 extra weeks per school year.',
      sourceUrl: 'https://example.com/teacher-time',
      suggestedAngle: 'Lead with the human impact: what would you do with 6 extra weeks?'
    },
    radar: [
      { headline: 'OECD Digital Education Outlook 2026 released', source: 'OECD', sourceUrl: 'https://example.com/oecd' },
      { headline: '85% of teachers now report using AI tools', source: 'EdSurge', sourceUrl: 'https://example.com/adoption' }
    ],
    quickWin: {
      headline: 'Canva AI builds parent night slides in 2 minutes',
      suggestedAngle: 'Free, zero design skill needed, saves admin team 2-3 hours.'
    }
  }
};

async function main() {
  const slug = process.argv[2] || 'law';
  const vertical = getVertical(slug);
  if (!vertical) {
    console.error(`Unknown vertical: ${slug}. Available: ${getActiveVerticals().map(v => v.slug).join(', ')}`);
    process.exit(1);
  }

  const topics = MOCK_FINDINGS[slug];
  if (!topics) {
    console.error(`No mock findings for: ${slug}`);
    process.exit(1);
  }

  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const year = now.getFullYear();

  console.log(`\n=== Content Generation Test: ${vertical.name} ===\n`);

  // Generate newsletter
  console.log('Generating newsletter draft...');
  const draftPrompt = buildDraftingPrompt(vertical, topics, 1, month, year, null);
  const draft = await callClaude(draftPrompt);

  console.log(`\nSubject: ${draft.subject_line}`);
  console.log(`Preview: ${draft.preview_text}\n`);
  console.log('--- ANCHOR ---');
  console.log(`Title: ${draft.anchor.title}`);
  console.log(`Teaser (${draft.anchor.teaser.split(' ').length} words):`);
  console.log(draft.anchor.teaser);
  console.log(`\nFull (${draft.anchor.full.split(' ').length} words):`);
  console.log(draft.anchor.full);
  console.log('\n--- RADAR ---');
  draft.radar.forEach(r => console.log(`${r.headline}: ${r.body}`));
  console.log('\n--- QUICK WIN ---');
  console.log(`${draft.quick_win.tool_name}: ${draft.quick_win.body}`);
  console.log('\n--- CLOSE ---');
  console.log(draft.close.personal_note);
  console.log(`\nAssessment CTA: ${draft.close.assessment_cta || 'N/A'}`);
  console.log(`Contact CTA: ${draft.close.contact_cta}`);

  // Generate blog expansion
  console.log('\n\nGenerating blog expansion...');
  const blogPrompt = buildBlogExpansionPrompt(vertical, draft.anchor, month, year);
  const blog = await callClaude(blogPrompt);

  console.log(`\nSEO Title: ${blog.seo_title}`);
  console.log(`Meta: ${blog.meta_description}`);
  console.log(`Slug: ${blog.slug}`);
  console.log(`Word count: ${blog.word_count}`);
  console.log(`Keyword: ${blog.primary_keyword}`);
  console.log('\n--- BLOG BODY (first 500 chars) ---');
  console.log(blog.html_body?.slice(0, 500) + '...');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
