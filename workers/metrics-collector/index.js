/**
 * Metrics Collector Worker (Optional)
 *
 * Runs monthly to pull newsletter performance metrics from Beehiiv API
 * and store them in Airtable for tracking.
 *
 * NOTE: This worker requires Beehiiv API access (available on Scale plan).
 * If not available, metrics can be tracked manually via Beehiiv dashboard.
 *
 * Routes:
 *   POST /collect          - Collect metrics for all verticals
 *   GET  /health           - Health check
 *
 * Required env vars:
 *   BEEHIIV_API_KEY, AIRTABLE_API_KEY, RESEND_API_KEY
 */

import { getActiveVerticals, AIRTABLE, BRAND } from '../../shared/config';
import { createRecord } from '../../shared/airtable';
import { sendEmail } from '../../shared/email-templates';

// ─── BEEHIIV API ───

async function getBeehiivStats(publicationId, apiKey) {
  // Beehiiv API v2 endpoint for publication stats
  const res = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/stats`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Beehiiv API failed (${res.status}): ${err}`);
  }

  return res.json();
}

async function getRecentPosts(publicationId, apiKey, limit = 4) {
  const res = await fetch(
    `https://api.beehiiv.com/v2/publications/${publicationId}/posts?limit=${limit}&status=confirmed`,
    { headers: { 'Authorization': `Bearer ${apiKey}` } }
  );

  if (!res.ok) return [];

  const data = await res.json();
  return data.data || [];
}

// ─── METRICS EMAIL ───

function metricsEmail(month, year, verticalMetrics) {
  const rows = verticalMetrics.map(m => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${m.vertical}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${m.subscribers || 'N/A'}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${m.avgOpenRate || 'N/A'}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${m.avgClickRate || 'N/A'}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${m.editions || 0}</td>
    </tr>
  `).join('');

  return {
    from: 'Archificials Pipeline <pipeline@archificials.com>',
    to: BRAND.email,
    subject: `Newsletter Metrics: ${month} ${year}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h1 style="color: ${BRAND.colors.primary}; font-size: 22px;">
          Monthly Newsletter Performance: ${month} ${year}
        </h1>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
          <tr style="background: ${BRAND.colors.primary}; color: white;">
            <th style="padding: 10px; text-align: left;">Vertical</th>
            <th style="padding: 10px; text-align: left;">Subscribers</th>
            <th style="padding: 10px; text-align: left;">Avg Open Rate</th>
            <th style="padding: 10px; text-align: left;">Avg Click Rate</th>
            <th style="padding: 10px; text-align: left;">Editions Sent</th>
          </tr>
          ${rows}
        </table>
      </div>
    `
  };
}

// ─── WORKER EXPORT ───

export default {
  // Monthly cron: last day of month at 9am UTC
  async scheduled(event, env, ctx) {
    // This is a placeholder; implement when Beehiiv API access is confirmed
    console.log('Metrics collection cron fired. Implement when Beehiiv API is available.');
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        worker: 'metrics-collector',
        note: 'Requires Beehiiv API key. Manual tracking via dashboard if not available.'
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'POST' && url.pathname === '/collect') {
      return new Response(JSON.stringify({
        status: 'pending',
        message: 'Metrics collector is a placeholder. Set BEEHIIV_API_KEY and configure publication IDs in config.js to activate.'
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('Not Found', { status: 404 });
  }
};
