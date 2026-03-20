# Newsletter Pipeline V2 Fixes

All of these need to be implemented before April 1st launch. Organized by priority.

## CRITICAL: Source Link Validation (Credibility Killer)

The content generator is producing broken or hallucinated source URLs. Examples from the current drafts:

- Law: `https://www.thomsonreuters.com/legal-executive-institute` (generic domain, not the actual article)
- Law: `https://www.joneswalker.com` (just the homepage, not the article about zero-touch contracting)
- Architecture: `https://www.ribajournal.com` (homepage, not the RIBA article about 4 AI areas)
- Architecture: `https://www.teslaoutsourcing.com` (wrong domain entirely, actual source was teslaoutsourcingservices.com)
- Education: `https://educationweek.com` (homepage, not the Copilot article)
- Education: `https://ednext.org` (homepage, not the poll article)

### Root Cause
The research engine passes full source URLs from Brave Search results to Claude, but the content generator's drafting prompt does not enforce that Claude must use the EXACT URLs from the research findings. Claude is "summarizing" the URLs into generic domain references.

### Fix Required
Two changes needed in `workers/content-generator/`:

**Fix A: Pass exact source URLs in the drafting prompt.** In `prompts.js`, the `buildDraftingPrompt` function passes topics but the radar items only include `source` (publication name) and `sourceUrl`. The prompt must explicitly instruct Claude: "Use the EXACT source URLs provided. Do not modify, shorten, or generalize URLs. Every source link must be a full URL that resolves to the specific article."

**Fix B: Add URL validation step.** After Claude generates the draft, before storing it, the content-generator worker should:
1. Extract all URLs from the draft JSON
2. Run a HEAD request (or fetch) on each URL
3. If any URL returns 4xx or 5xx, flag it in the draft email to Biel as "[UNVERIFIED LINK]"
4. Store a `links_validated` boolean in Airtable

This does NOT need to block the draft from being generated. It needs to flag broken links so Biel sees them before publishing.

## CRITICAL: Remove "Subject:" Label from Draft Display

In all three draft emails, the subject line renders as:

```
Subject: Clients now choose firms based on AI adoption
```

The word "Subject:" is showing as visible text in the email template. This is a display bug in `shared/email-templates.js` in the `draftReviewEmail` function. The `<h2>` tag that renders the subject line literally says `Subject: ${draft.subject_line}`. Change this to just show the subject line value, or label it differently so it's clear this is the subject line FOR Beehiiv, not part of the newsletter content itself. Suggested fix:

```html
<p style="color: #666; font-size: 12px; margin-bottom: 4px;">SUBJECT LINE FOR BEEHIIV:</p>
<h2 style="color: #1a1a2e; font-size: 18px; margin-top: 0;">
  ${draft.subject_line}
</h2>
```

## CRITICAL: Remove Biel's Name from CTAs

Two of the three drafts say "Book a 15-minute call with Biel" as the direct contact CTA. This should never use Biel's first name in outgoing newsletters. Fix in TWO places:

**Fix A:** In `shared/config.js`, change all `cta.contact` values:
- Law: `"Book a 15-minute call with Biel"` -> `"Book a 15-minute consultation"`
- Architecture: `"Book a 15-minute call with Biel"` -> `"Book a 15-minute consultation"`
- Education is already correct: `"Schedule a free demo for your admin team"`

**Fix B:** Add a writing rule to the drafting prompt in `workers/content-generator/prompts.js`:
`"Never mention Biel by name in CTAs. Use 'our team', 'Archificials', or impersonal phrasing."`

## CRITICAL: "Read the full analysis on our blog" Has No Link

In all three drafts, the Anchor section ends with "Read the full analysis on our blog" but it is plain text with no hyperlink. The blog post does not exist yet because the pipeline does not create it automatically.

### Fix Required: Automate Blog Post Creation via Webflow CMS API

The content-generator worker already generates blog expansion JSON (stored in Airtable as `blog_json`). A new step needs to be added to the pipeline that:

1. Takes the `blog_json` output (which contains `seo_title`, `meta_description`, `slug`, `category`, `html_body`)
2. Creates a draft CMS item in Webflow via their CMS API
3. Returns the live blog URL
4. Inserts that URL into the newsletter draft's anchor `blog_cta` field

The Webflow MCP tools are available in this session (`mcp__7a2f01d1...`). Use them to:
- Discover the CMS collection ID for the blog/thoughts section
- Understand the field schema (title, slug, body, category, author, meta)
- Create a helper function in the content-generator that POSTs to Webflow CMS

The blog post should be created as a DRAFT in Webflow (not auto-published), so Biel can review it alongside the newsletter. But the URL should be predictable (archificials.com/thoughts/{slug}) so it can be embedded in the newsletter draft.

## CRITICAL: Automate Beehiiv Newsletter Creation

Currently the pipeline generates the newsletter and emails it to Biel as text to "paste into Beehiiv." This is manual and defeats the purpose. The content-generator should:

1. Use the Beehiiv API to create a draft post in the correct publication
2. Set the subject line, preview text, and HTML content
3. Schedule it for the next Tuesday at 7:00 AM CT (or leave as draft)
4. Include the Beehiiv draft link in the email to Biel so he can review it in Beehiiv's editor

Beehiiv API endpoint: `POST /v2/publications/{pub_id}/posts`

This requires:
- The actual Beehiiv publication IDs (replace `pub_XXXXX` in config.js)
- BEEHIIV_API_KEY secret (already set on the workers per Biel's note)
- An HTML template that wraps the newsletter JSON into Beehiiv-compatible HTML

## HIGH: Build Inbound Email Reply Flow

When Biel replies to the research digest email, it should trigger the content generator. Currently `pipeline@archificials.com` cannot receive mail (the reply bounced).

### Options (pick one):

**Option A: Gmail Integration (recommended, since Gmail MCP is available)**
Instead of parsing inbound email to pipeline@, use a Gmail webhook/poll:
1. Biel replies to the digest email from biel@archificials.com
2. A scheduled check (or Gmail push notification) watches for replies to "Newsletter Research Ready" subject lines
3. Parse the reply body for topic selections (format: `law: 1,3 | architecture: 2,4 | education: 1,2`)
4. Call the content-generator `/generate` endpoint with those selections

**Option B: Resend Inbound Webhook**
Configure a Resend inbound webhook on a subdomain (e.g., `inbound.archificials.com`) that receives replies and forwards the parsed content to the content-generator worker.

**Option C (simplest for now):** Change the research digest email to include direct "approve" buttons that are actually links to the content-generator endpoint:
```html
<a href="https://newsletter-content-generator.../generate?selections=defaults&token=HMAC">
  Approve defaults and generate drafts
</a>
```
This uses the same HMAC pattern as the assessment report generation.

Option C is the fastest to implement and mirrors Biel's existing workflow with the assessment reports.

## MEDIUM: Blog Expansion Should Be in Draft Email

The draft email currently says "Blog expansion is also ready and attached to the Airtable record. Paste it into Webflow CMS." This is bad UX. If the Webflow CMS automation (above) is implemented, this message should change to:

"Blog post draft created in Webflow: [link to Webflow CMS editor for this post]"

If Webflow automation is not yet ready, at minimum include the blog post content in the draft email itself (as a second section below the newsletter preview), so Biel does not have to go to Airtable to find it.

## MEDIUM: Content Quality Notes

From reviewing the actual drafts:

- **Law draft is strong.** Good use of LegalWeek 2026 as a hook, specific data points (Gibson Dunn 40%, 3.9x ROI), appropriate tone.
- **Architecture draft uses em dashes.** Multiple instances: "this isn't a death sentence. It's a blueprint" should not use contractions with apostrophes that look like em dashes in some renderers. More importantly: "here's what the headlines miss" uses a contraction that's fine, but scan for any actual em dashes in the output. Add explicit check.
- **Education draft is the strongest.** Ohio mandate is a great hook, specific numbers (127 days, 3,900 schools, $169M grants), actionable Quick Win.
- **All drafts**: The "Read the full analysis on our blog" line feels like an orphan without a link. Once blog automation is live this resolves itself.

## LOW: Edition Numbering

All three emails say "Edition 2" even though these are the first real editions. The cron calculation uses `day <= 15 ? 1 : 2`, so because today is March 20, it assigned Edition 2. For the April 1st launch, the first real edition should be Edition 1. Consider either:
- Resetting the counter in Airtable
- Adding an `edition_offset` in config
- Or just accepting that the internal edition number does not matter to subscribers (they never see it)
