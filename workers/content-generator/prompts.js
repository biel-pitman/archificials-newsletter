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

  return `You are writing Edition ${edition} of "${vertical.name}" for ${BRAND.name}, an AI consulting agency run by ${BRAND.founder}.

MONTH: ${month} ${year}
VERTICAL: ${vertical.slug}

BRAND VOICE (inspired by Stefan Sagmeister):
${BRAND.voice.principles.map(p => `- ${p}`).join('\n')}

WRITING RULES (MANDATORY):
${BRAND.voice.rules.map(r => `- ${r}`).join('\n')}
- Use the EXACT source URLs provided in the research findings. Do not modify, shorten, or generalize URLs. Every source link must be a full URL that resolves to the specific article, not a homepage or generic domain.
- Never mention Biel by name in CTAs. Use "our team", "Archificials", or impersonal phrasing.

VERTICAL TONE:
${vertical.tone.summary}
${vertical.tone.guidelines.map(g => `- ${g}`).join('\n')}

THINGS TO AVOID:
${vertical.tone.avoid.map(a => `- ${a}`).join('\n')}

NEWSLETTER STRUCTURE:

1. THE ANCHOR (${NEWSLETTER.sections.anchor.minWords}-${NEWSLETTER.sections.anchor.maxWords} words)
   Topic: ${topics.anchor.headline}
   Angle: ${topics.anchor.suggestedAngle}
   Source: ${topics.anchor.sourceUrl}
   - Open with a striking fact or observation
   - Build the argument with evidence and specifics
   - Close with implications for the reader's firm
   - End with: "${vertical.cta.blog}"

2. THE RADAR (${NEWSLETTER.sections.radar.minWords}-${NEWSLETTER.sections.radar.maxWords} words total)
   Items:
${topics.radar.map(r => `   - "${r.headline}" (${r.source}) — EXACT URL: ${r.sourceUrl}`).join('\n')}
   - ${NEWSLETTER.sections.radar.items} short paragraphs, each with bold headline
   - Include source context
   - The source_url field in each radar item MUST be the EXACT URL listed above

3. THE QUICK WIN (${NEWSLETTER.sections.quickWin.minWords}-${NEWSLETTER.sections.quickWin.maxWords} words)
   Tool/Tip: ${topics.quickWin.headline}
   - Name the specific tool or technique
   - Explain exactly how to use it
   - Frame as "Try this Monday morning"

4. THE CLOSE (${NEWSLETTER.sections.close.minWords}-${NEWSLETTER.sections.close.maxWords} words)
   - Personal note from ${BRAND.founder}
   - A question that invites reply
   - Assessment CTA (this is the primary conversion point)
   - Brief mention of direct contact option

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
    "personal_note": "50-80 words from ${BRAND.founder}",
    "reply_prompt": "a question that invites reply",${assessmentBlock}
    "contact_cta": "${vertical.cta.contact}",
    "contact_url": "${vertical.cta.contactUrl}"
  }
}

${previousEdition ? `PREVIOUS EDITION (for continuity, avoid repeating angles):\nSubject: ${previousEdition.subject_line}\nAnchor: ${previousEdition.anchor?.title || 'N/A'}` : 'This is the FIRST edition. Make it count. If launching on April 1st, acknowledge the date with self-awareness, not a prank.'}

Return ONLY the JSON object. No markdown, no explanation, no code blocks.`;
}

/**
 * Blog expansion prompt.
 * Takes the anchor article and expands it into a full SEO-optimized blog post.
 */
function buildBlogExpansionPrompt(vertical, anchorDraft, month, year) {
  return `Expand the newsletter anchor article below into a full blog post for archificials.com.

ORIGINAL ANCHOR ARTICLE:
${anchorDraft.full}

REQUIREMENTS:
- Length: ${NEWSLETTER.blogExpansion.minWords}-${NEWSLETTER.blogExpansion.maxWords} words
- SEO title: 60 characters max (different from newsletter subject line, optimize for search)
- Meta description: 155 characters max, include primary keyword
- Use H2 and H3 subheadings for scannability
- Add 2-3 additional data points or examples not in the newsletter version
- Maintain the same tone: ${vertical.tone.summary}

WRITING RULES (MANDATORY):
${BRAND.voice.rules.map(r => `- ${r}`).join('\n')}

CTA BLOCKS TO INCLUDE AT THE END:
1. Assessment CTA: ${vertical.cta.assessment ? `"${vertical.cta.assessment}" linking to ${vertical.assessmentUrl}` : 'Skip (not available for this vertical)'}
2. Newsletter subscribe CTA: "Get insights like this delivered bi-weekly, plus tools and tips you will not find on the blog."
3. Contact CTA: "${vertical.cta.contact}" linking to ${vertical.cta.contactUrl}

BLOG CATEGORY: ${vertical.blogCategory}
AUTHOR: ${BRAND.founder}, ${BRAND.founderTitle}

OUTPUT FORMAT: Return ONLY valid JSON:
{
  "seo_title": "60 chars max",
  "meta_description": "155 chars max",
  "slug": "url-friendly-slug",
  "category": "${vertical.blogCategory}",
  "html_body": "full blog post in clean HTML (h2, h3, p, a, strong tags only)",
  "word_count": number,
  "primary_keyword": "the main SEO keyword targeted",
  "assessment_cta_html": "styled CTA block HTML for assessment",
  "subscribe_cta_html": "styled CTA block HTML for newsletter signup"
}

Return ONLY the JSON object. No markdown, no explanation.`;
}

module.exports = { buildDraftingPrompt, buildBlogExpansionPrompt };
