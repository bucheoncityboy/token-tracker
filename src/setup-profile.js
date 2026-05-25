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

// ─── IDE Auto-Link & Auto-Unlink Feature ───

const appData = process.env.APPDATA || (process.platform === 'darwin' ? `${process.env.HOME}/Library/Application Support` : `${process.env.HOME}/.config`);
const vscodeSettingsPath = path.join(appData, 'Code', 'User', 'settings.json');
const continueConfigPath = path.join(os.homedir(), '.continue', 'config.json');

function toggleVscodeProxy(enable) {
  if (!fs.existsSync(vscodeSettingsPath)) {
    console.log(`- VS Code settings not found at: ${vscodeSettingsPath}`);
    return;
  }
  try {
    const raw = fs.readFileSync(vscodeSettingsPath, 'utf8');
    const settings = JSON.parse(raw);
    
    if (enable) {
      // Backup original baseUrl and set localhost proxy
      if (settings['openai.baseUrl'] && settings['openai.baseUrl'] !== 'http://localhost:3000/v1') {
        settings['token-tracker.backup.openai.baseUrl'] = settings['openai.baseUrl'];
      }
      settings['openai.baseUrl'] = 'http://localhost:3000/v1';
      console.log('✓ VS Code settings.json updated to point to localhost:3000');
    } else {
      // Restore from backup
      if (settings['token-tracker.backup.openai.baseUrl'] !== undefined) {
        settings['openai.baseUrl'] = settings['token-tracker.backup.openai.baseUrl'];
        delete settings['token-tracker.backup.openai.baseUrl'];
      } else {
        delete settings['openai.baseUrl'];
      }
      console.log('✓ VS Code settings.json successfully restored to original configuration.');
    }
    
    fs.writeFileSync(vscodeSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error(`✗ Failed to update VS Code settings: ${e.message}`);
  }
}

function toggleContinueProxy(enable) {
  if (!fs.existsSync(continueConfigPath)) {
    console.log(`- Continue settings not found at: ${continueConfigPath}`);
    return;
  }
  try {
    const raw = fs.readFileSync(continueConfigPath, 'utf8');
    const config = JSON.parse(raw);
    
    if (Array.isArray(config.models)) {
      config.models.forEach(model => {
        if (model.provider === 'openai' || model.provider === 'openai-aio' || (model.apiBase && model.apiBase.includes('api.openai.com'))) {
          if (enable) {
            if (model.apiBase && model.apiBase !== 'http://localhost:3000/v1') {
              model.backupApiBase = model.apiBase;
            }
            model.apiBase = 'http://localhost:3000/v1';
          } else {
            if (model.backupApiBase !== undefined) {
              model.apiBase = model.backupApiBase;
              delete model.backupApiBase;
            } else {
              delete model.apiBase;
            }
          }
        }
      });
      console.log(`✓ Continue config.json successfully ${enable ? 'linked to' : 'unlinked from'} localhost:3000`);
    }
    
    fs.writeFileSync(continueConfigPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error(`✗ Failed to update Continue settings: ${e.message}`);
  }
}

function togglePowerShellEnvProxy(enable) {
  try {
    const userHome = os.homedir();
    const profileDir = path.join(userHome, 'Documents', 'WindowsPowerShell');
    const profilePath = path.join(profileDir, 'Microsoft.PowerShell_profile.ps1');

    if (!fs.existsSync(profilePath)) {
      if (!enable) return;
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }
    }

    let content = '';
    if (fs.existsSync(profilePath)) {
      content = fs.readFileSync(profilePath, 'utf8');
    }

    const envSnippet = '\n# ─── Token Tracker Env Proxy ───\n$env:OPENAI_BASE_URL="http://localhost:3000/v1"\n$env:OPENAI_API_BASE="http://localhost:3000/v1"\n# ───────────────────────────────\n';

    let newContent = content;
    let updated = false;

    if (enable) {
      if (!newContent.includes('Token Tracker Env Proxy')) {
        newContent = newContent + envSnippet;
        updated = true;
      }
    } else {
      if (newContent.includes('Token Tracker Env Proxy')) {
        const regex = /\n*# ─── Token Tracker Env Proxy ───[\s\S]*?# ───────────────────────────────\n*/g;
        newContent = newContent.replace(regex, '\n');
        updated = true;
      }
    }

    if (updated) {
      fs.writeFileSync(profilePath, newContent, 'utf8');
      console.log(`✓ PowerShell profile ${enable ? 'linked' : 'unlinked'} successfully (Env Variables).`);
    }
  } catch (err) {
    console.error(`✗ Failed to update PowerShell profile env vars: ${err.message}`);
  }
}

const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml');

function toggleCodexProxy(enable) {
  const codexDir = path.join(os.homedir(), '.codex');
  if (!fs.existsSync(codexDir)) {
    if (!enable) return;
    fs.mkdirSync(codexDir, { recursive: true });
  }

  try {
    let content = '';
    if (fs.existsSync(codexConfigPath)) {
      content = fs.readFileSync(codexConfigPath, 'utf8');
    }

    let lines = content.split(/\r?\n/);
    let updated = false;

    // Look for openai_base_url line at the top level (outside of [tables])
    let baseUrlIdx = -1;
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('[')) {
        inTable = true;
      }
      if (!inTable && line.startsWith('openai_base_url')) {
        baseUrlIdx = i;
        break;
      }
    }

    if (enable) {
      if (baseUrlIdx !== -1) {
        const val = lines[baseUrlIdx].split('=')[1].trim().replace(/['"]/g, '');
        if (val !== 'http://localhost:3000/v1') {
          // Backup original
          let backupIdx = lines.findIndex(l => l.trim().startsWith('backup_openai_base_url'));
          if (backupIdx === -1) {
            lines.splice(baseUrlIdx, 0, `backup_openai_base_url = "${val}"`);
            baseUrlIdx++; // account for insertion
          }
          lines[baseUrlIdx] = 'openai_base_url = "http://localhost:3000/v1"';
          updated = true;
        }
      } else {
        // Insert at the top level
        lines.unshift('openai_base_url = "http://localhost:3000/v1"');
        updated = true;
      }
      console.log('✓ Codex CLI config.toml updated to point to localhost:3000');
    } else {
      // Unlink
      let backupIdx = lines.findIndex(l => l.trim().startsWith('backup_openai_base_url'));
      if (baseUrlIdx !== -1) {
        if (backupIdx !== -1) {
          const backupVal = lines[backupIdx].split('=')[1].trim();
          lines[baseUrlIdx] = `openai_base_url = ${backupVal}`;
          lines.splice(backupIdx, 1);
        } else {
          lines.splice(baseUrlIdx, 1);
        }
        updated = true;
      }
      console.log('✓ Codex CLI config.toml successfully restored to original configuration.');
    }

    if (updated) {
      fs.writeFileSync(codexConfigPath, lines.join('\n'), 'utf8');
    }
  } catch (e) {
    console.error(`✗ Failed to update Codex CLI config: ${e.message}`);
  }
}

// Command dispatcher
const arg = process.argv[2];
if (arg === '--link') {
  console.log('🔗 Linking VS Code, Continue, & Codex CLI configurations to local Token Tracker proxy...');
  toggleVscodeProxy(true);
  toggleContinueProxy(true);
  togglePowerShellEnvProxy(true);
  toggleCodexProxy(true);
} else if (arg === '--unlink') {
  console.log('🔌 Unlinking VS Code, Continue, & Codex CLI configurations from local proxy...');
  toggleVscodeProxy(false);
  toggleContinueProxy(false);
  togglePowerShellEnvProxy(false);
  toggleCodexProxy(false);
} else {
  // Default to profile setup
  configurePowerShellProfile();
}
