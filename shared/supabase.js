/**
 * Supabase client for the newsletter pipeline.
 * Drop-in replacement for shared/airtable.js.
 *
 * Returns records in Airtable-compatible format: { id, fields }
 * so that worker code only needs its import path and env var name updated.
 *
 * Env vars required (set via wrangler secret put):
 *   SUPABASE_SERVICE_KEY
 *
 * Supabase URL is read from SUPABASE.url in shared/config.js.
 */

import { SUPABASE } from './config';

// Map Airtable table display names to Supabase table names
const TABLE_MAP = {
  'Newsletter Research': 'newsletter_research',
  'Newsletter Drafts':   'newsletter_drafts',
  'Newsletter Metrics':  'newsletter_metrics',
  'Newsletter Editions': 'newsletter_editions',
};

function resolveTable(table) {
  return TABLE_MAP[table] || table.toLowerCase().replace(/\s+/g, '_');
}

function supabaseHeaders(apiKey, prefer = 'return=representation') {
  const h = {
    'Authorization': `Bearer ${apiKey}`,
    'apikey':         apiKey,
    'Content-Type':   'application/json',
  };
  if (prefer) h['Prefer'] = prefer;
  return h;
}

/**
 * Convert a flat Supabase row into Airtable-compatible format:
 *   { id: "<uuid>", fields: { vertical: "...", status: "...", ... } }
 * This lets worker code access record.id and record.fields.xxx unchanged.
 */
function rowToRecord(row) {
  if (!row) return null;
  const { id, airtable_id, created_at, ...fields } = row;
  return { id: id || airtable_id, fields };
}

/**
 * Create a record in a Supabase table.
 *
 * @param {string} table   - Table name (Airtable display name or Supabase name)
 * @param {object} fields  - Record fields (snake_case keys matching Supabase columns)
 * @param {string} apiKey  - Supabase service role key (from env.SUPABASE_SERVICE_KEY)
 * @returns {object}       - Created record in { id, fields } format
 */
async function createRecord(table, fields, apiKey) {
  const supaTable = resolveTable(table);
  const url = `${SUPABASE.url}/rest/v1/${supaTable}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: supabaseHeaders(apiKey),
    body:    JSON.stringify(fields),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase CREATE failed on ${supaTable} (${res.status}): ${err}`);
  }

  const rows = await res.json();
  return rowToRecord(Array.isArray(rows) ? rows[0] : rows);
}

/**
 * Update (PATCH) a record in Supabase.
 *
 * @param {string} table     - Table name
 * @param {string} recordId  - UUID of the record to update
 * @param {object} fields    - Fields to update
 * @param {string} apiKey    - Supabase service role key
 * @returns {object}         - Updated record in { id, fields } format
 */
async function updateRecord(table, recordId, fields, apiKey) {
  const supaTable = resolveTable(table);
  const url = `${SUPABASE.url}/rest/v1/${supaTable}?id=eq.${recordId}`;

  const res = await fetch(url, {
    method:  'PATCH',
    headers: supabaseHeaders(apiKey),
    body:    JSON.stringify(fields),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase PATCH failed on ${supaTable} (${res.status}): ${err}`);
  }

  const rows = await res.json();
  return rowToRecord(Array.isArray(rows) ? rows[0] : rows);
}

/**
 * Query records from Supabase.
 *
 * Accepts an opts object that mirrors the Airtable client signature:
 *   { sort, maxRecords, filter }
 *
 * Note: Airtable's filterByFormula is not supported here. Use opts.filter
 * to pass PostgREST column filters directly, e.g.:
 *   { filter: { status: 'eq.generated', vertical: 'eq.law' } }
 *
 * @param {string} table   - Table name
 * @param {object} opts    - { sort: [{field, direction}], maxRecords, filter }
 * @param {string} apiKey  - Supabase service role key
 * @returns {Array}        - Array of records in { id, fields } format
 */
async function queryRecords(table, opts = {}, apiKey) {
  const supaTable = resolveTable(table);
  const params = new URLSearchParams();

  if (opts.maxRecords) params.set('limit', String(opts.maxRecords));

  if (opts.sort && opts.sort.length > 0) {
    const orderStr = opts.sort
      .map(s => `${s.field}.${(s.direction || 'asc')}`)
      .join(',');
    params.set('order', orderStr);
  }

  // Pass raw PostgREST column filters
  if (opts.filter) {
    for (const [col, val] of Object.entries(opts.filter)) {
      params.set(col, val);
    }
  }

  const url = `${SUPABASE.url}/rest/v1/${supaTable}?${params.toString()}`;

  const res = await fetch(url, {
    headers: supabaseHeaders(apiKey, ''),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase QUERY failed on ${supaTable} (${res.status}): ${err}`);
  }

  const rows = await res.json();
  return (rows || []).map(rowToRecord);
}

/**
 * Get a single record by ID.
 *
 * @param {string} table     - Table name
 * @param {string} recordId  - UUID
 * @param {string} apiKey    - Supabase service role key
 * @returns {object}         - Record in { id, fields } format
 */
async function getRecord(table, recordId, apiKey) {
  const supaTable = resolveTable(table);
  const url = `${SUPABASE.url}/rest/v1/${supaTable}?id=eq.${recordId}&limit=1`;

  const res = await fetch(url, {
    headers: supabaseHeaders(apiKey, ''),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase GET failed on ${supaTable} (${res.status}): ${err}`);
  }

  const rows = await res.json();
  return rowToRecord(rows[0]);
}

export { createRecord, updateRecord, queryRecords, getRecord };
