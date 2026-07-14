/**
 * Style Lint - mechanical enforcement of the anti-AI writing rules.
 *
 * Prompt instructions alone do not hold. This module detects violations in
 * generated content so the pipeline can force a rewrite pass and flag
 * anything that survives.
 *
 * Detects:
 *   1. Em dashes and en dashes
 *   2. Banned words (verbs, nouns, adjectives, filler)
 *   3. Contrastive framing in ALL its forms, including the split-sentence
 *      dodge: "That is not X. It is Y."
 */

const { BRAND } = require('./config');

// ─── BANNED WORDS ───

const BANNED_WORDS_SOURCE = [
  // Verbs
  'delves?', 'delving', 'leverag(?:es?|ing|ed)', 'fosters?', 'fostering',
  'unleash(?:es|ing|ed)?', 'underscores?', 'underscoring',
  'optimiz(?:es?|ing|ed)', 'streamlin(?:es?|ing|ed)',
  'harness(?:es|ing|ed)?', 'empowers?', 'empowering',
  'unlocks?', 'unlocking', 'elevat(?:es?|ing|ed)',
  'demystif(?:y|ies|ying|ied)', 'embarks?', 'embarking',
  'navigat(?:es?|ing|ed)', 'elucidat(?:es?|ing|ed)',
  'unravel(?:s|ing|ed)?', 'showcas(?:es?|ing|ed)',
  'exemplif(?:y|ies|ying|ied)', 'propel(?:s|ling|led)?',
  'supercharg(?:es?|ing|ed)',
  // Nouns
  'tapestry', 'tapestries', 'landscape(?:s)?', 'realm(?:s)?',
  'beacon(?:s)?', 'cornerstone(?:s)?', 'testament',
  'paradigm(?:s)?', 'metamorphos(?:is|es)', 'plethora',
  'myriad', 'nuance(?:s|d)?', 'ecosystem(?:s)?',
  'labyrinth(?:s)?', 'embodiment', 'trajectory', 'trajectories',
  // Adjectives
  'cutting-edge', 'seamless(?:ly)?', 'robust(?:ly)?',
  'multifaceted', 'pivotal(?:ly)?', 'innovative(?:ly)?',
  'transformative(?:ly)?', 'profound(?:ly)?',
  'paramount', 'next-generation',
  // Filler
  'actually', 'simply', 'merely', 'essentially', 'ultimately',
  'furthermore', 'moreover', 'additionally', 'arguably'
];

function bannedWordsRegex() {
  return new RegExp('\\b(' + BANNED_WORDS_SOURCE.join('|') + ')\\b', 'gi');
}

// ─── CONTRASTIVE FRAMING PATTERNS ───
//
// The rule bans the rhetorical move itself, in every syntactic disguise.
// The split-sentence variant is the one models use to dodge the single-
// sentence rule, so it gets explicit patterns.

const CONTRASTIVE_PATTERNS = [
  {
    name: 'split-sentence contrast ("X is not Y. It is Z.")',
    regex: () => /\b(?:is|are|was|were|it'?s|that'?s|this\s+is)\s+not\s+[^.!?;:]{1,80}[.!?;:]\s*["'“]?\s*(?:It|That|This|They|These|Those)(?:\s+(?:is|are|was|were)|[’']s|[’']re)\b/gi
  },
  {
    name: 'split-sentence contrast with contraction ("It isn\'t X; it\'s Y.")',
    regex: () => /\b(?:isn'?t|aren'?t|wasn'?t|weren'?t)\s+(?:just\s+|only\s+|merely\s+|simply\s+|about\s+)?[^.!?;:]{1,80}[.!?;:]\s*["'“]?\s*(?:it|that|this|they|these|those)(?:\s+(?:is|are|was|were)|[’']s|[’']re)\b/gi
  },
  {
    name: '"not X, but (rather) Y"',
    regex: () => /\b(?:is|are|was|were|isn'?t|aren'?t)\s+not\s+[^.!?;]{1,60},?\s+but\b/gi
  },
  {
    name: '"not X, but rather/instead/also Y"',
    regex: () => /\bnot\b[^.!?;]{0,60},?\s+but\s+(?:rather|instead|also)\b/gi
  },
  {
    name: '"not only X but (also) Y"',
    regex: () => /\bnot\s+only\b[^.!?]{1,100}\bbut\b/gi
  },
  {
    name: '"not just X. It\'s Y" / "not just X; it\'s Y"',
    regex: () => /\bnot\s+just\s+[^.!?;:]{1,80}[.!?;:,]\s*["'“]?\s*(?:it|that|this|they)(?:\s+(?:is|are)|[’']s|[’']re)\b/gi
  },
  {
    name: '"no longer X. It is Y"',
    regex: () => /\bno\s+longer\s+[^.!?;:]{1,80}[.!?;:]\s*["'“]?\s*(?:It|That|This|They)(?:\s+(?:is|are|was|were)|[’']s)\b/gi
  },
  {
    name: '"less about X, more about Y"',
    regex: () => /\bless\s+about\b[^.!?]{1,60}\bmore\s+about\b/gi
  },
  {
    name: '"has never been X. It/The-thing is Y"',
    regex: () => /\b(?:has|have|had)\s+never\s+been\s+[^.!?;:]{1,80}[.!?;:]\s*["'“]?\s*(?:It|That|This|They|The\s+\w+)\s+(?:is|are|was|were)\b/gi
  },
  {
    name: '"is/was never (about) X. It is Y"',
    regex: () => /\b(?:is|are|was|were)\s+never\s+(?:about\s+)?[^.!?;:]{1,80}[.!?;:]\s*["'“]?\s*(?:It|That|This|They|The\s+\w+)\s+(?:is|are|was|were)\b/gi
  },
  {
    name: 'repeated-subject pivot ("The question has never been X. The question is Y.")',
    regex: () => /\b(?:The|A|An|Your|Our|This|That)\s+(\w+)[^.!?;:]{0,60}\b(?:not|never|no\s+longer|isn'?t|aren'?t|wasn'?t)\b[^.!?;:]{0,80}[.!?;:]\s*["'“]?\s*(?:The|Your|Our|This|That)\s+\1\s+(?:is|are|was|were|has|have)\b/gi
  },
  {
    name: '"no longer about X. It is about Y"',
    regex: () => /\bno\s+longer\s+about\s+[^.!?;:]{1,80}[.!?;:,]\s*["'“]?\s*(?:it|that|this|the\s+\w+)(?:\s+(?:is|are)|[’']s)\b/gi
  }
];

// ─── TEXT EXTRACTION ───

const SKIP_KEY_PATTERN = /url|slug|category|token|_id$|^id$/i;

function extractStrings(obj, path = '', out = []) {
  if (typeof obj === 'string') {
    out.push({ path: path || '(root)', text: obj });
  } else if (Array.isArray(obj)) {
    obj.forEach((item, i) => extractStrings(item, `${path}[${i}]`, out));
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (SKIP_KEY_PATTERN.test(key)) continue;
      extractStrings(value, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, ' ');
}

function contextOf(text, index, matchLength) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + matchLength + 40);
  return (start > 0 ? '...' : '') + text.slice(start, end).trim() + (end < text.length ? '...' : '');
}

// ─── LINTING ───

/**
 * Lint a single text string. Returns array of violations.
 */
function lintText(text, fieldPath = '(text)') {
  const clean = stripHtml(text);
  const violations = [];

  // 1. Em / en dashes
  const dashRegex = /[—–]/g;
  for (const m of clean.matchAll(dashRegex)) {
    violations.push({
      rule: 'em/en dash',
      field: fieldPath,
      excerpt: contextOf(clean, m.index, 1)
    });
  }

  // 2. Banned words
  for (const m of clean.matchAll(bannedWordsRegex())) {
    violations.push({
      rule: `banned word: "${m[0]}"`,
      field: fieldPath,
      excerpt: contextOf(clean, m.index, m[0].length)
    });
  }

  // 3. Contrastive framing
  for (const pattern of CONTRASTIVE_PATTERNS) {
    for (const m of clean.matchAll(pattern.regex())) {
      violations.push({
        rule: `contrastive framing: ${pattern.name}`,
        field: fieldPath,
        excerpt: contextOf(clean, m.index, m[0].length)
      });
    }
  }

  return violations;
}

/**
 * Lint an entire content object (newsletter draft, blog post, findings array).
 * Returns { clean, violations }.
 */
function lintContent(obj) {
  const strings = extractStrings(obj);
  const violations = [];
  for (const { path, text } of strings) {
    violations.push(...lintText(text, path));
  }
  return { clean: violations.length === 0, violations };
}

// ─── SEMANTIC JUDGE (LLM pass for paraphrased contrast rhetoric) ───

/**
 * Regex catches known shapes. A model paraphrasing the same rhetorical move
 * ("The question has never been X. The question is Y.") can dodge any fixed
 * pattern list. This judge reads the text semantically and flags the move
 * itself, in any wording. Uses Haiku: cheap, fast, one call per draft.
 *
 * Returns violations in the same shape as lintContent. Fails open: on any
 * API error it returns [] so the pipeline never blocks on the judge.
 */
async function semanticLint(contentObj, env) {
  const strings = extractStrings(contentObj)
    .map(s => ({ path: s.path, text: stripHtml(s.text) }))
    .filter(s => s.text.trim().split(/\s+/).length >= 12); // only prose-length fields

  if (strings.length === 0) return [];

  const numbered = strings.map((s, i) => `[${i}] (${s.path}): ${s.text}`).join('\n\n');

  const prompt = `You are a style auditor with a HIGH PRECISION requirement. Find instances of CONTRAST RHETORIC in the numbered passages below. A false flag is worse than a miss: when in doubt, do NOT flag.

Contrast rhetoric requires BOTH of these, together:
(a) an explicit negation or dismissal word (not, never, isn't, no longer, neither, forget, stop), AND
(b) a pivot to a contrasting assertion of what the thing really is.

Examples that COUNT (negation + pivot):
- "It is not X, but rather Y"
- "That is not an aspiration. It is a standard."
- "This isn't a tool; it's a teammate."
- "The question has never been which platform to buy. The question is how many parts of your practice you are willing to redesign."
- "Forget X. The real issue is Y."
- "Stop asking A. Start asking B."
- "The Calendar Is Not a Suggestion" (headline negation implying the pivot)

Examples that DO NOT COUNT (do not flag these or anything like them):
- "A written framework provides proof." (plain assertion, no negation)
- "These laws convert internal best practices into binding compliance obligations." (plain assertion)
- "Firms are using these tools. Many are not documenting how." (factual observation; the negation reports a fact, it does not dismiss a framing to pivot)
- "The firm did not respond to requests." (factual negation)
- "Scrambling later is harder than building now." (comparison, no negation-pivot)
- "The firms that handle this well are the ones building policies. The ones that wait are creating exposure." (comparison of two groups, no dismissal)
- Ordinary use of "but"

PASSAGES:
${numbered}

Return ONLY a JSON array. For each violation: {"index": <passage number>, "excerpt": "<the exact offending sentence or sentence pair, verbatim>"}. Return [] if there are none. No markdown, no explanation.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      console.warn(`Semantic lint call failed (${res.status}), continuing with regex-only`);
      return [];
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const flagged = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(flagged)) return [];

    // Mechanical precision gate: a contrast pivot requires an explicit
    // negation or dismissal cue. Judge flags without one are false positives
    // by definition, so they are dropped regardless of the judge's opinion.
    const NEGATION_CUE = /\b(?:not|never|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t|won'?t|can'?t|no\s+longer|neither|nor|forget|stop\s+(?:asking|thinking|treating)|rather|instead)\b/i;

    return flagged
      .filter(f => typeof f.index === 'number' && strings[f.index] && f.excerpt)
      .filter(f => NEGATION_CUE.test(String(f.excerpt)))
      .map(f => ({
        rule: 'contrastive framing (semantic judge)',
        field: strings[f.index].path,
        excerpt: String(f.excerpt).slice(0, 200)
      }));
  } catch (err) {
    console.warn(`Semantic lint error: ${err.message}, continuing with regex-only`);
    return [];
  }
}

/**
 * Full lint: regex patterns plus semantic judge, deduplicated by field.
 * Returns { clean, violations } like lintContent.
 */
async function lintContentDeep(contentObj, env) {
  const regexResult = lintContent(contentObj);
  const semantic = await semanticLint(contentObj, env);

  // Drop semantic hits that regex already covers on the same field
  const regexFields = new Set(regexResult.violations
    .filter(v => v.rule.startsWith('contrastive'))
    .map(v => v.field));
  const extra = semantic.filter(v => !regexFields.has(v.field));

  const violations = [...regexResult.violations, ...extra];
  return { clean: violations.length === 0, violations };
}

// ─── REWRITE PROMPT ───

/**
 * Build a surgical rewrite prompt. Claude gets the content back with the
 * exact violations and must return the same JSON with only those sentences
 * fixed.
 */
function buildRewritePrompt(contentObj, violations) {
  const violationList = violations.map((v, i) =>
    `${i + 1}. [${v.rule}] in field "${v.field}":\n   "${v.excerpt}"`
  ).join('\n');

  return `You produced the JSON content below. It contains style violations that are contractually banned. Fix ONLY the violating sentences. Everything else stays word-for-word identical. Same JSON structure, same keys, same URLs, same facts.

VIOLATIONS TO FIX:
${violationList}

THE RULES (non-negotiable):

1. ZERO em dashes or en dashes. Use commas, colons, or parentheses.

2. NEVER use these words or variants: ${BRAND.voice.antiAI.bannedVerbs}, ${BRAND.voice.antiAI.bannedNouns}, ${BRAND.voice.antiAI.bannedAdjectives}, ${BRAND.voice.antiAI.bannedFiller}

3. ZERO contrastive framing, in ANY syntactic form. The banned move is: negate or dismiss one thing to assert another. All of these are the same banned move:
   - "It is not X, but rather Y"
   - "Not only X, but also Y"
   - The split-sentence version: "That is not an aspiration. It is a standard." (two sentences, same trick, still banned)
   - The semicolon version: "This isn't a tool; it's a teammate."
   - "It's not just X. It's Y."
   - The paraphrased version: "The question has never been X. The question is Y." / "The point was never X. The point is Y." / "Forget X. The real issue is Y." / "Stop asking A. Start asking B."
   HOW TO FIX: delete the negated or dismissed setup entirely and state the assertion, directly.
   Example: "That is not an aspiration. It is an enforceable competency standard." becomes "That sets an enforceable competency standard."
   Example: "Your framework is not behind the curve. It is out of compliance." becomes "Your framework is out of compliance."
   Example: "The question has never been which platform to buy. The question is how many parts of your practice you are willing to redesign around the tool you already have." becomes "The question is how many parts of your practice you are willing to redesign around the tool you already have."
   Do NOT fix a contrast by rephrasing the negation or dismissal. Remove it. If the result reads as a bare assertion, good: that is the goal.

CONTENT TO FIX:
${JSON.stringify(contentObj, null, 2)}

Return ONLY the corrected JSON object or array. No markdown, no code fences, no explanation.`;
}

module.exports = {
  lintText,
  lintContent,
  lintContentDeep,
  semanticLint,
  buildRewritePrompt,
  bannedWordsRegex,
  CONTRASTIVE_PATTERNS
};
