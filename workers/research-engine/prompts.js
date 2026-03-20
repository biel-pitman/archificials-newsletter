/**
 * Research Engine Prompts
 *
 * Parameterized prompt functions for the research phase.
 * Called with vertical config and search results to produce structured findings.
 */

const { BRAND, NEWSLETTER } = require('../../shared/config');

/**
 * Build the research analysis prompt for Claude.
 * Takes raw Brave Search results and vertical context,
 * returns structured findings ranked by relevance.
 */
function buildResearchPrompt(vertical, searchResults, previousTopics = []) {
  const avoidTopics = previousTopics.length > 0
    ? `\nAVOID REPEATING THESE RECENT TOPICS:\n${previousTopics.map(t => `- ${t}`).join('\n')}`
    : '';

  return `You are a research analyst for ${BRAND.name}, an AI consulting agency.
Your job: identify the most important AI developments for the ${vertical.name} audience.

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
- summary: string (2-3 sentences explaining why this matters to the audience)
- source: string (publication name)
- sourceUrl: string (URL)
- relevance: number (1-5, where 5 = perfect for senior decision-makers in this vertical)
- suggestedAngle: string (1 sentence: how ${BRAND.name} should frame this in the newsletter)
- section: string (one of: "anchor", "radar", "quickWin")

RANKING CRITERIA (in order of priority):
1. Actionability: Can the reader do something with this information?
2. Timeliness: Is this genuinely new or recently significant?
3. Specificity: Does it include data, named tools, or measurable outcomes?
4. Relevance: Does it directly affect how these professionals work?
5. Competitive pressure: Does ignoring this put firms at a disadvantage?

RULES:
- At least 2 findings should be rated as "anchor" candidates (deep-dive worthy)
- At least 3 should be "radar" candidates (news brief worthy)
- At least 2 should be "quickWin" candidates (actionable tool or technique)
- Never fabricate sources or URLs; only use what appears in the search results
- If a search result is irrelevant or low-quality, skip it
${avoidTopics}

Return ONLY valid JSON: an array of finding objects. No markdown, no explanation.`;
}

/**
 * Build search queries for Brave Search API.
 * Returns 5 queries per vertical, targeting different content types.
 */
function buildSearchQueries(vertical, month, year) {
  const baseKeywords = vertical.research.keywords;

  return [
    // Query 1: Recent news and developments
    `${baseKeywords[0]} ${baseKeywords[1]} ${month} ${year} news`,
    // Query 2: New tools and product launches
    `new AI tools ${vertical.slug === 'law' ? 'legal' : vertical.slug} firms ${year}`,
    // Query 3: Case studies and ROI data
    `AI implementation ${vertical.slug === 'law' ? 'law firm' : vertical.slug} case study ROI ${year}`,
    // Query 4: Regulatory and policy changes
    `AI policy regulation ${vertical.slug === 'law' ? 'legal profession' : vertical.slug} ${year}`,
    // Query 5: Industry-specific pain points
    `${baseKeywords[Math.floor(baseKeywords.length / 2)]} ${baseKeywords[baseKeywords.length - 1]}`
  ];
}

module.exports = { buildResearchPrompt, buildSearchQueries };
