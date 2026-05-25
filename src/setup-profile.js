const fs = require('fs');
const path = require('path');
const os = require('os');

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
    console.log(`✓ PowerShell profile configured and updated at: ${profilePath}`);
  }
} catch (err) {
  console.error(`✗ Failed to configure PowerShell profile: ${err.message}`);
  process.exit(1);
}
