/**
 * Email templates for the newsletter pipeline.
 * Sent via Resend to biel@archificials.com at key pipeline stages.
 */

const { BRAND } = require('./config');

/**
 * Research digest email - sent after research phase completes.
 * Contains top findings per vertical for Biel to review and select topics.
 */
function researchDigestEmail({ month, year, edition, verticalResults, approveUrl }) {
  const verticalSections = verticalResults.map(({ vertical, findings }) => {
    const topFindings = findings
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 4);

    const findingsHtml = topFindings.map((f, i) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #333; font-size: 14px;">
          <strong>${i + 1}. ${f.headline}</strong> (Relevance: ${f.relevance}/5)<br>
          <span style="color: #666;">${f.summary}</span><br>
          <a href="${f.sourceUrl}" style="color: ${BRAND.colors.accent}; font-size: 12px;">${f.source}</a>
        </td>
      </tr>
    `).join('');

    return `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td style="background: ${BRAND.colors.primary}; color: white; padding: 10px 14px; font-weight: bold; font-size: 15px; border-radius: 4px 4px 0 0;">
            ${vertical.name}
          </td>
        </tr>
        ${findingsHtml}
      </table>
    `;
  }).join('');

  return {
    from: 'Archificials Pipeline <pipeline@archificials.com>',
    to: BRAND.email,
    subject: `Newsletter Research Ready: ${month} ${year}, Edition ${edition}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h1 style="color: ${BRAND.colors.primary}; font-size: 22px; margin-bottom: 4px;">
          Research Complete: ${month} ${year}, Edition ${edition}
        </h1>
        <p style="color: #666; font-size: 14px; margin-top: 0;">
          Top findings per vertical are below. Reply with your topic selections,
          or defaults (highest relevance) will be used in 24 hours.
        </p>

        ${verticalSections}

        ${approveUrl ? `
        <div style="text-align: center; margin-top: 24px; margin-bottom: 16px;">
          <a href="${approveUrl}" style="background: ${BRAND.colors.accent}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px; display: inline-block;">
            Approve Defaults &amp; Generate Drafts
          </a>
        </div>` : ''}

        <div style="background: #f8f9fa; padding: 16px; border-radius: 4px; margin-top: 20px;">
          <p style="margin: 0; font-size: 14px; color: #333;">
            <strong>Want custom picks?</strong> Reply with your selections per vertical.
            Format: <code>law: 1,3 | architecture: 2,4 | education: 1,2</code>
            <br>Or click the button above to use top-ranked defaults.
          </p>
        </div>
      </div>
    `
  };
}

/**
 * Draft review email - sent after content generation completes.
 * Contains the full newsletter draft ready to paste into Beehiiv.
 */
function draftReviewEmail({ vertical, edition, month, year, draft, blogPost, linkValidation, webflowResult, beehiivResult }) {
  const newsletterPreview = `
    <div style="background: #f8f9fa; padding: 20px; border-radius: 4px; border-left: 4px solid ${BRAND.colors.accent};">
      <p style="color: #666; font-size: 12px; margin-bottom: 4px;">SUBJECT LINE FOR BEEHIIV:</p>
      <h2 style="color: ${BRAND.colors.primary}; font-size: 18px; margin-top: 0;">
        ${draft.subject_line}
      </h2>

      <h3 style="color: ${BRAND.colors.accent}; font-size: 15px;">THE ANCHOR: ${draft.anchor.title}</h3>
      <div style="font-size: 14px; color: #333; line-height: 1.6;">
        ${draft.anchor.teaser.split('\n').map(p => `<p>${p}</p>`).join('')}
        <p><em>${draft.anchor.blog_cta}</em></p>
      </div>

      <h3 style="color: ${BRAND.colors.accent}; font-size: 15px;">THE RADAR</h3>
      ${draft.radar.map(r => {
        const broken = linkValidation?.broken?.find(b => b.url === r.source_url);
        const flag = broken ? ' <span style="color: #dc3545; font-weight: bold;">[UNVERIFIED LINK]</span>' : '';
        return `
        <p style="font-size: 14px; color: #333;">
          <strong>${r.headline}</strong> ${r.body}
          ${r.source_url ? `<br><a href="${r.source_url}" style="color: ${BRAND.colors.accent}; font-size: 12px;">Source</a>${flag}` : ''}
        </p>`;
      }).join('')}

      <h3 style="color: ${BRAND.colors.accent}; font-size: 15px;">THE QUICK WIN</h3>
      <p style="font-size: 14px; color: #333;">
        <strong>${draft.quick_win.tool_name}:</strong> ${draft.quick_win.body}
      </p>

      <h3 style="color: ${BRAND.colors.accent}; font-size: 15px;">THE CLOSE</h3>
      <p style="font-size: 14px; color: #333;">${draft.close.personal_note}</p>
      <p style="font-size: 14px; color: ${BRAND.colors.accent}; font-weight: bold;">
        ${draft.close.assessment_cta || ''}
        ${draft.close.assessment_url ? `<br><a href="${draft.close.assessment_url}">${draft.close.assessment_url}</a>` : ''}
      </p>
      <p style="font-size: 13px; color: #666; font-style: italic;">
        ${draft.close.contact_cta || ''}
      </p>
    </div>
  `;

  return {
    from: 'Archificials Pipeline <pipeline@archificials.com>',
    to: BRAND.email,
    subject: `Newsletter Draft Ready: ${vertical.name}, Edition ${edition} (${month} ${year})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h1 style="color: ${BRAND.colors.primary}; font-size: 22px; margin-bottom: 4px;">
          Draft Ready: ${vertical.name}
        </h1>
        <p style="color: #666; font-size: 14px; margin-top: 0;">
          Edition ${edition}, ${month} ${year}. Review below and reply with edits or "approve" to mark as ready.
        </p>
        ${beehiivResult ? `
        <div style="background: #d4edda; padding: 12px; border-radius: 4px; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 13px; color: #155724;">
            <strong>Beehiiv draft created.</strong> <a href="https://app.beehiiv.com/posts/${beehiivResult.postId}">Review in Beehiiv editor</a>
          </p>
        </div>` : ''}
        ${webflowResult ? `
        <div style="background: #d4edda; padding: 12px; border-radius: 4px; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 13px; color: #155724;">
            <strong>Blog draft created in Webflow.</strong> URL after publish: <a href="${webflowResult.blogUrl}">${webflowResult.blogUrl}</a>
          </p>
        </div>` : ''}

        ${newsletterPreview}

        ${linkValidation?.broken?.length > 0 ? `
        <div style="background: #f8d7da; padding: 12px; border-radius: 4px; margin-top: 16px;">
          <p style="margin: 0; font-size: 13px; color: #721c24;">
            <strong>Link Validation:</strong> ${linkValidation.broken.length} link(s) could not be verified:
            ${linkValidation.broken.map(b => `<br>• ${b.location}: <a href="${b.url}">${b.url}</a> (${b.status || 'unreachable'})`).join('')}
          </p>
        </div>` : `
        <div style="background: #d4edda; padding: 12px; border-radius: 4px; margin-top: 16px;">
          <p style="margin: 0; font-size: 13px; color: #155724;">
            <strong>Link Validation:</strong> All ${linkValidation?.results?.length || 0} source links verified.
          </p>
        </div>`}

        ${blogPost ? `
        <div style="margin-top: 24px; border-top: 2px solid ${BRAND.colors.accent}; padding-top: 16px;">
          <h2 style="color: ${BRAND.colors.primary}; font-size: 18px;">Blog Expansion</h2>
          <p style="color: #666; font-size: 12px;">SEO Title: ${blogPost.seo_title || 'N/A'} | Slug: ${blogPost.slug || 'N/A'}</p>
          <div style="font-size: 14px; color: #333; line-height: 1.6;">
            ${blogPost.html_body || '<p>Blog content available in Airtable record.</p>'}
          </div>
        </div>` : `
        <div style="background: #fff3cd; padding: 12px; border-radius: 4px; margin-top: 16px;">
          <p style="margin: 0; font-size: 13px; color: #856404;">
            <strong>Blog expansion</strong> is available in the Airtable record.
          </p>
        </div>`}
      </div>
    `
  };
}

/**
 * Send email via Resend API.
 * @param {object} emailData - { from, to, subject, html }
 * @param {string} resendApiKey - Resend API key from env
 */
async function sendEmail(emailData, resendApiKey) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(emailData)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${err}`);
  }

  return res.json();
}

module.exports = { researchDigestEmail, draftReviewEmail, sendEmail };
