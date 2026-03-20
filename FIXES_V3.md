# Newsletter Pipeline V3 Fixes

Two issues found during Webflow CMS review. Both are in the content-generator worker.

## FIX 1: Blog Posts Missing FAQ Fields (SEO/AEO/GEO)

The Webflow Blog Post CMS collection has 5 FAQ slots that are currently being left empty by the content generator. These are critical for search optimization.

### Fields that need to be populated:

| Field Slug | Type | Purpose |
|------------|------|---------|
| question-1 through question-5 | PlainText | FAQ questions related to the blog content |
| answer-1 through answer-5 | RichText (HTML) | Full paragraph answers (wrapped in `<p>` tags) |
| snippet1, snippet2, snippet-3, snippet-4, snippet-5 | PlainText | Short 2-3 sentence answers optimized for AI answer engines (AEO) |

Note the inconsistent slug naming: snippet1, snippet2 (no dash), then snippet-3, snippet-4, snippet-5 (with dash). Match this exactly.

### What to change:

**In `workers/content-generator/prompts.js`, update the `buildBlogExpansionPrompt` function** to add FAQ generation to the output schema. Add this to the prompt:

```
FAQ SECTION (for SEO, AEO, and GEO optimization):
Generate 5 questions and answers related to the blog post content.

- Questions should be natural language queries that a decision-maker in this vertical would search for
- Answers should be comprehensive (3-5 sentences each), wrapped in <p> tags for RichText
- Snippets should be concise (2-3 sentences max), plain text only (no HTML), optimized for AI answer engines like ChatGPT, Gemini, and Google AI Overviews
- Snippets should read as standalone, authoritative answers that an AI could cite directly

Add to the output JSON:
"faq": [
  {
    "question": "How does AI improve contract review efficiency for law firms?",
    "answer": "<p>Full paragraph answer here...</p>",
    "snippet": "AI reduces contract review time by 40-60% through automated clause extraction and risk flagging. Leading firms report recovering $10,000 monthly in previously unbilled time."
  },
  ... (5 total)
]
```

**In the content-generator `index.js`**, update the Webflow CMS creation step to map FAQ fields:

```javascript
// Map FAQ fields to Webflow CMS slugs
const faqFieldData = {};
if (blogPost.faq && blogPost.faq.length >= 5) {
  for (let i = 0; i < 5; i++) {
    const qNum = i + 1;
    // Questions use consistent naming
    faqFieldData[`question-${qNum}`] = blogPost.faq[i].question;
    // Answers use consistent naming
    faqFieldData[`answer-${qNum}`] = blogPost.faq[i].answer;
    // Snippets have inconsistent slugs: snippet1, snippet2, snippet-3, snippet-4, snippet-5
    const snippetSlug = qNum <= 2 ? `snippet${qNum}` : `snippet-${qNum}`;
    faqFieldData[snippetSlug] = blogPost.faq[i].snippet;
  }
}
```

Also populate `blog---reading-time` based on word count: `Math.ceil(blogPost.word_count / 200) + " Min Read"`.

## FIX 2: Blog Post Body Missing Source Links

The newsletter drafts correctly include source URLs in the Radar section. But the blog expansion is being generated WITHOUT those source links embedded in the body content.

### Root cause:

The `buildBlogExpansionPrompt` in `prompts.js` passes the anchor article text to Claude for expansion, but does NOT pass the source URLs from the research findings. Claude generates the blog post without any links because it does not have the URLs available.

### What to change:

**In `workers/content-generator/prompts.js`, update `buildBlogExpansionPrompt`** to include source URLs:

1. Accept the full `topics` object (not just `anchorDraft`) so the function has access to all research source URLs
2. Add the radar source URLs as available references
3. Add this instruction to the prompt:

```
SOURCE LINKS TO EMBED:
The following verified source URLs MUST be embedded as hyperlinks within the blog body
where relevant claims are made. Use <a href="URL" target="_blank">Source Name</a> format.

${topics.anchor.sourceUrl ? `- Anchor source: ${topics.anchor.sourceUrl} (${topics.anchor.source})` : ''}
${topics.radar.map(r => `- ${r.headline}: ${r.sourceUrl} (${r.source})`).join('\n')}

RULES:
- Every factual claim or statistic should link to its source
- Use descriptive anchor text (the publication name or a relevant phrase), NOT "click here" or "source"
- Links must use target="_blank"
- Do NOT fabricate or modify URLs. Use ONLY the URLs provided above.
- If making a claim that is not from the provided sources, do not add a link for it
```

**In `index.js`**, update the call to `buildBlogExpansionPrompt` to pass the full topics object:

```javascript
// Before:
const blogPrompt = buildBlogExpansionPrompt(vertical, draft.anchor, month, year);

// After:
const blogPrompt = buildBlogExpansionPrompt(vertical, draft.anchor, topics, month, year);
```

## After implementing both fixes:

1. Deploy the content-generator worker: `cd workers/content-generator && npx wrangler deploy`
2. Re-run content generation for all 3 verticals to regenerate drafts with FAQ fields and source links
3. Verify in Webflow CMS that all FAQ fields are populated and the blog body contains hyperlinks
4. Check that snippet fields are plain text (no HTML tags) and answers are wrapped in `<p>` tags
