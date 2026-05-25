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

  const server = http.createServer((req, res) => {
    const { pathname, query } = parsePath(req.url);

    // CORS headers for dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
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
