/**
 * Archificials Newsletter Pipeline - Vertical Configuration
 *
 * Mirrors the pattern from archificials-assessments/verticals/config.js
 * Each vertical defines: newsletter metadata, tone guide, research sources,
 * search keywords, CTA text, and assessment URLs.
 */

const VERTICALS = {
  law: {
    name: 'Your Legal AI Brief',
    slug: 'law',
    active: true,
    beehiivPubId: null, // TODO: Replace with actual Beehiiv publication ID
    assessmentUrl: 'https://www.archificials.com/assessment/law',
    blogCategory: 'legal-ai',
    blogBaseUrl: 'https://www.archificials.com/thoughts',

    tone: {
      summary: 'Authoritative, compliance-aware, substance-first. Write like a well-informed colleague, not a vendor.',
      guidelines: [
        'Reference case law implications, regulatory shifts, and efficiency metrics',
        'Avoid hype and unsubstantiated claims',
        'These are managing partners who bill at $500+/hr, respect their intelligence',
        'Lead with data: percentages, dollar amounts, time savings',
        'Acknowledge risks and trade-offs, never oversell'
      ],
      avoid: [
        'Startup jargon ("disrupt", "game-changer", "revolutionary")',
        'Vague claims without supporting data',
        'Overly casual tone',
        'Em dashes (use commas, colons, or parentheses instead)'
      ]
    },

    research: {
      sources: [
        'National Law Review',
        'Bloomberg Law',
        'Clio Blog',
        'Wolters Kluwer',
        'ABA Journal',
        'Artificial Lawyer',
        'Thomson Reuters Legal',
        'Law.com'
      ],
      keywords: [
        'legal AI 2026',
        'contract automation AI',
        'AI governance law firm',
        'legal tech tools',
        'CoCounsel updates',
        'e-discovery AI',
        'AI ethics legal profession',
        'law firm AI adoption',
        'CLM automation',
        'legal research AI tools'
      ]
    },

    cta: {
      assessment: 'Take the free 5-minute AI Readiness Assessment for Law Firms',
      assessmentFrame: 'See how your firm compares across four dimensions of AI readiness.',
      blog: 'Read the full analysis on our blog',
      contact: 'Book a 15-minute consultation',
      contactUrl: 'https://calendly.com/archificials/consultation'
    }
  },

  architecture: {
    name: 'Your AI Blueprint',
    slug: 'architecture',
    active: true,
    beehiivPubId: null, // TODO: Replace with actual Beehiiv publication ID
    assessmentUrl: 'https://www.archificials.com/assessment/architecture',
    blogCategory: 'architecture-ai',
    blogBaseUrl: 'https://www.archificials.com/thoughts',

    tone: {
      summary: 'Peer-to-peer, design-forward, practically creative. Biel is an architect, so this speaks the language.',
      guidelines: [
        'Reference design intent, documentation friction, BIM workflows, rendering pipelines',
        'Sagmeister energy lives strongest here: provocative, conceptual, human',
        'Use "we" and "our" when referencing architecture practice',
        'Be specific about tools: name them, describe what they actually do',
        'Acknowledge the creative tension between AI and design authorship'
      ],
      avoid: [
        'Talking down to architects about their own profession',
        'Overpromising AI capabilities in design (AI assists, it does not design)',
        'Generic tech language that ignores AEC-specific context',
        'Em dashes (use commas, colons, or parentheses instead)'
      ]
    },

    research: {
      sources: [
        'RIBA Journal',
        'ArchDaily',
        'Dezeen',
        'AEC Magazine',
        'Chaos Blog',
        'Autodesk Blog',
        'AIA publications',
        'Archinect'
      ],
      keywords: [
        'AI architecture design 2026',
        'BIM automation AI',
        'AI rendering architecture',
        'generative design AEC',
        'computational design tools',
        'digital twin architecture',
        'AI documentation architecture',
        'Revit AI plugins',
        'energy modeling AI',
        'site analysis AI tools'
      ]
    },

    cta: {
      assessment: 'Take the free AI Readiness Assessment for Architecture Firms',
      assessmentFrame: '5 minutes to understand where AI fits in your practice.',
      blog: 'Read the full analysis on our blog',
      contact: 'Book a 15-minute consultation',
      contactUrl: 'https://calendly.com/archificials/consultation'
    }
  },

  education: {
    name: 'Your AI Lecture',
    slug: 'education',
    active: true,
    beehiivPubId: null, // TODO: Replace with actual Beehiiv publication ID
    assessmentUrl: 'https://www.archificials.com/assessment/education',
    blogCategory: 'education-ai',
    blogBaseUrl: 'https://www.archificials.com/thoughts',

    tone: {
      summary: 'Warm, mission-driven, grounded. Lead with student outcomes and teacher relief, not features.',
      guidelines: [
        'Respect budget constraints, recommend free and freemium tools',
        'Acknowledge the real tension: 70% of teachers worry AI weakens critical thinking',
        'Position AI as giving teachers more human time, not less human connection',
        'Focus on administrative wins first (grading, communication, enrollment)',
        'Use outcome-focused language: "student outcomes", "teacher capacity", "parent engagement"'
      ],
      avoid: [
        'Dismissing educator concerns about AI',
        'Recommending expensive enterprise tools to schools',
        'Overselling AI as a replacement for teacher judgment',
        'Em dashes (use commas, colons, or parentheses instead)'
      ]
    },

    research: {
      sources: [
        'EdSurge',
        'eSchool News',
        'ISTE',
        'K-12 Dive',
        'Inside Higher Ed',
        'Faculty Focus',
        'Fordham Institute',
        'THE (Times Higher Education)'
      ],
      keywords: [
        'AI education 2026',
        'edtech AI tools',
        'teacher AI tools classroom',
        'school AI policy',
        'adaptive learning AI',
        'student outcomes AI',
        'AI curriculum personalization',
        'school enrollment automation',
        'AI grading tools',
        'education technology trends'
      ]
    },

    cta: {
      assessment: 'Take the free AI Readiness Assessment for Education',
      assessmentFrame: 'See where your school stands, and what the quickest wins look like.',
      blog: 'Read the full analysis on our blog',
      contact: 'Schedule a free demo for your admin team',
      contactUrl: 'https://calendly.com/archificials/consultation'
    }
  },

  'real-estate': {
    name: 'Your AI Deal Flow',
    slug: 'real-estate',
    active: false, // Pending Beehiiv plan upgrade
    assessmentUrl: null, // Assessment not yet built
    blogCategory: 'real-estate-ai',
    blogBaseUrl: 'https://www.archificials.com/thoughts',

    tone: {
      summary: 'Numbers-driven, ROI-obsessed, market-aware. Lead with quantified outcomes.',
      guidelines: [
        'Speak in IRR, cap rates, timelines, and deal metrics',
        'Lead with ROI data and time savings',
        'Reference market data: deal volumes, vacancy rates, pricing trends',
        'Be specific about workflow improvements: "8-12 hrs to 45 min"',
        'Acknowledge data quality concerns in high-stakes decisions'
      ],
      avoid: [
        'Vague claims without financial backing',
        'Ignoring the human judgment required in real estate decisions',
        'Overpromising AI accuracy on valuation or market prediction',
        'Em dashes (use commas, colons, or parentheses instead)'
      ]
    },

    research: {
      sources: [
        'PwC Real Estate Trends',
        'McKinsey Real Estate',
        'Commercial Observer',
        'GlobeSt',
        'Bisnow',
        'CBRE Research',
        'JLL Research',
        'Nareit'
      ],
      keywords: [
        'AI real estate 2026',
        'proptech AI',
        'deal analysis AI CRE',
        'CRE technology trends',
        'property valuation AI',
        'data center real estate demand',
        'AI underwriting commercial',
        'real estate market analysis AI',
        'tenant management AI',
        'construction timeline AI'
      ]
    },

    cta: {
      assessment: null, // Not built yet
      assessmentFrame: null,
      blog: 'Read the full analysis on our blog',
      contact: 'Book a 15-minute deal-screening demo',
      contactUrl: 'https://calendly.com/archificials/consultation'
    }
  }
};

/**
 * Brand voice constants applied across all verticals.
 * Rooted in Sagmeister's design philosophy.
 */
const BRAND = {
  name: 'Archificials',
  tagline: 'Where Design Meets Intelligence',
  founder: 'Biel Pitman',
  founderTitle: 'Founder & Principal',
  email: 'biel@archificials.com',
  website: 'https://www.archificials.com',
  colors: {
    primary: '#1a1a2e',
    accent: '#e27308',
    light: '#f8f9fa',
    text: '#333333'
  },
  voice: {
    principles: [
      'Touch the heart, then the mind',
      'Beauty is functional',
      'Risk earns attention',
      'Human over corporate',
      'Substance over spectacle'
    ],
    rules: [
      'Never use em dashes (use commas, colons, or parentheses)',
      'Write for partners, founders, and directors, not junior staff',
      'Lead with specifics, not generalities ("50% faster" not "significantly improved")',
      'Name tools, cite sources, reference real firms when possible',
      'Write at a 10th-grade reading level (clarity is respect)',
      'Every paragraph earns the next one',
      'End sections with forward momentum, not summary'
    ]
  }
};

/**
 * Newsletter structure constants.
 */
const NEWSLETTER = {
  cadence: 'bi-weekly',
  sendDay: 'Tuesday',
  sendTime: '07:00', // CT
  sections: {
    anchor: { minWords: 400, maxWords: 600, label: 'The Anchor' },
    radar: { minWords: 100, maxWords: 150, items: 2, label: 'The Radar' },
    quickWin: { minWords: 80, maxWords: 120, label: 'The Quick Win' },
    close: { minWords: 50, maxWords: 80, label: 'The Close' }
  },
  blogExpansion: { minWords: 800, maxWords: 1200 }
};

/**
 * Airtable configuration.
 * Uses the same shared base as archificials-assessments.
 */
const AIRTABLE = {
  baseId: 'appB7PmFnNvV3085q',
  tables: {
    research: 'Newsletter Research',
    drafts: 'Newsletter Drafts',
    metrics: 'Newsletter Metrics',
    editions: 'Newsletter Editions'
  }
};

/**
 * Webflow CMS configuration.
 */
const WEBFLOW = {
  siteId: '68ffce003dacbbe1d2439718',
  blogCollectionId: '68ffce013dacbbe1d24397e4',
  blogBaseUrl: 'https://www.archificials.com/thoughts',
  apiBase: 'https://api.webflow.com/v2'
};

function getActiveVerticals() {
  return Object.values(VERTICALS).filter(v => v.active);
}

function getVertical(slug) {
  return VERTICALS[slug] || null;
}

module.exports = {
  VERTICALS,
  BRAND,
  NEWSLETTER,
  AIRTABLE,
  WEBFLOW,
  getActiveVerticals,
  getVertical
};
