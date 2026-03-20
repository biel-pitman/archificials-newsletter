#!/usr/bin/env node
/**
 * Local test script for the Research Engine.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... BRAVE_API_KEY=BSA... node scripts/test-research.js [vertical]
 *
 * Runs a single vertical (default: law) through the research pipeline
 * and prints results to stdout. Does NOT write to Airtable or R2.
 */

const { getVertical, getActiveVerticals } = require('../shared/config');
const { buildResearchPrompt, buildSearchQueries } = require('../workers/research-engine/prompts');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!BRAVE_API_KEY || !ANTHROPIC_API_KEY) {
  console.error('Required env vars: BRAVE_API_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

async function braveSearch(query) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY }
  });
  if (!res.ok) { console.error(`Brave failed: ${res.status}`); return []; }
  const data = await res.json();
  return (data.web?.results || []).map(r => ({
    title: r.title, url: r.url, description: r.description
  }));
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
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) { throw new Error(`Claude: ${res.status} ${await res.text()}`); }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

async function main() {
  const slug = process.argv[2] || 'law';
  const vertical = getVertical(slug);
  if (!vertical) {
    console.error(`Unknown vertical: ${slug}. Available: ${getActiveVerticals().map(v => v.slug).join(', ')}`);
    process.exit(1);
  }

  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const year = now.getFullYear();

  console.log(`\n=== Research Test: ${vertical.name} (${month} ${year}) ===\n`);

  // Search
  const queries = buildSearchQueries(vertical, month, year);
  console.log('Search queries:');
  queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

  const results = [];
  for (const q of queries) {
    const r = await braveSearch(q);
    results.push(...r);
    console.log(`  Query "${q.slice(0, 40)}...": ${r.length} results`);
  }

  // Deduplicate
  const seen = new Set();
  const unique = results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
  console.log(`\n${unique.length} unique results (from ${results.length} total)\n`);

  // Analyze
  console.log('Calling Claude for analysis...');
  const prompt = buildResearchPrompt(vertical, unique, []);
  const findings = await callClaude(prompt);

  console.log(`\n=== ${findings.length} Findings ===\n`);
  findings.forEach((f, i) => {
    console.log(`${i + 1}. [${f.relevance}/5] ${f.headline}`);
    console.log(`   Section: ${f.section}`);
    console.log(`   ${f.summary}`);
    console.log(`   Source: ${f.source}`);
    console.log(`   Angle: ${f.suggestedAngle}\n`);
  });
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
