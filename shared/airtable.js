/**
 * Airtable client for the newsletter pipeline.
 * Mirrors the pattern from archificials-assessments workers.
 *
 * Env vars required: AIRTABLE_API_KEY
 */

const { AIRTABLE } = require('./config');

const BASE_URL = `https://api.airtable.com/v0/${AIRTABLE.baseId}`;

/**
 * Create a record in an Airtable table.
 * @param {string} table - Table name from AIRTABLE.tables
 * @param {object} fields - Record fields
 * @param {string} apiKey - Airtable API key (from env)
 * @returns {object} Created record
 */
async function createRecord(table, fields, apiKey) {
  const url = `${BASE_URL}/${encodeURIComponent(table)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable CREATE failed (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Update (PATCH) a record in Airtable.
 * @param {string} table - Table name
 * @param {string} recordId - Airtable record ID
 * @param {object} fields - Fields to update
 * @param {string} apiKey - Airtable API key
 * @returns {object} Updated record
 */
async function updateRecord(table, recordId, fields, apiKey) {
  const url = `${BASE_URL}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable PATCH failed (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Query records from Airtable with optional filter formula.
 * @param {string} table - Table name
 * @param {object} opts - { filterByFormula, sort, maxRecords }
 * @param {string} apiKey - Airtable API key
 * @returns {Array} Array of records
 */
async function queryRecords(table, opts, apiKey) {
  const params = new URLSearchParams();
  if (opts.filterByFormula) params.set('filterByFormula', opts.filterByFormula);
  if (opts.maxRecords) params.set('maxRecords', String(opts.maxRecords));
  if (opts.sort) {
    opts.sort.forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field);
      params.set(`sort[${i}][direction]`, s.direction || 'asc');
    });
  }

  const url = `${BASE_URL}/${encodeURIComponent(table)}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable QUERY failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.records || [];
}

/**
 * Get a single record by ID.
 */
async function getRecord(table, recordId, apiKey) {
  const url = `${BASE_URL}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable GET failed (${res.status}): ${err}`);
  }

  return res.json();
}

module.exports = { createRecord, updateRecord, queryRecords, getRecord };
