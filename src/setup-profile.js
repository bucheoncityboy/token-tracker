const fs = require('fs');
const path = require('path');
const os = require('os');

function configurePowerShellProfile() {
  try {
    const userHome = os.homedir();
    const profileDir = path.join(userHome, 'Documents', 'WindowsPowerShell');
    const profilePath = path.join(profileDir, 'Microsoft.PowerShell_profile.ps1');

    // Ensure directory exists
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    // Read existing content
    let content = '';
    if (fs.existsSync(profilePath)) {
      content = fs.readFileSync(profilePath, 'utf8');
    }

    const utf8Snippet = '\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n';
    const tokenScriptPath = path.resolve(__dirname, '..', 'token.ps1');
    const functionSnippet = `\nfunction token { & "${tokenScriptPath}" @args }\n`;

    let updated = false;
    let newContent = content;

    // 1. Inject UTF-8 console output setup if not present
    if (!newContent.includes('[Console]::OutputEncoding')) {
      newContent = utf8Snippet + newContent;
      updated = true;
    }

    // 2. Inject or intelligently update the global token function path
    const tokenRegex = /function\s+token\s*\{[^}]*\}/g;
    if (tokenRegex.test(newContent)) {
      newContent = newContent.replace(tokenRegex, `function token { & "${tokenScriptPath}" @args }`);
      updated = true;
    } else {
      newContent = newContent + functionSnippet;
      updated = true;
    }

    if (updated) {
      fs.writeFileSync(profilePath, newContent, 'utf8');
      console.log(`✓ PowerShell profile configured and updated successfully.`);
    }
  } catch (err) {
    console.error(`✗ Failed to configure PowerShell profile: ${err.message}`);
  }
}

// ─── Legacy IDE Auto-Unlink Feature (Cleanup) ───

const appData = process.env.APPDATA || (process.platform === 'darwin' ? `${process.env.HOME}/Library/Application Support` : `${process.env.HOME}/.config`);
const vscodeSettingsPath = path.join(appData, 'Code', 'User', 'settings.json');
const continueConfigPath = path.join(os.homedir(), '.continue', 'config.json');

function toggleVscodeProxy(enable) {
  if (enable) return; // Linking is deprecated
  if (!fs.existsSync(vscodeSettingsPath)) return;
  try {
    const raw = fs.readFileSync(vscodeSettingsPath, 'utf8');
    const settings = JSON.parse(raw);
    
    // Restore from backup
    if (settings['token-tracker.backup.openai.baseUrl'] !== undefined) {
      settings['openai.baseUrl'] = settings['token-tracker.backup.openai.baseUrl'];
      delete settings['token-tracker.backup.openai.baseUrl'];
    } else if (settings['openai.baseUrl'] === 'http://localhost:3000/v1') {
      delete settings['openai.baseUrl'];
    }
    console.log('✓ VS Code settings.json successfully restored to original configuration.');
    
    fs.writeFileSync(vscodeSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    // ignore
  }
}

function toggleContinueProxy(enable) {
  if (enable) return; // Linking is deprecated
  if (!fs.existsSync(continueConfigPath)) return;
  try {
    const raw = fs.readFileSync(continueConfigPath, 'utf8');
    const config = JSON.parse(raw);
    
    if (Array.isArray(config.models)) {
      config.models.forEach(model => {
        if (model.backupApiBase !== undefined) {
          model.apiBase = model.backupApiBase;
          delete model.backupApiBase;
        } else if (model.apiBase === 'http://localhost:3000/v1') {
          delete model.apiBase;
        }
      });
      console.log(`✓ Continue config.json successfully unlinked from localhost:3000`);
    }
    
    fs.writeFileSync(continueConfigPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    // ignore
  }
}

function togglePowerShellEnvProxy(enable) {
  if (enable) return; // Linking is deprecated
  try {
    const userHome = os.homedir();
    const profileDir = path.join(userHome, 'Documents', 'WindowsPowerShell');
    const profilePath = path.join(profileDir, 'Microsoft.PowerShell_profile.ps1');

    if (!fs.existsSync(profilePath)) return;

    let content = fs.readFileSync(profilePath, 'utf8');
    if (content.includes('Token Tracker Env Proxy')) {
      const regex = /\n*# ─── Token Tracker Env Proxy ───[\s\S]*?# ───────────────────────────────\n*/g;
      content = content.replace(regex, '\n');
      fs.writeFileSync(profilePath, content, 'utf8');
      console.log(`✓ PowerShell profile unlinked successfully (Env Variables).`);
    }
  } catch (err) {
    // ignore
  }
}

const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml');

function toggleCodexProxy(enable) {
  if (enable) return; // Linking is deprecated
  try {
    if (!fs.existsSync(codexConfigPath)) return;
    let content = fs.readFileSync(codexConfigPath, 'utf8');
    let lines = content.split(/\r?\n/);
    
    let baseUrlIdx = -1;
    let backupIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('openai_base_url')) baseUrlIdx = i;
      if (line.startsWith('backup_openai_base_url')) backupIdx = i;
    }

    if (baseUrlIdx !== -1) {
      if (backupIdx !== -1) {
        const backupVal = lines[backupIdx].split('=')[1].trim();
        lines[baseUrlIdx] = `openai_base_url = ${backupVal}`;
        lines.splice(backupIdx, 1);
      } else if (lines[baseUrlIdx].includes('localhost:3000')) {
        lines.splice(baseUrlIdx, 1);
      }
      console.log('✓ Codex CLI config.toml successfully restored to original configuration.');
      fs.writeFileSync(codexConfigPath, lines.join('\n'), 'utf8');
    }
  } catch (e) {
    // ignore
  }
}

// Command dispatcher
const arg = process.argv[2];
if (arg === '--link') {
  console.log('ℹ️  Linking is no longer required. Token Tracker now reads directly from the Codex database.');
} else if (arg === '--unlink') {
  console.log('🔌 Cleaning up legacy proxy links from VS Code, Continue, & Codex CLI...');
  toggleVscodeProxy(false);
  toggleContinueProxy(false);
  togglePowerShellEnvProxy(false);
  toggleCodexProxy(false);
} else {
  // Default to profile setup
  configurePowerShellProfile();
}
