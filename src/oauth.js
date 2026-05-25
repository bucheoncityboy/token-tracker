// token-tracker — OpenAI OAuth (subscription login) via PKCE flow
//
// This implements the same OAuth flow used by pi CLI:
//   1. Generate PKCE challenge + local server
//   2. Open browser for authorization
//   3. Catch redirect callback
//   4. Exchange code for tokens
//   5. Save to config

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';  // OpenAI × pi client
const AUTH_BASE = 'https://auth.openai.com';
const TOKEN_ENDPOINT = '/oauth/token';
const AUTHORIZE_ENDPOINT = '/oauth/authorize';

/**
 * Generate PKCE code verifier (random 64 chars, unreserved set)
 */
function generateCodeVerifier() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  const bytes = crypto.randomBytes(64);
  for (let i = 0; i < 64; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Base64URL-encode a buffer (no padding)
 */
function base64URLEncode(buf) {
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Generate PKCE code challenge (SHA256 of verifier)
 */
function generateCodeChallenge(verifier) {
  return base64URLEncode(crypto.createHash('sha256').update(verifier).digest());
}

/**
 * Generate random state string for CSRF protection
 */
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Find a free port by trying common ports starting from a base
 */
function findFreePort(basePort = 1455) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(basePort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // Port in use, try next
      findFreePort(basePort + 1).then(resolve, reject);
    });
  });
}

/**
 * Make an HTTPS POST request and return parsed JSON
 */
function httpsPost(hostname, path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
      },
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Run the full OAuth device-code-style flow using PKCE + local server.
 * Returns { access_token, refresh_token, expires_in, payload } on success.
 */
async function loginWithSubscription() {
  // 1. Generate PKCE params
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // 2. Find free port and start local server
  const port = await findFreePort(1455);
  const redirectUri = `http://localhost:${port}/auth/callback`;

  // 3. Build authorize URL
  const params = new url.URLSearchParams({
    response_type: 'code',
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
  });
  const authorizeUrl = `${AUTH_BASE}${AUTHORIZE_ENDPOINT}?${params.toString()}`;

  // 4. Start local server to catch callback
  const tokenPromise = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsed = new url.URL(req.url, `http://localhost:${port}`);
      const query = Object.fromEntries(parsed.searchParams.entries());

      if (parsed.pathname === '/auth/callback') {
        // Verify state matches (CSRF protection)
        if (query.state !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>State mismatch</h1><p>CSRF detected. Close this tab and try again.</p>');
          reject(new Error('State mismatch - possible CSRF attack'));
          server.close();
          return;
        }

        if (query.code) {
          // Show success page to user
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#1a1a2e;color:white;"><div style="text-align:center"><h1>✓ Token Tracker</h1><p>Logged in successfully! You can close this tab.</p></div></body></html>`);

          // Exchange code for tokens
          try {
            const result = await httpsPost('auth.openai.com', TOKEN_ENDPOINT, {
              grant_type: 'authorization_code',
              code: query.code,
              redirect_uri: redirectUri,
              client_id: OAUTH_CLIENT_ID,
              code_verifier: codeVerifier,
            });

            if (result.status === 200 && result.data.access_token) {
              server.close();
              resolve(result.data);
            } else {
              server.close();
              reject(new Error(`Token exchange failed: ${JSON.stringify(result.data)}`));
            }
          } catch (e) {
            server.close();
            reject(e);
          }
        } else if (query.error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error</h1><p>${query.error}: ${query.error_description || ''}</p>`);
          server.close();
          reject(new Error(`OAuth error: ${query.error} - ${query.error_description || ''}`));
        }
      }
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`  Listening on http://localhost:${port}`);
      console.log(`  Opening browser...`);
      // Open browser
      try {
        const { execSync } = require('child_process');
        execSync(`start "" "${authorizeUrl}"`, { timeout: 5000, windowsHide: true });
      } catch {
        console.log(`  Open this URL manually:\n  ${authorizeUrl}`);
      }
      console.log(`\n  Waiting for login in browser...`);
    });

    server.on('error', reject);

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out after 5 minutes'));
    }, 5 * 60 * 1000);
  });

  const tokenData = await tokenPromise;

  // Decode JWT to extract profile info
  let payload = {};
  try {
    const parts = tokenData.access_token.split('.');
    payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
  } catch {}

  return {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || '',
    expires_in: tokenData.expires_in || 0,
    payload,
  };
}

/**
 * Refresh an expired OAuth access token using the refresh token.
 * Returns { access_token, refresh_token, expires_in } on success.
 */
async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('No refresh token available. Please login again: token-tracker openai login --subscription');
  }

  const result = await httpsPost('auth.openai.com', TOKEN_ENDPOINT, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
  });

  if (result.status === 200 && result.data.access_token) {
    return {
      access_token: result.data.access_token,
      refresh_token: result.data.refresh_token || refreshToken, // keep old if not returned
      expires_in: result.data.expires_in || 0,
    };
  }

  throw new Error(`Token refresh failed (${result.status}): ${JSON.stringify(result.data)}`);
}

/**
 * Ensure the stored OpenAI OAuth token is valid.
 * If expired, refresh it and save the new token to config.
 * Returns the valid access token.
 */
async function ensureValidToken() {
  const config = require('./config');
  const auth = config.getOpenAIAuth();

  if (auth.type !== 'subscription') {
    throw new Error('Not logged in with subscription. Run: token-tracker openai login --subscription');
  }

  if (!config.isTokenExpired()) {
    return auth.token;
  }

  // Token expired — refresh it
  console.log('  ⟳ Token expired, refreshing...');
  try {
    const refreshed = await refreshAccessToken(auth.refreshToken);
    config.saveSubscriptionAuth({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresIn: refreshed.expires_in,
    });
    console.log('  ✓ Token refreshed successfully');
    return refreshed.access_token;
  } catch (e) {
    throw new Error(`Token refresh failed: ${e.message}\n  Please login again: token-tracker openai login --subscription`);
  }
}

module.exports = { loginWithSubscription, refreshAccessToken, ensureValidToken, generateCodeVerifier, generateCodeChallenge };
