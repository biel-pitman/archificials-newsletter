/**
 * Research Engine Prompts
 *
 * Two research modes:
 *   1. GROUNDED (primary): Gemini + Google Search grounding
 *      - buildGroundingPrompt: tells Gemini what to search for
 *      - buildStructuringPrompt: converts grounded text + citations into JSON
 *   2. BRAVE FALLBACK: Brave Search + Claude/Gemini analysis
 *      - buildSearchQueries: generates Brave Search query strings
 *      - buildResearchPrompt: analyzes raw search results into JSON
 */

const { BRAND, NEWSLETTER } = require('../../shared/config');

// ────────────────────────────────────────────────
// GROUNDED RESEARCH PROMPTS (Gemini + Google Search)
// ────────────────────────────────────────────────

/**
 * Prompt for Gemini with Google Search grounding enabled.
 * Gemini will search the web itself, read articles, and produce a grounded report.
 * We do NOT ask for JSON here because grounding + JSON mode causes 400 errors.
 */
function buildGroundingPrompt(vertical, previousTopics = []) {
  const audience = vertical.slug === 'law' ? 'law firms' :
    vertical.slug === 'architecture' ? 'architecture firms' :
    vertical.slug === 'education' ? 'K-12 and higher education institutions' :
    'commercial real estate firms';

  const avoidClause = previousTopics.length > 0
    ? `\nAvoid covering these topics (already covered recently): ${previousTopics.slice(0, 10).join('; ')}`
    : '';

  return `You are a senior research analyst preparing an AI industry briefing for decision-makers at ${audience}.

Search for the most recent and important developments in AI as they relate to ${vertical.slug === 'law' ? 'the legal profession' : vertical.slug === 'architecture' ? 'architecture and AEC' : vertical.slug === 'education' ? 'education (K-12 and higher ed)' : 'commercial real estate'}.

Focus your searches on:
${vertical.research.keywords.slice(0, 6).map(k => `- ${k}`).join('\n')}

Prioritize content from these trusted sources when available:
${vertical.research.sources.join(', ')}
${avoidClause}

WHAT TO REPORT:
Find 8-12 distinct developments, tools, case studies, or policy changes. For each one, write:
- A short headline (8 words max)
- A 2-4 sentence summary of what happened and why it matters to ${audience}
- Which publication or source reported this

CRITICAL RULES:
- Only report facts you find in actual articles. Do not invent examples or statistics.
- Include specific numbers, tool names, company names, and dates when the articles provide them.
- If an article is vague, keep your summary proportionally brief.
- Categorize each item: is it best as a "deep-dive topic" (complex, worth 500 words), a "news brief" (worth 2-3 sentences), or an "actionable tip" (a specific tool or technique readers can try immediately)?

Write the report in plain text (not JSON). Include the source URL for each item.`;
}

/**
 * Prompt to structure the grounded Gemini output into the JSON format
 * the pipeline expects. This runs on Claude (or Gemini without grounding).
 */
function buildStructuringPrompt(vertical, groundedText, citations, groundingSupports, previousTopics = []) {
  // Build a readable citation reference
  const citationRef = citations.map((c, i) =>
    `[${i}] ${c.title} | ${c.url}`
  ).join('\n');

  const avoidTopics = previousTopics.length > 0
    ? `\nAVOID THESE RECENT TOPICS:\n${previousTopics.map(t => `- ${t}`).join('\n')}`
    : '';

  return `You are converting a grounded research report into structured JSON for a newsletter pipeline.

CONSTRAINT: SOURCE FIDELITY (absolute)
Every finding you produce must come directly from the research report below. The sourceUrl for each finding must be an EXACT URL from the citation list. Do not fabricate, modify, or shorten URLs. Do not add claims not present in the report.

CONSTRAINT: BANNED WORDS (hard filter)
Never use ANY of these words or their variants:
Verbs: ${BRAND.voice.antiAI.bannedVerbs}
Nouns: ${BRAND.voice.antiAI.bannedNouns}
Adjectives: ${BRAND.voice.antiAI.bannedAdjectives}
Filler: ${BRAND.voice.antiAI.bannedFiller}

${BRAND.voice.antiAI.syntaxRules.map(r => `- ${r}`).join('\n')}

---

GROUNDED RESEARCH REPORT:
${groundedText}

CITATION LIST (use these EXACT URLs):
${citationRef}

---

AUDIENCE: Partners, founders, and directors at ${vertical.slug === 'law' ? 'law firms' :
  vertical.slug === 'architecture' ? 'architecture firms' :
  vertical.slug === 'education' ? 'private and charter schools' :
  'real estate development firms'}.

VERTICAL TONE: ${vertical.tone.summary}
${avoidTopics}

INSTRUCTIONS:
Convert the research report above into exactly 8-10 JSON findings. Each finding must map to a specific item in the report and use an EXACT URL from the citation list.

For each finding, return:
- headline: string (8 words max, punchy, specific)
- summary: string (2-3 sentences, only claims from the report)
- source: string (publication name, from citation list)
- sourceUrl: string (EXACT URL from citation list, unmodified)
- relevance: number (1-5, where 5 = highest relevance to senior decision-makers)
- suggestedAngle: string (1 sentence: how to frame this in a newsletter)
- section: string (one of: "anchor", "radar", "quickWin")

RULES:
- At least 2 findings rated as "anchor" (deep-dive worthy)
- At least 3 as "radar" (news brief worthy)
- At least 2 as "quickWin" (actionable tool or technique)
- Every sourceUrl must appear verbatim in the citation list above
- If you cannot find a matching URL for a claim, skip that finding

Write headlines and summaries like a sharp human analyst. Short sentences. No throat-clearing.

Return ONLY valid JSON: an array of finding objects. No markdown, no explanation.`;
}

// ────────────────────────────────────────────────
// BRAVE SEARCH FALLBACK PROMPTS
// ────────────────────────────────────────────────

/**
 * Build the research analysis prompt for the Brave Search fallback path.
 * Takes raw search results and produces structured findings.
 */
function buildResearchPrompt(vertical, searchResults, previousTopics = []) {
  const avoidTopics = previousTopics.length > 0
    ? `\nAVOID REPEATING THESE RECENT TOPICS:\n${previousTopics.map(t => `- ${t}`).join('\n')}`
    : '';

  return `You are a research analyst for ${BRAND.name}, an AI consulting agency.
Your job: identify the most important AI developments for the ${vertical.name} audience.

CONSTRAINT #1: SOURCE FIDELITY (absolute)
Every finding you produce must be directly based on a specific search result below. The headline, summary, source, and sourceUrl must all trace to one specific search result. Do NOT:
- Synthesize multiple results into a single finding with a fabricated summary
- Add statistics, company names, or claims not present in the search result you're citing
- Invent context or outcomes beyond what the search result describes
- Extrapolate or generalize from the search result's description

If a search result's description is vague, keep your summary proportionally modest. Do not embellish.

CONSTRAINT #2: BANNED WORDS (hard filter)
Never use ANY of these words or their variants in headline, summary, or suggestedAngle:
Verbs: ${BRAND.voice.antiAI.bannedVerbs}
Nouns: ${BRAND.voice.antiAI.bannedNouns}
Adjectives: ${BRAND.voice.antiAI.bannedAdjectives}
Filler: ${BRAND.voice.antiAI.bannedFiller}

${BRAND.voice.antiAI.syntaxRules.map(r => `- ${r}`).join('\n')}

---

AUDIENCE: Partners, founders, and directors at ${vertical.slug === 'law' ? 'law firms' :
  vertical.slug === 'architecture' ? 'architecture firms' :
  vertical.slug === 'education' ? 'private and charter schools' :
  'real estate development firms'}. These are senior decision-makers, not technical staff.

VERTICAL CONTEXT:
${vertical.tone.summary}

TRUSTED SOURCES FOR THIS VERTICAL:
${vertical.research.sources.join(', ')}

RAW SEARCH RESULTS:
${JSON.stringify(searchResults, null, 2)}

INSTRUCTIONS:
Analyze the search results and produce exactly 8-10 findings, ranked by relevance to the audience.

For each finding, return a JSON object with:
- headline: string (8 words max, punchy, specific)
- summary: string (2-3 sentences explaining why this matters to the audience. ONLY include claims present in the search result.)
- source: string (publication name, extracted from the URL domain or title)
- sourceUrl: string (the EXACT URL from the search result, unmodified)
- relevance: number (1-5, where 5 = perfect for senior decision-makers in this vertical)
- suggestedAngle: string (1 sentence: how ${BRAND.name} should frame this in the newsletter. Frame as interpretation, not fabricated fact.)
- section: string (one of: "anchor", "radar", "quickWin")

RANKING CRITERIA (in order of priority):
1. Actionability: Can the reader do something with this information?
2. Timeliness: Is this genuinely new or recently significant?
3. Specificity: Does the search result include data, named tools, or measurable outcomes?
4. Relevance: Does it directly affect how these professionals work?

RULES:
- At least 2 findings should be rated as "anchor" candidates (deep-dive worthy)
- At least 3 should be "radar" candidates (news brief worthy)
- At least 2 should be "quickWin" candidates (actionable tool or technique)
- Never fabricate sources or URLs; only use what appears in the search results
- If a search result is irrelevant or low-quality, skip it
- The summary must reflect ONLY what the search result description says, not what you think the full article might contain
${avoidTopics}

Write like a sharp human analyst, not a language model. Short sentences. Specific numbers only if they appear in the search results. No throat-clearing.

Return ONLY valid JSON: an array of finding objects. No markdown, no explanation.`;
}

/**
 * Build search queries for Brave Search API.
 * Returns 5 queries per vertical, targeting different content types.
 */
function buildSearchQueries(vertical, month, year) {
  const baseKeywords = vertical.research.keywords;

  return [
    `${baseKeywords[0]} ${baseKeywords[1]} ${month} ${year} news`,
    `new AI tools ${vertical.slug === 'law' ? 'legal' : vertical.slug} firms ${year}`,
    `AI implementation ${vertical.slug === 'law' ? 'law firm' : vertical.slug} case study ROI ${year}`,
    `AI policy regulation ${vertical.slug === 'law' ? 'legal profession' : vertical.slug} ${year}`,
    `${baseKeywords[Math.floor(baseKeywords.length / 2)]} ${baseKeywords[baseKeywords.length - 1]}`
  ];
}

module.exports = { buildGroundingPrompt, buildStructuringPrompt, buildResearchPrompt, buildSearchQueries };
