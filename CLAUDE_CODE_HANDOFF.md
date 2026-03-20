# Claude Code Handoff: archificials-newsletter Pipeline

## Context

You are picking up a project started in a Cowork session. The full codebase has been scaffolded and is ready to be initialized as a GitHub repo, deployed to Cloudflare Workers, and tested end-to-end. Everything must be fully operational before April 1, 2026.

## What This Is

An automated newsletter pipeline for Archificials (AI consulting agency, 4 verticals). It is a sibling repo to `archificials-assessments` (already live at github.com/biel-pitman/archificials-assessments). Same stack, same patterns: Cloudflare Workers, Claude API, Brave Search, Airtable, R2, Resend.

The pipeline automates: research > topic selection > newsletter drafting > blog expansion > email to Biel for review. Biel's only manual steps are reviewing drafts and pasting into Beehiiv + Webflow.

## Step-by-Step Instructions

Do these in order. Each step depends on the previous one.

### PHASE 1: Repository Setup

**Step 1.** Create a new directory and initialize git:

```bash
mkdir archificials-newsletter && cd archificials-newsletter
git init
```

**Step 2.** Extract the archive from the Cowork outputs folder. The archive path on the user's machine will be wherever their Cowork outputs folder is. Ask the user where the file `archificials-newsletter.tar.gz` was downloaded to, then:

```bash
tar -xzf /path/to/archificials-newsletter.tar.gz -C .
```

**Step 3.** Verify the structure:

```bash
find . -type f | sort
```

Expected output:

```
./.gitignore
./CLAUDE.md
./package.json
./scripts/test-content.js
./scripts/test-research.js
./shared/airtable.js
./shared/config.js
./shared/email-templates.js
./workers/content-generator/index.js
./workers/content-generator/prompts.js
./workers/content-generator/wrangler.toml
./workers/metrics-collector/index.js
./workers/metrics-collector/wrangler.toml
./workers/research-engine/index.js
./workers/research-engine/prompts.js
./workers/research-engine/wrangler.toml
```

**Step 4.** Create the GitHub repo and push:

```bash
git add .
git commit -m "Initial scaffold: research engine, content generator, metrics collector"
gh repo create biel-pitman/archificials-newsletter --public --source=. --push
```

### PHASE 2: Cloudflare Infrastructure

**Step 5.** Make sure wrangler is installed and authenticated:

```bash
npm install -g wrangler
npx wrangler whoami
```

If not logged in:

```bash
npx wrangler login
```

**Step 6.** Create the R2 bucket:

```bash
npx wrangler r2 bucket create archificials-newsletter
```

**Step 7.** Deploy the research engine worker:

```bash
cd workers/research-engine
npx wrangler deploy
cd ../..
```

**Step 8.** Deploy the content generator worker:

```bash
cd workers/content-generator
npx wrangler deploy
cd ../..
```

**Step 9.** Deploy the metrics collector worker:

```bash
cd workers/metrics-collector
npx wrangler deploy
cd ../..
```

### PHASE 3: Secrets

All workers need secrets set. These are the same API keys already used in `archificials-assessments`. Ask the user for the values if needed, or reference their existing Cloudflare dashboard.

**Step 10.** Set secrets on research-engine:

```bash
cd workers/research-engine
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put AIRTABLE_API_KEY
npx wrangler secret put RESEND_API_KEY
cd ../..
```

**Step 11.** Set secrets on content-generator:

```bash
cd workers/content-generator
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AIRTABLE_API_KEY
npx wrangler secret put RESEND_API_KEY
cd ../..
```

**Step 12.** Set secrets on metrics-collector:

```bash
cd workers/metrics-collector
npx wrangler secret put AIRTABLE_API_KEY
npx wrangler secret put RESEND_API_KEY
cd ../..
```

### PHASE 4: Airtable Setup

**Step 13.** Create three new tables in the existing shared Airtable base (appB7PmFnNvV3085q). This can be done via the Airtable web UI or API.

**Table 1: Newsletter Research**

| Field | Type |
|-------|------|
| vertical | Single line text |
| month | Single line text |
| edition_number | Number |
| findings_json | Long text |
| findings_count | Number |
| status | Single select (generated, consumed, archived) |
| created | Date |

**Table 2: Newsletter Drafts**

| Field | Type |
|-------|------|
| vertical | Single line text |
| edition_number | Number |
| month | Single line text |
| subject_line | Single line text |
| newsletter_json | Long text |
| blog_json | Long text |
| research_record_id | Single line text |
| status | Single select (drafted, approved, published, archived) |
| created | Date |

**Table 3: Newsletter Metrics**

| Field | Type |
|-------|------|
| vertical | Single line text |
| edition | Number |
| open_rate | Percent |
| click_rate | Percent |
| replies | Number |
| assessment_clicks | Number |
| unsubscribe_rate | Percent |
| date | Date |

### PHASE 5: Fix Shared Imports

**Step 14. CRITICAL.** The workers import from `../../shared/` using relative paths. Cloudflare Workers with wrangler may not resolve these correctly depending on the bundling mode. You need to verify this works. Test by running:

```bash
cd workers/research-engine
npx wrangler dev
```

If you get import errors about `../../shared/config`, the fix is to switch from `import` to inlined modules, OR configure wrangler.toml to use a custom build step. The recommended approach:

**Option A (simplest):** Add a build command to each wrangler.toml that uses esbuild to bundle everything:

Add to each worker's wrangler.toml:

```toml
[build]
command = "npx esbuild index.js --bundle --outfile=dist/index.js --format=esm --platform=node"

[rules]
type = "ESModule"
globs = ["**/*.js"]
```

And change `main` to `dist/index.js`.

**Option B:** Copy shared modules into each worker directory and update imports to local paths.

The user (Biel) has experience with this from archificials-assessments. Ask him how shared modules are handled there and match the pattern.

### PHASE 6: Testing

**Step 15.** Health check both deployed workers:

```bash
curl https://newsletter-research-engine.archificials.workers.dev/health
curl https://newsletter-content-generator.archificials.workers.dev/health
```

Expected: `{"status":"ok","worker":"research-engine"}` and similar.

**Step 16.** Test research engine locally with real API keys:

```bash
ANTHROPIC_API_KEY=sk-ant-... BRAVE_API_KEY=BSA... node scripts/test-research.js law
```

This runs one vertical through the full research pipeline (Brave Search + Claude analysis) and prints findings to stdout. Does NOT write to Airtable.

**Step 17.** Test content generator locally with mock data:

```bash
ANTHROPIC_API_KEY=sk-ant-... node scripts/test-content.js law
```

This uses mock research findings to test the drafting pipeline and prints the full newsletter + blog expansion to stdout.

**Step 18.** Trigger a full production research run:

```bash
curl -X POST https://newsletter-research-engine.archificials.workers.dev/trigger
```

This will run all 3 active verticals through Brave Search + Claude analysis, store findings in Airtable + R2, and email Biel a research digest.

**Step 19.** After Biel reviews the research email, trigger content generation:

```bash
curl -X POST https://newsletter-content-generator.archificials.workers.dev/generate
```

This generates newsletter drafts + blog expansions for all verticals and emails them to Biel.

### PHASE 7: Commit and Tag

**Step 20.** After everything works:

```bash
git add .
git commit -m "Pipeline operational: research engine + content generator deployed"
git tag v1.0.0
git push origin main --tags
```

## Known Issues to Watch For

1. **Shared imports**: See Step 14. This is the most likely thing that needs fixing.

2. **Worker names**: The wrangler.toml files use names like `newsletter-research-engine`. If these conflict with existing workers on Biel's Cloudflare account, rename them.

3. **R2 bucket binding**: The wrangler.toml references `bucket_name = "archificials-newsletter"`. This must match the bucket created in Step 6 exactly.

4. **Resend sender domain**: The email templates use `pipeline@archificials.com` as the sender. The archificials.com domain must be verified in Resend. If it is already verified (from the assessments pipeline), this should work. If not, update the `from` field in `shared/email-templates.js`.

5. **Cron schedule**: The research engine fires on the 1st and 10th at 8am UTC (2am CT). If Biel wants different timing, update the `crons` array in `workers/research-engine/wrangler.toml`.

6. **Claude model**: Both workers use `claude-sonnet-4-20250514`. If this model string is outdated or unavailable, update it in both `workers/research-engine/index.js` and `workers/content-generator/index.js`.

7. **Beehiiv publication IDs**: The `shared/config.js` has placeholder `pub_XXXXX` values. These need to be replaced with actual Beehiiv publication IDs if the metrics collector is activated.

## Architecture Reference

Read the full `CLAUDE.md` in the repo root for complete technical documentation including: Airtable schema, R2 key patterns, prompt architecture, worker flows, brand voice rules, and vertical-specific configurations.

## Brand Voice Rules (Apply to ALL Generated Content)

- Never use em dashes. Use commas, colons, or parentheses instead.
- Inspired by Stefan Sagmeister: conceptual depth, human warmth, substance over decoration.
- Write for partners, founders, and directors, not junior staff.
- Lead with specifics ("50% faster" not "significantly improved").
- Every newsletter includes 3-tier CTAs: blog link, AI readiness assessment, book a call.
- Assessment URLs: archificials.com/assessment/law, /architecture, /education

## Owner

Biel Pitman, biel@archificials.com
Founder & Principal, Archificials (Austin, TX)
