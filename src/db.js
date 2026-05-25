#!/usr/bin/env node
// token-tracker — Read-only SQLite adapter for Codex state_5.sqlite

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_PATH = path.join(os.homedir(), '.codex', 'state_5.sqlite');

let _db = null;

function getDb() {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Codex DB not found at ${DB_PATH}`);
    return null;
  }
  // Open strictly in read-only mode
  _db = new Database(DB_PATH, { readonly: true });
  return _db;
}

function close() {
  if (_db) { _db.close(); _db = null; }
}

// ─── Stats / aggregation ───────────────────────────────────

function listSessions({ limit, since, model } = {}) {
  const db = getDb();
  if (!db) return [];

  let sql = `
    SELECT 
      id, 
      title as label, 
      model, 
      datetime(created_at, 'unixepoch') as started_at,
      tokens_used as total_tokens
    FROM threads 
    WHERE tokens_used > 0
  `;
  const wheres = [];
  const params = [];

  if (since) {
    wheres.push(`created_at >= strftime('%s', 'now', ?)`);
    params.push(`-${since}`);
  }
  if (model !== undefined && model !== null) {
    wheres.push(`model = ?`);
    params.push(model);
  }

  if (wheres.length) sql += ' AND ' + wheres.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  if (limit) { sql += ' LIMIT ?'; params.push(limit); }

  const rows = db.prepare(sql).all(...params);
  
  // Map back to expected structure
  return rows.map(r => ({
    id: r.id,
    label: r.label,
    model: r.model,
    api_type: 'openai',
    started_at: r.started_at,
    total_input: 0,
    total_output: 0,
    total_tokens: r.total_tokens,
    entry_count: 1 // dummy
  }));
}

function getSessionStats(sessionId) {
  const db = getDb();
  if (!db) return null;
  
  const r = db.prepare(`
    SELECT 
      id, 
      title as label, 
      model, 
      datetime(created_at, 'unixepoch') as started_at,
      tokens_used as total_tokens
    FROM threads 
    WHERE id = ?
  `).get(sessionId);

  if (!r) return null;

  return {
    id: r.id,
    label: r.label,
    model: r.model,
    api_type: 'openai',
    started_at: r.started_at,
    turns: 1,
    total_input: 0,
    total_output: 0,
    total_tokens: r.total_tokens
  };
}

function getEntries(sessionId) {
  const stats = getSessionStats(sessionId);
  if (!stats) return [];
  // Return a single dummy entry representing the whole session
  return [{
    id: 1,
    session_id: sessionId,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: stats.total_tokens,
    record_method: 'codex-sync',
    prompt_preview: 'Codex Session: ' + stats.label,
    response_text: 'Token details are not granular in Codex DB.',
    recorded_at: stats.started_at,
    model: stats.model
  }];
}

function getGlobalStats({ since } = {}) {
  const db = getDb();
  if (!db) return { total_sessions: 0, completed_sessions: 0, active_sessions: 0, total_tokens: 0 };

  let where = 'WHERE tokens_used > 0';
  const params = [];

  if (since) {
    where += ` AND created_at >= strftime('%s', 'now', ?)`;
    params.push(`-${since}`);
  }

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_sessions,
      SUM(tokens_used) AS total_tokens
    FROM threads
    ${where}
  `).get(...params);

  return { 
    total_sessions: row.total_sessions || 0, 
    completed_sessions: row.total_sessions || 0, 
    active_sessions: 0,
    total_input: 0,
    total_output: 0,
    total_tokens: row.total_tokens || 0
  };
}

function getDailyStats({ since, limit } = {}) {
  const db = getDb();
  if (!db) return [];
  const days = limit || 7;
  const period = since || `${days} days`;

  return db.prepare(`
    SELECT
      DATE(created_at, 'unixepoch') AS day,
      SUM(tokens_used) AS total_tokens,
      COUNT(*) AS calls
    FROM threads
    WHERE tokens_used > 0 AND created_at >= strftime('%s', 'now', ?)
    GROUP BY DATE(created_at, 'unixepoch')
    ORDER BY day ASC
  `).all(`-${period}`);
}

function getModelStats({ since } = {}) {
  const db = getDb();
  if (!db) return [];
  let where = 'WHERE tokens_used > 0';
  const params = [];
  
  if (since) {
    where += ` AND created_at >= strftime('%s', 'now', ?)`;
    params.push(`-${since}`);
  }

  return db.prepare(`
    SELECT
      model,
      SUM(tokens_used) AS total_tokens,
      COUNT(id) AS sessions
    FROM threads
    ${where}
    GROUP BY model
    ORDER BY total_tokens DESC
  `).all(...params);
}

// ─── HTML Report & Pricing ───────────────────────────────────

const PRICING = {
  // OpenAI
  'gpt-4o':              { input: 2.50, output: 10, cache_write: 1.25, cache_read: 0 },
  'gpt-4o-mini':         { input: 0.15, output: 0.60, cache_write: 0.075, cache_read: 0 },
  'gpt-4-turbo':         { input: 10, output: 30, cache_write: 0, cache_read: 0 },
  'gpt-4':               { input: 30, output: 60, cache_write: 0, cache_read: 0 },
  'gpt-5.5':             { input: 15, output: 60, cache_write: 7.50, cache_read: 0 },
  'gpt-5.4':             { input: 2.50, output: 10, cache_write: 1.25, cache_read: 0 },
};

function estimateCost(model, totalTokens) {
  if (!model) return null;
  const m = model.toLowerCase();

  let p = null;
  if (PRICING[m]) {
    p = PRICING[m];
  } else {
    const sortedKeys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (m.startsWith(key)) {
        p = PRICING[key];
        break;
      }
    }
  }

  if (p) {
    // Blended average (assuming 30% input, 70% output roughly for coding)
    const blendedRate = (p.input * 0.3) + (p.output * 0.7);
    return (totalTokens / 1_000_000) * blendedRate;
  }
  return null;
}

// Unused exports kept for compatibility if needed by other files (e.g. cli.js)
function getActiveSession() { return null; }
function createSession() { return null; }
function endSession() { return false; }
function getOrCreateSessionByLabel() { return null; }
function switchSession() { return null; }
function insertEntry() { return null; }

module.exports = {
  getDb, close, DB_PATH,
  listSessions, getSessionStats, getGlobalStats, getDailyStats, getModelStats, getEntries,
  estimateCost, PRICING,
  getActiveSession, createSession, endSession, getOrCreateSessionByLabel, switchSession, insertEntry
};

