/**
 * Content Generator Prompts
 *
 * Parameterized prompt functions for newsletter drafting and blog expansion.
 */

const { BRAND, NEWSLETTER } = require('../../shared/config');

/**
 * Master newsletter drafting prompt.
 * Produces a complete, Beehiiv-ready newsletter as structured JSON.
 */
function buildDraftingPrompt(vertical, topics, edition, month, year, previousEdition = null) {
  const assessmentBlock = vertical.cta.assessment
    ? `
    "assessment_cta": "${vertical.cta.assessment}",
    "assessment_url": "${vertical.assessmentUrl}",
    "assessment_frame": "${vertical.cta.assessmentFrame}",`
    : `
    "assessment_cta": null,
    "assessment_url": null,`;

  return `CONSTRAINT #1: FABRICATION BAN (absolute, zero tolerance)
Every factual claim, statistic, percentage, company name, case study, and example in your output MUST come directly from the RESEARCH FINDINGS provided below. If a claim is not explicitly stated in the provided research, do NOT include it.

ZERO TOLERANCE means:
- Do NOT invent statistics (e.g., "40% faster", "60% reduction") unless that exact number appears in the research findings.
- Do NOT name companies as having adopted, experienced, or reported anything unless the research findings explicitly say so with a source URL.
- Do NOT create hypothetical examples framed as real ("One AmLaw 200 firm reported..." or "A mid-size firm found...") unless the research says exactly that.
- Do NOT extrapolate or generalize from one source's data to make broader claims.
- If you need to make a general observation, frame it as your interpretation ("From what I'm reading..." or "The pattern here is..."), never as an unsourced fact.
- When in doubt, leave it out.

CONSTRAINT #2: BANNED WORDS (hard filter, not a suggestion)
Never use ANY of these words or their variants. If you write one, delete it and restructure the sentence.
BANNED: ${BRAND.voice.antiAI.bannedVerbs}, ${BRAND.voice.antiAI.bannedAdjectives}, ${BRAND.voice.antiAI.bannedFiller}, ${BRAND.voice.antiAI.bannedNouns}

${BRAND.voice.antiAI.syntaxRules.map(r => `- ${r}`).join('\n')}

CONSTRAINT #3: CTA TONE (subtle, not salesy)
CTAs must feel like a casual mention, not a pitch. Think: a colleague mentioning something useful, not a marketer closing a deal. No urgency language ("don't miss out", "before it's too late", "you can't afford to ignore"). No anxiety-inducing framing ("firms that fail to act", "falling behind"). No exclamation marks in CTAs. One sentence max per CTA. The reader is smart; a quiet mention is enough.

---

You are writing Edition ${edition} of "${vertical.name}" for ${BRAND.name}, an AI consulting agency run by ${BRAND.founder}.

MONTH: ${month} ${year}
VERTICAL: ${vertical.slug}

WHO YOU ARE: A human consultant with a design background who reads 50 industry articles a week and distills them for busy executives. You have opinions. You write short sentences when they hit harder and longer ones when the idea needs room. You interpret, you don't summarize. First person ("I", "we") is natural. If a sentence could appear in any AI-generated newsletter, rewrite it until it could not.

BRAND VOICE (inspired by Stefan Sagmeister):
${BRAND.voice.principles.map(p => `- ${p}`).join('\n')}

WRITING RULES:
${BRAND.voice.rules.map(r => `- ${r}`).join('\n')}
- Use the EXACT source URLs provided in the research findings. Do not modify, shorten, or generalize URLs.
- Every factual claim must trace to a provided source URL. No exceptions.
- Never mention Biel by name in CTAs. Use "our team", "Archificials", or impersonal phrasing.

VERTICAL TONE:
${vertical.tone.summary}
${vertical.tone.guidelines.map(g => `- ${g}`).join('\n')}

THINGS TO AVOID:
${vertical.tone.avoid.map(a => `- ${a}`).join('\n')}
- Fabricated statistics, invented case studies, unnamed company anecdotes presented as fact
- Fear-based framing ("firms that don't adopt will...", "the risk of inaction...")
- Pushy or aggressive CTAs

RESEARCH FINDINGS (your ONLY source of facts):
Anchor topic: ${topics.anchor.headline}
  Summary: ${topics.anchor.summary}
  Source: ${topics.anchor.source} (${topics.anchor.sourceUrl})
  Angle: ${topics.anchor.suggestedAngle}

Radar topics:
${topics.radar.map(r => `  - ${r.headline}: ${r.summary}\n    Source: ${r.source} (${r.sourceUrl})`).join('\n')}

Quick Win topic: ${topics.quickWin.headline}
  Summary: ${topics.quickWin.summary}
  Source: ${topics.quickWin.source} (${topics.quickWin.sourceUrl})

NEWSLETTER STRUCTURE:

1. THE ANCHOR (${NEWSLETTER.sections.anchor.minWords}-${NEWSLETTER.sections.anchor.maxWords} words)
   Topic: ${topics.anchor.headline}
   Source: ${topics.anchor.sourceUrl}
   - Open with a specific fact or observation FROM THE RESEARCH
   - Build the argument using ONLY data and claims from the provided sources
   - Close with your interpretation of what this means for the reader
   - End with: "${vertical.cta.blog}"

2. THE RADAR (${NEWSLETTER.sections.radar.minWords}-${NEWSLETTER.sections.radar.maxWords} words total)
   Items:
${topics.radar.map(r => `   - "${r.headline}" (${r.source}), EXACT URL: ${r.sourceUrl}`).join('\n')}
   - ${NEWSLETTER.sections.radar.items} short paragraphs, each with bold headline
   - Stick to what the source reports. Do not add unsourced claims.
   - The source_url field in each radar item MUST be the EXACT URL listed above

3. THE QUICK WIN (${NEWSLETTER.sections.quickWin.minWords}-${NEWSLETTER.sections.quickWin.maxWords} words)
   Tool/Tip: ${topics.quickWin.headline}
   - Name the specific tool or technique from the research
   - Explain how to use it based on what the source describes
   - Frame as "Try this Monday morning"

4. THE CLOSE (${NEWSLETTER.sections.close.minWords}-${NEWSLETTER.sections.close.maxWords} words)
   - Brief personal note from ${BRAND.founder} (warm, not salesy)
   - A genuine question that invites reply
   - Mention the assessment casually (one sentence, no pressure)
   - Brief mention of consultation option (again, one sentence, casual)

OUTPUT FORMAT: Return ONLY valid JSON matching this exact structure:
{
  "subject_line": "compelling, specific, under 60 chars",
  "preview_text": "first line readers see in inbox, 90 chars max",
  "anchor": {
    "title": "section heading",
    "teaser": "200-300 word newsletter version (the teaser that links to blog)",
    "full": "400-600 word full version (used for both newsletter body and blog source)",
    "blog_cta": "${vertical.cta.blog}"
  },
  "radar": [
    {
      "headline": "bold headline",
      "body": "1 paragraph summary",
      "source_url": "url"
    }
  ],
  "quick_win": {
    "tool_name": "specific tool or technique name",
    "body": "80-120 words, Monday morning framing"
  },
  "close": {
    "personal_note": "50-80 words from ${BRAND.founder}, warm and human, zero sales pressure",
    "reply_prompt": "a genuine question that invites reply",${assessmentBlock}
    "contact_cta": "${vertical.cta.contact}",
    "contact_url": "${vertical.cta.contactUrl}"
  }
}

${previousEdition ? `PREVIOUS EDITION (for continuity, avoid repeating angles):\nSubject: ${previousEdition.subject_line}\nAnchor: ${previousEdition.anchor?.title || 'N/A'}` : 'This is the FIRST edition. Make it count. If launching on April 1st, acknowledge the date with self-awareness, not a prank.'}

FINAL CHECK before outputting: scan every sentence. If any claim, statistic, or company mention does not come from the research findings above, remove it. If any CTA sounds like a sales pitch, soften it.

Return ONLY the JSON object. No markdown, no explanation, no code blocks.`;
}

/**
 * Blog expansion prompt.
 * Takes the anchor article and expands it into a full SEO-optimized blog post.
 */
function buildBlogExpansionPrompt(vertical, anchorDraft, topics, month, year) {
  const sourceLinks = [];
  if (topics.anchor.sourceUrl) {
    sourceLinks.push(`- Anchor source: ${topics.anchor.sourceUrl} (${topics.anchor.source})`);
  }
  topics.radar.forEach(r => {
    if (r.sourceUrl) sourceLinks.push(`- ${r.headline}: ${r.sourceUrl} (${r.source})`);
  });
  if (topics.quickWin.sourceUrl) {
    sourceLinks.push(`- ${topics.quickWin.headline}: ${topics.quickWin.sourceUrl} (${topics.quickWin.source})`);
  }

  return `CONSTRAINT #1: FABRICATION BAN (absolute, zero tolerance)
Every factual claim, statistic, percentage, company name, and example in this blog post MUST come from either:
(a) The original anchor article text below, or
(b) The SOURCE LINKS listed below.

ZERO TOLERANCE means:
- Do NOT invent statistics, percentages, or time savings not present in the sources.
- Do NOT name companies as having adopted or experienced anything unless a source below explicitly says so.
- Do NOT create hypothetical examples framed as real events.
- The instruction to "add 2-3 additional data points" means ADD DEPTH from the same sources or your own analysis/interpretation, NOT fabricate new facts.
- If you want to illustrate a point without a source, frame it clearly as a hypothetical ("Imagine a firm that..." or "Consider a scenario where..."), never as a real case.
- When in doubt, leave it out.

CONSTRAINT #2: BANNED WORDS (hard filter)
Never use ANY of these words or their variants:
BANNED: ${BRAND.voice.antiAI.bannedVerbs}, ${BRAND.voice.antiAI.bannedAdjectives}, ${BRAND.voice.antiAI.bannedFiller}, ${BRAND.voice.antiAI.bannedNouns}

${BRAND.voice.antiAI.syntaxRules.map(r => `- ${r}`).join('\n')}

CONSTRAINT #3: CTA TONE (subtle, not salesy)
CTAs at the end should feel like casual mentions, not sales pitches. One sentence each, no urgency, no anxiety framing, no exclamation marks. The reader found this article because they're already interested; a quiet pointer is enough.

---

Expand the newsletter anchor article below into a full blog post for archificials.com.
Write as a human consultant with a design background, not a language model. First person where natural. Vary sentence length. Have a point of view. If a sentence sounds like it came from any AI tool, rewrite it.

ORIGINAL ANCHOR ARTICLE:
${anchorDraft.full}

REQUIREMENTS:
- Length: ${NEWSLETTER.blogExpansion.minWords}-${NEWSLETTER.blogExpansion.maxWords} words
- SEO title: 60 characters max (different from newsletter subject line, optimize for search)
- Meta description: 155 characters max, include primary keyword
- Use H2 and H3 subheadings for scannability
- Add depth through analysis, interpretation, and context from the same sources (NOT fabricated data points)
- Maintain the same tone: ${vertical.tone.summary}

SOURCE LINKS TO EMBED:
The following are your ONLY permitted source URLs. Embed them as hyperlinks where the claims they support appear. Use <a href="URL" target="_blank">Source Name</a> format.

${sourceLinks.join('\n')}

RULES FOR SOURCE LINKS:
- Every factual claim or statistic MUST link to its source from the list above
- Use descriptive anchor text (the publication name or a relevant phrase), NOT "click here" or "source"
- Links must use target="_blank"
- Do NOT fabricate or modify URLs. Use ONLY the URLs provided above.
- If you make a general observation or interpretation (not a factual claim), no link is needed
- If you cannot link a factual claim to one of the sources above, REMOVE the claim entirely

WRITING RULES:
${BRAND.voice.rules.map(r => `- ${r}`).join('\n')}

CTA BLOCKS TO INCLUDE AT THE END (one sentence each, casual tone, no pressure):
1. Assessment: ${vertical.cta.assessment ? `Mention "${vertical.cta.assessment}" with a link to ${vertical.assessmentUrl}. Keep it to one low-key sentence.` : 'Skip (not available for this vertical)'}
2. Newsletter: Something like "We send this kind of analysis every two weeks." with a subscribe mention. One sentence.
3. Contact: Mention "${vertical.cta.contact}" with a link to ${vertical.cta.contactUrl}. One sentence, no pressure.

FAQ SECTION (for SEO, AEO, and GEO optimization):
Generate 5 questions and answers related to the blog post content.

- Questions should be natural language queries that a decision-maker in this vertical would search for
- Answers should be comprehensive (3-5 sentences each), wrapped in <p> tags for RichText
- Answers must only contain claims that are supported by the sources above
- Snippets should be concise (2-3 sentences max), plain text only (no HTML), optimized for AI answer engines
- Snippets should read as standalone, authoritative answers that an AI could cite directly

BLOG CATEGORY: ${vertical.blogCategory}
AUTHOR: ${BRAND.founder}, ${BRAND.founderTitle}

OUTPUT FORMAT: Return ONLY valid JSON:
{
  "seo_title": "60 chars max",
  "meta_description": "155 chars max",
  "slug": "url-friendly-slug",
  "category": "${vertical.blogCategory}",
  "html_body": "full blog post in clean HTML (h2, h3, p, a, strong tags only). Every factual claim hyperlinked to its source.",
  "word_count": number,
  "primary_keyword": "the main SEO keyword targeted",
  "assessment_cta_html": "one-sentence casual CTA with link",
  "subscribe_cta_html": "one-sentence casual subscribe mention",
  "faq": [
    {
      "question": "Natural language question a decision-maker would search for",
      "answer": "<p>Comprehensive 3-5 sentence answer wrapped in p tags. Only sourced claims.</p>",
      "snippet": "Concise 2-3 sentence plain text answer optimized for AI answer engines. No HTML."
    }
  ]
}

The "faq" array MUST contain exactly 5 items.

FINAL CHECK: Before outputting, scan every sentence in html_body. If any claim, statistic, or company mention cannot be traced to the sources above, remove it. If any CTA reads like a sales pitch, tone it down.

Return ONLY the JSON object. No markdown, no explanation.`;
}

module.exports = { buildDraftingPrompt, buildBlogExpansionPrompt };
