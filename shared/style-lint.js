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

3. ZERO contrastive framing, in ANY syntactic form. All of these are the same banned move:
   - "It is not X, but rather Y"
   - "Not only X, but also Y"
   - The split-sentence version: "That is not an aspiration. It is a standard." (two sentences, same trick, still banned)
   - The semicolon version: "This isn't a tool; it's a teammate."
   - "It's not just X. It's Y."
   HOW TO FIX: delete the negated setup entirely and state what the thing IS, directly.
   Example: "That is not an aspiration. It is an enforceable competency standard." becomes "That sets an enforceable competency standard."
   Example: "Your framework is not behind the curve. It is out of compliance." becomes "Your framework is out of compliance."
   Do NOT fix a contrast by rephrasing the negation. Remove the negation.

CONTENT TO FIX:
${JSON.stringify(contentObj, null, 2)}

Return ONLY the corrected JSON object or array. No markdown, no code fences, no explanation.`;
}

module.exports = {
  lintText,
  lintContent,
  buildRewritePrompt,
  bannedWordsRegex,
  CONTRASTIVE_PATTERNS
};
