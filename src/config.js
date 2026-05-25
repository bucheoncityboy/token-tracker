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
  const configKey = provider === 'openai' ? 'openai_api_key' : 'anthropic_api_key';
  return get(configKey);
}

module.exports = { load, save, get, set, unset, getApiKey, CONFIG_PATH, CONFIG_DIR };
