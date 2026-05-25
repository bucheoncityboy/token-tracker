// token-tracker — Built-in web dashboard server
//
// Serves:
//   GET  /              → Dashboard HTML (Chart.js)
//   GET  /api/stats     → Global statistics JSON
//   GET  /api/sessions  → Session list JSON (?since=7d&model=...)
//   GET  /api/sessions/:id → Single session detail
//   GET  /api/tokens/daily  → Daily aggregation
//   GET  /api/tokens/by-model → Per-model aggregation
//   GET  /api/refresh   → SSE endpoint for auto-refresh

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const db = require('./db');

function startServer(port = 3000, dbPath) {
  // Read dashboard HTML template once
  const templatePath = path.join(__dirname, 'dashboard.html');
  let dashboardHtml = '';
  try {
    dashboardHtml = fs.readFileSync(templatePath, 'utf8');
  } catch {
    // Inline minimal fallback
    dashboardHtml = '<html><body><h1>🪨 Token Tracker</h1><p>Dashboard template not found.</p></body></html>';
  }

  // SSE clients for auto-refresh
  const sseClients = new Set();

  function sendSSE(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try { res.write(msg); } catch { sseClients.delete(res); }
    }
  }

  function parsePath(reqUrl) {
    const parsed = new URL(reqUrl, `http://localhost:${port}`);
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const query = Object.fromEntries(parsed.searchParams.entries());
    return { pathname, query };
  }

  function readRequestBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => resolve(body));
    });
  }

  const server = http.createServer(async (req, res) => {
    const { pathname, query } = parsePath(req.url);

    // CORS headers for dev / external integrations like Codex
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, OpenAI-Organization, OpenAI-Project');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // ── OpenAI API Adapter Proxy Interceptor ──────
      if (pathname === '/v1/chat/completions' || pathname === '/v1/responses') {
        if (req.method !== 'POST') {
          jsonResponse(res, { error: 'Method not allowed' }, 405);
          return;
        }

        const rawBody = await readRequestBody(req);
        let reqJson;
        try {
          reqJson = JSON.parse(rawBody);
        } catch {
          jsonResponse(res, { error: 'Invalid JSON request body' }, 400);
          return;
        }

        const config = require('./config');
        const auth = config.getOpenAIAuth();

        if (!auth.type) {
          jsonResponse(res, { error: 'Not logged in. Please run: token login' }, 401);
          return;
        }

        // Auto-create/reuse active session
        const activeSession = db.getActiveSession() || db.createSession({ 
          label: 'Codex Auto Session', 
          model: reqJson.model || 'gpt-4o' 
        });

        let targetPath = '/v1/chat/completions';
        let requestBody = rawBody;
        const isSubscription = (auth.type === 'subscription');
        const isStreamRequested = (reqJson.stream === true);

        // Dynamic Adapter Spec Translation (Standard Chat completions -> ChatGPT Plus Responses API)
        if (isSubscription) {
          targetPath = '/v1/responses';
          
          if (pathname === '/v1/chat/completions') {
            const messages = reqJson.messages || [];
            const lastMessage = messages[messages.length - 1];
            const promptText = lastMessage ? lastMessage.content : '';
            
            requestBody = JSON.stringify({
              model: reqJson.model || 'gpt-4o',
              input: promptText
            });
          }
        }

        // Fetch valid active access token (auto-refresh if OAuth expired)
        let token;
        try {
          const oauth = require('./oauth');
          token = isSubscription ? await oauth.ensureValidToken() : auth.token;
        } catch (err) {
          jsonResponse(res, { error: 'Auth token resolution failed', details: err.message }, 401);
          return;
        }

        // Extract Organization and Project context dynamically from JWT payload
        let orgId = null;
        let projectId = null;
        try {
          const parts = token.split('.');
          if (parts.length > 1) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (payload.org_id) orgId = payload.org_id;
            else if (payload.org) orgId = payload.org;
            if (!orgId && payload.orgs && Array.isArray(payload.orgs.data)) {
              const activeOrg = payload.orgs.data.find(o => o.role === 'owner' || o.role === 'member') || payload.orgs.data[0];
              if (activeOrg) orgId = activeOrg.id;
            }
            if (payload.project_id) projectId = payload.project_id;
          }
        } catch {}

        // Recursive Relayer supporting intelligent API Key fallback
        function executeRelay(useSubscriptionToken, isFallbackRetry = false) {
          const currentToken = useSubscriptionToken ? token : (config.get('openai_api_key') || process.env.OPENAI_API_KEY);
          
          if (!currentToken) {
            jsonResponse(res, { 
              error: 'Authentication failed. Subscription returned 401 and no fallback OpenAI API Key was found in configuration.' 
            }, 401);
            return;
          }

          const currentPath = useSubscriptionToken ? targetPath : '/v1/chat/completions';
          const currentBody = useSubscriptionToken ? requestBody : rawBody; // Fallback uses standard rawBody

          const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`,
            'Content-Length': Buffer.byteLength(currentBody),
            'User-Agent': 'openai-cli/1.0.0'
          };
          
          // Apply org context only to standard API keys to prevent subscription 401 overrides
          if (!useSubscriptionToken) {
            if (orgId) headers['OpenAI-Organization'] = orgId;
            if (projectId) headers['OpenAI-Project'] = projectId;
          }

          // ────── CASE A: Standard API Streaming Relay ──────
          if (isStreamRequested && !useSubscriptionToken) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*'
            });

            let accumulatedText = '';

            const proxyReq = https.request({
              hostname: 'api.openai.com',
              path: currentPath,
              method: 'POST',
              headers: headers
            }, (proxyRes) => {
              proxyRes.on('data', (chunk) => {
                res.write(chunk);

                const chunkStr = chunk.toString();
                const lines = chunkStr.split('\n');
                for (const line of lines) {
                  const cleanLine = line.trim();
                  if (cleanLine.startsWith('data: ') && cleanLine !== 'data: [DONE]') {
                    try {
                      const parsed = JSON.parse(cleanLine.slice(6));
                      accumulatedText += parsed.choices?.[0]?.delta?.content || '';
                    } catch {}
                  }
                }
              });

              proxyRes.on('end', () => {
                const tokenizer = require('./tokenizer');
                const { tokens: inputTokens } = tokenizer.countTokens(reqJson.messages ? reqJson.messages[reqJson.messages.length - 1]?.content : '', reqJson.model || 'gpt-4o');
                const { tokens: outputTokens } = tokenizer.countTokens(accumulatedText, reqJson.model || 'gpt-4o');

                db.insertEntry({
                  session_id: activeSession,
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                  record_method: isFallbackRetry ? 'proxy-api-stream-fallback' : 'proxy-api-stream',
                  prompt_preview: (reqJson.messages ? reqJson.messages[reqJson.messages.length - 1]?.content : '').slice(0, 200),
                  response_text: accumulatedText.slice(0, 5000)
                });

                sendSSE({ event: 'new_entry', session_id: activeSession });
                res.end();
              });
            });

            proxyReq.on('error', (err) => {
              res.write(`data: ${JSON.stringify({ error: 'Relay connection failed', details: err.message })}\n\n`);
              res.end();
            });
            proxyReq.write(currentBody);
            proxyReq.end();
            return;
          }

          // ────── CASE B: Non-stream or Subscription Adapter ──────
          const proxyReq = https.request({
            hostname: 'api.openai.com',
            path: currentPath,
            method: 'POST',
            headers: headers
          }, (proxyRes) => {
            let responseData = '';
            proxyRes.on('data', chunk => responseData += chunk);
            proxyRes.on('end', () => {
              // 401 Unauthorized Fallback Mechanism:
              // If ChatGPT Plus subscription fails due to missing scopes, transparently retry using standard API key!
              if (proxyRes.statusCode === 401 && useSubscriptionToken && !isFallbackRetry) {
                const fallbackKey = config.get('openai_api_key') || process.env.OPENAI_API_KEY;
                if (fallbackKey) {
                  console.warn('  ⚠ Subscription auth failed (401). Falling back to standard OpenAI API Key safely...');
                  executeRelay(false, true); // Trigger recursive fallback relay
                  return;
                }
              }

              if (proxyRes.statusCode !== 200) {
                res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
                res.end(responseData);
                return;
              }

              try {
                const resJson = JSON.parse(responseData);
                let inputTokens = 0, outputTokens = 0, responseText = '';

                if (useSubscriptionToken) {
                  inputTokens = resJson.usage?.input_tokens || 0;
                  outputTokens = resJson.usage?.output_tokens || 0;
                  
                  if (Array.isArray(resJson.output)) {
                    for (const item of resJson.output) {
                      if (item && item.type === 'message' && Array.isArray(item.content)) {
                        for (const block of item.content) {
                          if (block && block.type === 'output_text') {
                            responseText += block.text;
                          }
                        }
                      }
                    }
                  }
                  if (!responseText && resJson.output_text) responseText = resJson.output_text;

                  // 1. Save data instantly to local SQLite
                  db.insertEntry({
                    session_id: activeSession,
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                    record_method: isStreamRequested ? 'proxy-subscription-stream' : 'proxy-subscription',
                    prompt_preview: (reqJson.messages ? reqJson.messages[reqJson.messages.length - 1]?.content : reqJson.input || '').slice(0, 200),
                    response_text: responseText.slice(0, 5000)
                  });
                  sendSSE({ event: 'new_entry', session_id: activeSession });

                  // 2. If stream requested, execute typing emulator chunk-delivery!
                  if (isStreamRequested && pathname === '/v1/chat/completions') {
                    res.writeHead(200, {
                      'Content-Type': 'text/event-stream',
                      'Cache-Control': 'no-cache',
                      'Connection': 'keep-alive',
                      'Access-Control-Allow-Origin': '*'
                    });

                    const words = responseText.match(/[\s\S]{1,4}/g) || [responseText];
                    let index = 0;

                    function sendNextChunk() {
                      if (index >= words.length) {
                        res.write('data: [DONE]\n\n');
                        res.end();
                        return;
                      }

                      const chunkText = words[index];
                      const sseChunk = {
                        id: `chatcmpl-${resJson.id || Date.now()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: reqJson.model || 'gpt-4o',
                        choices: [{
                          index: 0,
                          delta: { content: chunkText },
                          finish_reason: null
                        }]
                      };

                      res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
                      index++;
                      setTimeout(sendNextChunk, Math.random() * 15 + 10);
                    }

                    sendNextChunk();
                    return;
                  }

                  // Non-stream spec translation back to standard chat completions
                  if (pathname === '/v1/chat/completions') {
                    const chatFormat = {
                      id: `chatcmpl-${resJson.id || Date.now()}`,
                      object: 'chat.completion',
                      created: Math.floor(Date.now() / 1000),
                      model: resJson.model || reqJson.model || 'gpt-4o',
                      choices: [{
                        index: 0,
                        message: { role: 'assistant', content: responseText },
                        finish_reason: 'stop'
                      }],
                      usage: {
                        prompt_tokens: inputTokens,
                        completion_tokens: outputTokens,
                        total_tokens: inputTokens + outputTokens
                      }
                    };
                    responseData = JSON.stringify(chatFormat);
                  }
                } else {
                  // Standard Non-stream API completions parser
                  inputTokens = resJson.usage?.prompt_tokens || 0;
                  outputTokens = resJson.usage?.completion_tokens || 0;
                  responseText = resJson.choices?.[0]?.message?.content || '';
                  
                  db.insertEntry({
                    session_id: activeSession,
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                    record_method: isFallbackRetry ? 'proxy-api-fallback' : 'proxy-api',
                    prompt_preview: (reqJson.messages ? reqJson.messages[reqJson.messages.length - 1]?.content : '').slice(0, 200),
                    response_text: responseText.slice(0, 5000)
                  });
                  sendSSE({ event: 'new_entry', session_id: activeSession });
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(responseData);

              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Proxy payload transformation failed', details: err.message }));
              }
            });
          });

          proxyReq.on('error', (err) => {
            jsonResponse(res, { error: 'OpenAI relay proxy connection failed', details: err.message }, 502);
          });
          proxyReq.write(currentBody);
          proxyReq.end();
        }

        // Trigger initial relay execution
        executeRelay(isSubscription);
        return;
      }

      // ── Dashboard HTML ──────────────────────────
      if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(dashboardHtml);
        return;
      }

      // ── Download HTML Report ─────────────────────
      if (pathname === '/api/report/download') {
        try {
          const report = require('./report');
          const tmpFile = path.join(require('os').tmpdir(), `token-report-${Date.now()}.html`);
          const outPath = report.generateHtml({ outputPath: tmpFile, since: query.since || null });
          const html = fs.readFileSync(outPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="token-report.html"' });
          res.end(html);
          try { fs.unlinkSync(outPath); } catch {}
        } catch (err) {
          console.error('Report generation error:', err.message);
          jsonResponse(res, { error: 'Failed to generate report' }, 500);
        }
        return;
      }

      // ── SSE Auto-refresh ─────────────────────────
      if (pathname === '/api/refresh') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ connected: true, interval: 30 })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      // ── API: Global stats ────────────────────────
      if (pathname === '/api/stats') {
        const since = query.since || null;
        const stats = db.getGlobalStats({ since });
        const sessions = db.listSessions({ limit: null, since });
        const totalTokens = (stats.total_input || 0) + (stats.total_output || 0);

        // Calculate est costs
        const allSessions = db.listSessions({ limit: null, since });
        let totalCost = 0;
        for (const s of allSessions) {
          const cost = db.estimateCost(s.model, s.total_input || 0, s.total_output || 0);
          if (cost !== null) totalCost += cost;
        }

        jsonResponse(res, { ...stats, total_tokens: totalTokens, total_cost: totalCost });
        return;
      }

      // ── API: Sessions list ───────────────────────
      if (pathname === '/api/sessions') {
        const sessions = db.listSessions({
          limit: query.limit ? parseInt(query.limit) : null,
          since: query.since || null,
          model: query.model || null,
        });

        // Add cost per session
        const enriched = sessions.map(s => {
          const cost = db.estimateCost(s.model, s.total_input || 0, s.total_output || 0);
          return { ...s, cost: cost || 0 };
        });

        jsonResponse(res, enriched);
        return;
      }

      // ── API: Single session ──────────────────────
      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        const sid = sessionMatch[1];
        const stats = db.getSessionStats(sid);
        if (!stats) {
          jsonResponse(res, { error: 'Session not found' }, 404);
          return;
        }
        const entries = db.getEntries(sid, { limit: query.limit ? parseInt(query.limit) : null });
        // Attach model to each entry so dashboard can show per-turn model info
        const enrichedEntries = entries.map(e => ({ ...e, model: stats.model }));
        const cost = db.estimateCost(stats.model, stats.total_input || 0, stats.total_output || 0);
        jsonResponse(res, { ...stats, entries: enrichedEntries, cost: cost || 0 });
        return;
      }

      // ── API: Daily tokens ────────────────────────
      if (pathname === '/api/tokens/daily') {
        const daily = db.getDailyStats({
          since: query.since || '7 days',
          limit: query.limit ? parseInt(query.limit) : null,
        });
        jsonResponse(res, daily);
        return;
      }

      // ── API: By model ────────────────────────────
      if (pathname === '/api/tokens/by-model') {
        const models = db.getModelStats({ since: query.since || null });
        const enriched = models.map(m => {
          const cost = db.estimateCost(m.model, m.total_input, m.total_output);
          return { ...m, cost: cost || 0 };
        });
        jsonResponse(res, enriched);
        return;
      }

      // ── 404 ───────────────────────────────────────
      jsonResponse(res, { error: 'Not found', path: pathname }, 404);
    } catch (err) {
      console.error('Server error:', err.message);
      jsonResponse(res, { error: err.message }, 500);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`✗ Port ${port} is already in use.`);
      console.error(`  Try: token-tracker serve --port ${port + 1}`);
    } else {
      console.error(`✗ Server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`🪨 Token Tracker Dashboard\n`);
    console.log(`  Local:   http://localhost:${port}`);
    console.log(`  API:     http://localhost:${port}/api/stats`);
    console.log(`  DB:      ${db.DB_PATH}`);
    console.log(`  Refresh: auto (SSE, every 30s)`);
    console.log();
  });

  return server;
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

module.exports = { startServer };
