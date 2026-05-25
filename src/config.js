// token-tracker — Persistent configuration (API keys, preferences)
//
// Config file: ~/.token-tracker/config.json
//
// Schema:
// {
//   "openai_api_key": "sk-...",
//   "anthropic_api_key": "sk-ant-...",
//   "default_model": "gpt-4o"
// }

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.token-tracker');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

let _cache = null;

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function load() {
  if (_cache) return _cache;
  ensureDir();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    _cache = JSON.parse(raw);
  } catch {
    _cache = {};
  }
  return _cache;
}

function save(data) {
  ensureDir();
  _cache = data;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
  // Restrict permissions on non-Windows
  if (os.platform() !== 'win32') {
    try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {}
  }
}

function get(key) {
  const cfg = load();
  return cfg[key] !== undefined ? cfg[key] : null;
}

function set(key, value) {
  const cfg = load();
  if (value === null || value === undefined) {
    delete cfg[key];
  } else {
    cfg[key] = value;
  }
  save(cfg);
}

function unset(key) {
  set(key, null);
}

function getApiKey(provider) {
  const envVar = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  // Priority: env var > config file
  if (process.env[envVar]) return process.env[envVar];

  // For OpenAI: check auth type — subscription uses oauth token
  if (provider === 'openai') {
    const authType = get('openai_auth_type');
    if (authType === 'subscription') {
      return get('openai_oauth_token');
    }
    return get('openai_api_key');
  }

  const configKey = 'anthropic_api_key';
  return get(configKey);
}

/**
 * Get structured OpenAI auth info.
 * Returns { type: 'api_key'|'subscription'|null, token, refreshToken, expiresAt }
 */
function getOpenAIAuth() {
  // Env var always wins → treat as api_key
  if (process.env.OPENAI_API_KEY) {
    return { type: 'api_key', token: process.env.OPENAI_API_KEY, refreshToken: null, expiresAt: null };
  }

  const authType = get('openai_auth_type');
  if (authType === 'subscription') {
    return {
      type: 'subscription',
      token: get('openai_oauth_token'),
      refreshToken: get('openai_refresh_token'),
      expiresAt: get('openai_token_expires_at'),
    };
  }

  const apiKey = get('openai_api_key');
  if (apiKey) {
    return { type: 'api_key', token: apiKey, refreshToken: null, expiresAt: null };
  }

  return { type: null, token: null, refreshToken: null, expiresAt: null };
}

/**
 * Save OAuth subscription auth result.
 * @param {{ accessToken: string, refreshToken: string, expiresIn: number, payload?: object }} result
 */
function saveSubscriptionAuth(result) {
  const cfg = load();
  cfg.openai_auth_type = 'subscription';
  cfg.openai_oauth_token = result.accessToken;
  if (result.refreshToken) {
    cfg.openai_refresh_token = result.refreshToken;
  }
  if (result.expiresIn) {
    cfg.openai_token_expires_at = Date.now() + (result.expiresIn * 1000);
  }
  // Clear any old api_key to avoid confusion
  delete cfg.openai_api_key;
  save(cfg);
}

/**
 * Check if the stored OpenAI OAuth token is expired.
 * Returns true if expired or no expiry info, false if still valid.
 */
function isTokenExpired() {
  const expiresAt = get('openai_token_expires_at');
  if (!expiresAt) return true;
  // 60-second buffer
  return Date.now() >= (expiresAt - 60_000);
}

module.exports = {
  load, save, get, set, unset,
  getApiKey, getOpenAIAuth, saveSubscriptionAuth, isTokenExpired,
  CONFIG_PATH, CONFIG_DIR,
};
