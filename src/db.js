#!/usr/bin/env node
// token-tracker — SQLite storage layer
//
// Schema:
//   sessions      — one per working session (e.g. "fix auth bug")
//   token_entries — one per API call or stdin record within a session
//   active_flag   — simple key-value for "current session"

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB_DIR = process.env.TOKEN_TRACKER_DIR
  || path.join(os.homedir(), '.token-tracker');

const DB_PATH = path.join(DB_DIR, 'tokens.db');

// ─── Schema ────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  api_type    TEXT NOT NULL DEFAULT 'custom',
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS token_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write     INTEGER NOT NULL DEFAULT 0,
  cache_read      INTEGER NOT NULL DEFAULT 0,
  turn_number     INTEGER,
  record_method   TEXT NOT NULL DEFAULT 'stdin',
  prompt_preview  TEXT NOT NULL DEFAULT '',
  response_text   TEXT NOT NULL DEFAULT '',
  recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_session
  ON token_entries(session_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_entries_recorded
  ON token_entries(recorded_at);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Active session tracking
INSERT OR IGNORE INTO meta (key, value) VALUES ('active_session', '');
`;

// ─── Connection (lazy singleton) ───────────────────────────

let _db = null;

function getDb() {
  if (_db) return _db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA);

  // Migration: add response_text if missing (existing DBs)
  try {
    _db.exec(`ALTER TABLE token_entries ADD COLUMN response_text TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — ignore
  }

  return _db;
}

function close() {
  if (_db) { _db.close(); _db = null; }
}

// ─── Session operations ────────────────────────────────────

let _idCounter = 0;
let _lastIdTs = 0;
function generateId() {
  const ts = Date.now();
  // Same-ms counter: increment if same timestamp, reset if different
  if (ts === _lastIdTs) { _idCounter++; }
  else { _idCounter = 0; _lastIdTs = ts; }
  const ts36 = ts.toString(36);
  const counter36 = _idCounter.toString(36).padStart(3, '0');
  // Use crypto.randomUUID() for a strong 5-char random suffix
  const uuidPart = require('crypto').randomUUID().replace(/-/g, '').slice(0, 5);
  return `ses_${ts36}${counter36}${uuidPart}`;
}

function createSession({ label, model, api_type, id }) {
  const db = getDb();
  const sid = id || generateId();
  db.prepare(`
    INSERT INTO sessions (id, label, model, api_type, started_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(sid, label || '', model || '', api_type || 'custom');
  // Set as active
  db.prepare(`UPDATE meta SET value = ? WHERE key = 'active_session'`).run(sid);
  return sid;
}

/**
 * Find active session by label, or create a new one.
 * If a session with this label exists AND has no ended_at, reuse it.
 * Otherwise create a new one (and end any previously active session).
 * This is the main entry point for the --as workflow.
 */
function getOrCreateSessionByLabel(label, model) {
  const db = getDb();

  // If no label, just use/create a simple unnamed session
  if (!label) {
    const active = getActiveSession();
    if (active) return active;
    return createSession({ label: '', model: model || '' });
  }

  // Look for an active (not ended) session with this label
  const existing = db.prepare(`
    SELECT id FROM sessions WHERE label = ? AND ended_at IS NULL LIMIT 1
  `).get(label);

  if (existing) {
    // Reuse — just set as active
    db.prepare(`UPDATE meta SET value = ? WHERE key = 'active_session'`).run(existing.id);
    return existing.id;
  }

  // End any currently active session
  const active = getActiveSession();
  if (active) {
    endSession(active);
  }

  // Create new session with this label
  return createSession({ label, model: model || '' });
}

/**
 * Switch to a different task. Ends current session, starts/finds new one.
 * Convenience: label만 바꾸면 됨.
 */
function switchSession(label, model) {
  return getOrCreateSessionByLabel(label, model);
}

function endSession(sessionId) {
  const db = getDb();
  const result = db.prepare(`
    UPDATE sessions SET ended_at = datetime('now')
    WHERE id = ? AND ended_at IS NULL
  `).run(sessionId);
  // Clear active if this was the active session
  const active = getActiveSession();
  if (active === sessionId) {
    db.prepare(`UPDATE meta SET value = '' WHERE key = 'active_session'`).run();
  }
  return result.changes > 0;
}

function getActiveSession() {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'active_session'`).get();
  return row && row.value ? row.value : null;
}

function getSession(sessionId) {
  const db = getDb();
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
}

function listSessions({ limit, since, model } = {}) {
  const db = getDb();
  let sql = `
    SELECT s.*,
      COALESCE(SUM(te.input_tokens), 0) AS total_input,
      COALESCE(SUM(te.output_tokens), 0) AS total_output,
      COALESCE(SUM(te.cache_read), 0) AS total_cache_read,
      COUNT(te.id) AS entry_count
    FROM sessions s
    LEFT JOIN token_entries te ON te.session_id = s.id
  `;
  const wheres = [];
  const params = [];

  if (since) {
    wheres.push(`s.started_at >= datetime('now', ?)`);
    params.push(`-${since}`);
  }
  if (model !== undefined && model !== null) {
    wheres.push(`s.model = ?`);
    params.push(model);
  }

  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
  sql += ' GROUP BY s.id ORDER BY s.started_at DESC';

  if (limit) { sql += ' LIMIT ?'; params.push(limit); }

  return db.prepare(sql).all(...params);
}

// ─── Token entry operations ────────────────────────────────

function insertEntry({ session_id, input_tokens, output_tokens, cache_write, cache_read, record_method, prompt_preview, response_text }) {
  const db = getDb();
  // Auto-create session if it doesn't exist (with a helpful default label)
  const existing = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(session_id);
  if (!existing) {
    const autoLabel = (prompt_preview || '').slice(0, 40) || 'adhoc';
    db.prepare(`
      INSERT INTO sessions (id, label, model, started_at)
      VALUES (?, ?, '', datetime('now'))
    `).run(session_id, autoLabel);
  }

  // Get next turn number
  const lastTurn = db.prepare(`
    SELECT MAX(turn_number) AS max_turn FROM token_entries WHERE session_id = ?
  `).get(session_id);

  const result = db.prepare(`
    INSERT INTO token_entries (session_id, input_tokens, output_tokens, cache_write, cache_read, turn_number, record_method, prompt_preview, response_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session_id,
    input_tokens || 0,
    output_tokens || 0,
    cache_write || 0,
    cache_read || 0,
    (lastTurn && lastTurn.max_turn ? lastTurn.max_turn + 1 : 1),
    record_method || 'stdin',
    prompt_preview ? prompt_preview.slice(0, 200) : '',
    response_text || ''
  );
  return result.lastInsertRowid;
}

function getEntries(sessionId, { limit } = {}) {
  const db = getDb();
  let sql = `SELECT * FROM token_entries WHERE session_id = ? ORDER BY recorded_at ASC`;
  if (limit) sql += ` LIMIT ${parseInt(limit)}`;
  return db.prepare(sql).all(sessionId);
}

// ─── Stats / aggregation ───────────────────────────────────

function getSessionStats(sessionId) {
  const db = getDb();
  const session = getSession(sessionId);
  if (!session) return null;

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS turns,
      COALESCE(SUM(input_tokens), 0) AS total_input,
      COALESCE(SUM(output_tokens), 0) AS total_output,
      COALESCE(SUM(cache_write), 0) AS total_cache_write,
      COALESCE(SUM(cache_read), 0) AS total_cache_read
    FROM token_entries WHERE session_id = ?
  `).get(sessionId);

  return { ...session, ...stats };
}

function getGlobalStats({ since } = {}) {
  const db = getDb();
  let sessionWhere = '';
  let entryWhere = '';
  const params = [];

  if (since) {
    sessionWhere = `WHERE s.started_at >= datetime('now', ?)`;
    entryWhere = `WHERE te.recorded_at >= datetime('now', ?)`;
    params.push(`-${since}`);
  }

  const sessionStats = db.prepare(`
    SELECT
      COUNT(*) AS total_sessions,
      SUM(CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_sessions,
      SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS active_sessions
    FROM sessions s ${sessionWhere}
  `).get(...params);

  const tokenStats = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) AS total_input,
      COALESCE(SUM(output_tokens), 0) AS total_output,
      COALESCE(SUM(cache_write), 0) AS total_cache_write,
      COALESCE(SUM(cache_read), 0) AS total_cache_read,
      COUNT(*) AS total_entries
    FROM token_entries te ${entryWhere}
  `).get(...params);

  return { ...sessionStats, ...tokenStats };
}

function getDailyStats({ since, limit } = {}) {
  const db = getDb();
  const days = limit || 7;
  const period = since || `${days} days`;

  return db.prepare(`
    SELECT
      DATE(te.recorded_at) AS day,
      COALESCE(SUM(te.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(te.output_tokens), 0) AS output_tokens,
      COUNT(*) AS calls
    FROM token_entries te
    WHERE te.recorded_at >= datetime('now', ?)
    GROUP BY DATE(te.recorded_at)
    ORDER BY day ASC
  `).all(`-${period}`);
}

function getModelStats({ since } = {}) {
  const db = getDb();
  let where = '';
  if (since) where = `WHERE te.recorded_at >= datetime('now', ?)`;

  return db.prepare(`
    SELECT
      s.model,
      COALESCE(SUM(te.input_tokens), 0) AS total_input,
      COALESCE(SUM(te.output_tokens), 0) AS total_output,
      COUNT(DISTINCT s.id) AS sessions
    FROM token_entries te
    JOIN sessions s ON s.id = te.session_id
    ${where}
    GROUP BY s.model
    ORDER BY total_output DESC
  `).all(...(since ? [`-${since}`] : []));
}

// ─── HTML Report ───────────────────────────────────────────

const PRICING = {
  // Anthropic
  'claude-sonnet-4':     { input: 3,  output: 15, cache_write: 3.75, cache_read: 0.30 },
  'claude-opus-4':       { input: 15, output: 75, cache_write: 18.75, cache_read: 1.50 },
  'claude-haiku-4':      { input: 0.80, output: 4, cache_write: 1, cache_read: 0.08 },
  'claude-3-5-sonnet':   { input: 3,  output: 15, cache_write: 3.75, cache_read: 0.30 },
  'claude-3-5-haiku':    { input: 0.80, output: 4, cache_write: 1, cache_read: 0.08 },
  'claude-3-opus':       { input: 15, output: 75, cache_write: 18.75, cache_read: 1.50 },

  // OpenAI
  'gpt-4o':              { input: 2.50, output: 10, cache_write: 1.25, cache_read: 0 },
  'gpt-4o-mini':         { input: 0.15, output: 0.60, cache_write: 0.075, cache_read: 0 },
  'gpt-4-turbo':         { input: 10, output: 30, cache_write: 0, cache_read: 0 },
  'gpt-4':               { input: 30, output: 60, cache_write: 0, cache_read: 0 },
  'gpt-3.5-turbo':       { input: 0.50, output: 1.50, cache_write: 0, cache_read: 0 },
  'o1':                  { input: 15, output: 60, cache_write: 7.50, cache_read: 0 },
  'o1-mini':             { input: 1.10, output: 4.40, cache_write: 0.55, cache_read: 0 },
  'o3-mini':             { input: 1.10, output: 4.40, cache_write: 0.55, cache_read: 0 },

  // Google
  'gemini-2.5-pro':      { input: 1.25, output: 10, cache_write: 0, cache_read: 0 },
  'gemini-2.5-flash':    { input: 0.15, output: 0.60, cache_write: 0, cache_read: 0 },
  'gemini-2.0-flash':    { input: 0.10, output: 0.40, cache_write: 0, cache_read: 0 },
};

function estimateCost(model, inputTokens, outputTokens) {
  if (!model) return null;
  const m = model.toLowerCase();

  // Exact match first
  if (PRICING[m]) {
    const p = PRICING[m];
    return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  }

  // Prefix match (e.g. "gpt-4o-2025-01-20" → "gpt-4o")
  const sortedKeys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (m.startsWith(key)) {
      const p = PRICING[key];
      return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
    }
  }

  return null;
}

module.exports = {
  getDb, close, DB_DIR, DB_PATH,
  createSession, endSession, getActiveSession, getSession, listSessions,
  getOrCreateSessionByLabel, switchSession,
  insertEntry, getEntries,
  getSessionStats, getGlobalStats, getDailyStats, getModelStats,
  estimateCost, PRICING, generateId,
};
