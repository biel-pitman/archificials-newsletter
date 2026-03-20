# Archificials Newsletter Pipeline - Complete Technical Overview

## What This Is

Automated newsletter pipeline for Archificials' 4 vertical Beehiiv publications.
Sibling repo to `archificials-assessments`. Same stack, same patterns.

## Architecture

```
Cron (1st/10th) -> Research Engine Worker -> Brave Search + Claude API
                                          -> Airtable (findings)
                                          -> R2 (raw JSON)
                                          -> Email to Biel (digest)

Biel reviews   -> Content Generator Worker -> Claude API (newsletter draft)
                                           -> Claude API (blog expansion)
                                           -> Airtable (drafts)
                                           -> R2 (draft JSON)
                                           -> Email to Biel (review)

Biel approves  -> Paste into Beehiiv + Webflow CMS (manual for now)
```

## Stack

| Component | Tool | Notes |
|-----------|------|-------|
| Compute | Cloudflare Workers | Same account as assessments |
| AI | Claude API (Sonnet) | Research analysis + content generation |
| Search | Brave Search API | 5 queries per vertical per run |
| Database | Airtable | Shared base: appB7PmFnNvV3085q |
| Storage | Cloudflare R2 | Bucket: archificials-newsletter |
| Email | Resend | Same sender domain as assessments |
| Newsletter | Beehiiv | 3 active publications (4th pending upgrade) |
| Blog | Webflow CMS | archificials.com/thoughts |

## Repository Structure

```
archificials-newsletter/
|-- workers/
|   |-- research-engine/       # Cron-triggered (1st + 10th monthly)
|   |   |-- index.js           # Main worker: Brave + Claude + Airtable + R2 + Resend
|   |   |-- prompts.js         # Research analysis + search query builders
|   |   +-- wrangler.toml      # Cron config + R2 binding
|   |-- content-generator/     # HTTP-triggered after research review
|   |   |-- index.js           # Main worker: Claude draft + blog + Airtable + R2 + Resend
|   |   |-- prompts.js         # Newsletter drafting + blog expansion prompts
|   |   +-- wrangler.toml      # R2 binding
|   +-- metrics-collector/     # Optional: Beehiiv API metrics
|       |-- index.js           # Placeholder (needs Beehiiv API key)
|       +-- wrangler.toml      # Monthly cron
|-- shared/
|   |-- config.js              # Vertical configs, brand voice, Airtable schema
|   |-- airtable.js            # CRUD client (same pattern as assessments)
|   +-- email-templates.js     # Research digest + draft review emails via Resend
|-- scripts/
|   |-- test-research.js       # Local test for research engine
|   +-- test-content.js        # Local test for content generator
|-- CLAUDE.md                  # This file
|-- package.json
+-- .gitignore
```

## Verticals

| Vertical | Newsletter Name | Beehiiv Pub | Assessment URL | Active |
|----------|----------------|-------------|----------------|--------|
| law | Your Legal AI Brief | pub_XXXXX | archificials.com/assessment/law | Yes |
| architecture | Your AI Blueprint | pub_XXXXX | archificials.com/assessment/architecture | Yes |
| education | Your AI Lecture | pub_XXXXX | archificials.com/assessment/education | Yes |
| real-estate | Your AI Deal Flow | TBD | TBD | No (pending Beehiiv upgrade) |

## Newsletter Structure (All Verticals)

Each edition has 4 sections:

1. **The Anchor** (400-600 words): Deep-dive on one topic. Links to blog.
2. **The Radar** (100-150 words): 2-3 short news items with sources.
3. **The Quick Win** (80-120 words): Actionable tool or tip. "Try this Monday."
4. **The Close** (50-80 words): Personal note from Biel + Assessment CTA + Contact CTA.

Cadence: Bi-weekly (every other Tuesday).

## Three-Tier CTA Strategy

Every newsletter and blog post carries 3 CTAs at different commitment levels:

1. **Tier 1: Read More** (end of Anchor) - Blog link
2. **Tier 2: AI Readiness Assessment** (The Close + blog footer) - The conversion engine
3. **Tier 3: Book a Call** (secondary in Close) - For prospects already sold

The Assessment is the primary conversion point. It feeds into the existing
archificials-assessments pipeline: Worker scores -> Airtable -> Report generation -> Meeting.

## Worker Details

### Research Engine (workers/research-engine/)

**Trigger:** Cron at 0 8 1 * * and 0 8 10 * * (8am UTC, 1st and 10th)
**Also:** POST /trigger for manual runs

Pipeline per vertical:
1. Build 5 Brave Search queries from vertical keywords
2. Run queries in parallel, deduplicate results by URL
3. Fetch previous edition topics from Airtable (avoid repeats)
4. Send search results + context to Claude Sonnet for analysis
5. Claude returns 8-10 structured findings as JSON
6. Store findings in Airtable (Newsletter Research table)
7. Store raw JSON in R2 at newsletter/{slug}/{YYYY-MM}/edition-{N}/research.json
8. Email Biel a digest with top findings per vertical

### Content Generator (workers/content-generator/)

**Trigger:** POST /generate (all verticals) or POST /generate/:vertical

Pipeline per vertical:
1. Fetch latest research from Airtable
2. Select topics (manual picks from Biel's reply, or top-ranked defaults)
3. Fetch previous edition for continuity
4. Call Claude Sonnet with master drafting prompt -> newsletter JSON
5. Call Claude Sonnet with blog expansion prompt -> blog post JSON
6. Store both in Airtable (Newsletter Drafts table) and R2
7. Mark research record as consumed
8. Email Biel the full draft for review

### Metrics Collector (workers/metrics-collector/)

**Status:** Placeholder. Requires Beehiiv API key.
**Trigger:** Cron monthly on the 28th.

## Airtable Schema

Base: appB7PmFnNvV3085q (shared with archificials-assessments)

### Newsletter Research table
- vertical (text): law, architecture, education, real-estate
- month (text): "March 2026"
- edition_number (number): 1 or 2
- findings_json (long text): JSON array of findings
- findings_count (number)
- status (single select): generated, consumed, archived
- created (date)

### Newsletter Drafts table
- vertical (text)
- edition_number (number)
- month (text)
- subject_line (text)
- newsletter_json (long text): full newsletter draft as JSON
- blog_json (long text): blog expansion as JSON
- research_record_id (text): link to source research
- status (single select): drafted, approved, published, archived
- created (date)

### Newsletter Metrics table (optional)
- vertical (text)
- edition (number)
- open_rate (percent)
- click_rate (percent)
- replies (number)
- assessment_clicks (number)
- unsubscribe_rate (percent)
- date (date)

## Deployment

### Prerequisites
- Cloudflare account (same as assessments)
- R2 bucket: `archificials-newsletter`
- Airtable tables created in shared base
- DNS/domain configured for Resend sending

### Deploy Commands
```bash
# Install wrangler globally if not already
npm install -g wrangler

# Create R2 bucket
npx wrangler r2 bucket create archificials-newsletter

# Deploy each worker
cd workers/research-engine && npx wrangler deploy
cd ../content-generator && npx wrangler deploy
cd ../metrics-collector && npx wrangler deploy

# Set secrets (same keys used across all workers)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put AIRTABLE_API_KEY
npx wrangler secret put RESEND_API_KEY
```

### Secrets Required

| Secret | Workers | Notes |
|--------|---------|-------|
| ANTHROPIC_API_KEY | research, content | Same key as assessments |
| BRAVE_API_KEY | research | Same key as report-orchestrator |
| AIRTABLE_API_KEY | research, content, metrics | Same key as assessments |
| RESEND_API_KEY | research, content, metrics | Same key as assessments |
| BEEHIIV_API_KEY | metrics | Optional, for automated metrics |

## Brand Voice Rules (Embedded in All Prompts)

Inspired by Stefan Sagmeister's design philosophy:
- Touch the heart, then the mind
- Beauty is functional
- Risk earns attention
- Human over corporate
- Substance over spectacle

Writing rules:
- **Never use em dashes** (commas, colons, or parentheses instead)
- Write for partners, founders, directors (not junior staff)
- Lead with specifics ("50% faster" not "significantly improved")
- Name tools, cite sources, reference real firms
- Write at 10th-grade reading level
- Every paragraph earns the next one

## Tone Per Vertical

- **Law:** Authoritative, compliance-aware, substance-first
- **Architecture:** Peer-to-peer, design-forward, practically creative (Biel is an architect)
- **Education:** Warm, mission-driven, grounded (respect budget constraints)
- **Real Estate:** Numbers-driven, ROI-obsessed, market-aware

## Development

```bash
# Run research engine locally
cd workers/research-engine && npx wrangler dev

# Trigger research manually
curl -X POST http://localhost:8787/trigger

# Run content generator locally
cd workers/content-generator && npx wrangler dev

# Generate for single vertical
curl -X POST http://localhost:8787/generate/law

# Generate for all verticals with manual topic selections
curl -X POST http://localhost:8787/generate \
  -H "Content-Type: application/json" \
  -d '{"selections": {"law": [0, 2, 4], "architecture": [1, 3, 5]}}'
```

## Key Technical Notes

- **Shared imports**: Workers import from ../../shared/ using relative paths.
  Wrangler resolves these at build time. If bundling issues occur, copy shared
  modules into each worker directory.
- **Claude model**: Both workers use claude-sonnet-4-20250514 (same as report-orchestrator)
- **JSON parsing**: Claude responses are parsed with regex fallback for markdown-wrapped JSON
- **Rate limiting**: Brave Search free tier allows 1 query/second.
  Research engine runs queries sequentially with implicit delay from await.
- **Error handling**: Each vertical runs independently. One failure does not block others.
- **R2 key pattern**: newsletter/{vertical}/{YYYY-MM}/edition-{N}/{research|draft}.json
