// token-tracker — Static HTML report generator
//
// Generates a standalone HTML file with embedded Chart.js visualizations.
// All data is inlined as JSON — no server needed, just open the file.

const fs = require('fs');
const path = require('path');
const db = require('./db');
const formatter = require('./formatter');

function generateHtml({ since, outputPath } = {}) {
  // Gather data
  const globalStats = db.getGlobalStats({ since });
  const dailyStats = db.getDailyStats({ since, limit: 30 });
  const modelStats = db.getModelStats({ since });
  const sessions = db.listSessions({ limit: 50, since: since || null });

  // Compute costs
  const modelCosts = modelStats.map(m => {
    const cost = db.estimateCost(m.model, m.total_input, m.total_output);
    return { ...m, cost: cost || 0 };
  });
  const totalCost = modelCosts.reduce((s, m) => s + m.cost, 0);

  // Build data JSON
  // CRITICAL: JSON.stringify does NOT escape </script> sequences.
  // Embedding in <script> tag context requires escaping </script> to prevent XSS.
  function escapeScriptTag(s) {
    return s.replace(/<\//g, '<\\/');
  }
  const dataJson = escapeScriptTag(JSON.stringify({
    generated_at: new Date().toISOString(),
    since: since || 'all',
    stats: {
      total_sessions: globalStats.total_sessions || 0,
      total_entries: globalStats.total_entries || 0,
      completed: globalStats.completed_sessions || 0,
      active: globalStats.active_sessions || 0,
      total_input: globalStats.total_input || 0,
      total_output: globalStats.total_output || 0,
      total_cost: totalCost,
    },
    daily: dailyStats.map(d => ({
      day: d.day,
      input: d.input_tokens,
      output: d.output_tokens,
      calls: d.calls,
    })),
    models: modelCosts.map(m => ({
      name: m.model || 'unknown',
      input: m.total_input,
      output: m.total_output,
      cost: m.cost,
      sessions: m.sessions,
    })),
    sessions: sessions.slice(0, 20).map(s => {
      const entries = db.getEntries(s.id, { limit: 50 });
      return {
        id: s.id,
        label: s.label || '',
        model: s.model || '',
        input: s.total_input || 0,
        output: s.total_output || 0,
        total: (s.total_input || 0) + (s.total_output || 0),
        status: s.ended_at ? 'done' : 'active',
        date: (s.started_at || '').slice(0, 10),
        entries: entries.map(e => ({
          n: e.turn_number || e.id,
          in: e.input_tokens,
          out: e.output_tokens,
          q: (e.prompt_preview || '').slice(0, 300),
          a: (e.response_text || '').slice(0, 1000),
          model: s.model || '',
        })),
      };
    }),
  }));

  const title = since ? `Token Report (last ${since})` : 'Token Report (all time)';

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f0f2f5; color: #1a1a2e; }
.header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 24px 40px; display: flex; justify-content: space-between; align-items: center; }
.header h1 { font-size: 22px; font-weight: 600; }
.header span { color: #94a3b8; font-size: 13px; }
.container { max-width: 1100px; margin: 0 auto; padding: 20px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px; }
.card { background: white; border-radius: 10px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.card .lbl { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
.card .val { font-size: 26px; font-weight: 700; margin-top: 6px; }
.card .sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.chart-row { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; margin-bottom: 20px; }
.chart-box { background: white; border-radius: 10px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.chart-box h3 { font-size: 13px; color: #64748b; margin-bottom: 10px; font-weight: 500; }
.chart-box canvas { max-height: 260px; }
table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
th { text-align: left; padding: 10px 14px; font-size: 11px; text-transform: uppercase; color: #64748b; background: #f8fafc; font-weight: 500; }
td { padding: 10px 14px; font-size: 13px; border-top: 1px solid #f1f5f9; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 500; }
.tag-sonnet { background: #dbeafe; color: #1d4ed8; }
.tag-gpt { background: #fef3c7; color: #92400e; }
.tag-gemini { background: #d1fae5; color: #065f46; }
.tag-haiku { background: #f3e8ff; color: #6b21a8; }
.tag-other { background: #f1f5f9; color: #475569; }
.dot-active { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; margin-right: 4px; }
.footer { text-align: center; color: #94a3b8; font-size: 11px; padding: 16px; }
.num { font-variant-numeric: tabular-nums; }

/* ── Tabs ── */
.tab-bar { display:flex; gap:0; margin-bottom:20px; background:white; border-radius:10px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
.tab-btn { flex:1; padding:12px 16px; text-align:center; font-size:13px; font-weight:500; color:#64748b; background:white; border:none; cursor:pointer; transition:all 0.15s; }
.tab-btn:hover { background:#f8fafc; }
.tab-btn.active { color:#2563eb; background:#eff6ff; box-shadow:inset 0 -2px 0 #2563eb; }
.tab-panel { display:none; }
.tab-panel.active { display:block; }

/* ── Accordion rows ── */
.entry-row { background:white; border-radius:8px; margin-bottom:6px; box-shadow:0 1px 2px rgba(0,0,0,0.06); overflow:hidden; }
.entry-header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; cursor:pointer; transition:background 0.1s; }
.entry-header:hover { background:#f8fafc; }
.entry-body { display:none; padding:0 14px 12px 14px; border-top:1px solid #f1f5f9; }
.entry-body.open { display:block; }
.qa-bubble { border-radius:6px; padding:8px 10px; font-size:13px; white-space:pre-wrap; word-break:break-word; }
.qa-q { background:#f0f7ff; margin-bottom:6px; }
.qa-a { background:#faf5ff; }
</style>
</head>
<body>
<div class="header">
  <div><h1>🪨 Token Report</h1><span>${escapeHtml(title)}</span></div>
  <span>${new Date().toISOString().slice(0, 10)}</span>
</div>
<div class="container">

<!-- Tab Bar -->
<div class="tab-bar">
  <button class="tab-btn active" onclick="switchTab('stats')">📊 Stats</button>
  <button class="tab-btn" onclick="switchTab('sessions')">📋 Sessions</button>
  <button class="tab-btn" onclick="switchTab('qalog')">💬 Q&A Log</button>
</div>

<!-- Tab: Stats -->
<div id="tab-stats" class="tab-panel active">
  <div class="cards" id="statCards"></div>
  <div class="chart-row">
    <div class="chart-box">
      <h3>📊 Daily Token Usage</h3>
      <canvas id="dailyChart"></canvas>
    </div>
    <div class="chart-box">
      <h3>🧠 By Model</h3>
      <canvas id="modelChart"></canvas>
    </div>
  </div>
  <div id="modelTableWrap" style="margin-bottom:20px;"></div>
</div>

<!-- Tab: Sessions -->
<div id="tab-sessions" class="tab-panel">
  <div style="overflow-x:auto;">
  <table id="sessionTable">
    <thead>
      <tr><th>Session</th><th>Label</th><th>Model</th><th class="num">Input</th><th class="num">Output</th><th class="num">Total</th><th>Status</th></tr>
    </thead>
    <tbody id="sessionBody"></tbody>
  </table>
  </div>
</div>

<!-- Tab: Q&A Log -->
<div id="tab-qalog" class="tab-panel">
  <div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    <select id="qaSessionFilter" onchange="renderQALog()" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">
      <option value="">All sessions</option>
    </select>
    <span id="qaTotalCount" style="color:#64748b;font-size:12px;"></span>
  </div>
  <div id="qaLogEntries"></div>
</div>

<div class="footer">Generated by token-tracker · Data from SQLite</div>
</div>

<script>
const DATA = ${dataJson};

function tagClass(model) {
  const m = (model||'').toLowerCase();
  if (m.includes('sonnet')||m.includes('opus')) return 'tag-sonnet';
  if (m.includes('gpt')||m.includes('o1')||m.includes('o3')) return 'tag-gpt';
  if (m.includes('gemini')) return 'tag-gemini';
  if (m.includes('haiku')) return 'tag-haiku';
  return 'tag-other';
}

function fmt(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'k';
  return n.toLocaleString();
}

function fmtUSD(n) {
  if (n >= 1) return '$'+n.toFixed(2);
  if (n >= 0.01) return '$'+n.toFixed(3);
  return '$'+n.toFixed(4);
}

// ── Tab switching ────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.tab-btn[onclick*="'+name+'"]').classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
}

// ── Stats tab ────────────────────────────────────────────
const cards = [
  { lbl: 'Sessions', val: DATA.stats.total_sessions, sub: DATA.stats.completed+' done, '+DATA.stats.active+' active', clr: '#2563eb' },
  { lbl: 'Total Tokens', val: fmt(DATA.stats.total_input + DATA.stats.total_output), sub: 'input '+fmt(DATA.stats.total_input)+' + output '+fmt(DATA.stats.total_output), clr: '#059669' },
  { lbl: 'Total Cost', val: fmtUSD(DATA.stats.total_cost), sub: DATA.stats.total_entries+' API calls', clr: '#d97706' },
  { lbl: 'Avg Per Session', val: fmt(Math.round((DATA.stats.total_input + DATA.stats.total_output) / (DATA.stats.total_sessions||1))), sub: 'tokens per session', clr: '#7c3aed' },
];
document.getElementById('statCards').innerHTML = cards.map(c =>
  '<div class="card"><div class="lbl">'+c.lbl+'</div><div class="val" style="color:'+c.clr+'">'+c.val+'</div><div class="sub">'+c.sub+'</div></div>'
).join('');

// Daily chart
if (DATA.daily.length) {
  new Chart(document.getElementById('dailyChart'), {
    type: 'bar',
    data: {
      labels: DATA.daily.map(d => d.day.slice(5)),
      datasets: [
        { label: 'Input', data: DATA.daily.map(d => d.input), backgroundColor: '#93c5fd', borderRadius: 3 },
        { label: 'Output', data: DATA.daily.map(d => d.output), backgroundColor: '#3b82f6', borderRadius: 3 },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 12 } } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } },
               y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 } } } } }
  });
} else {
  document.getElementById('dailyChart').parentNode.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">No daily data yet.</div>';
}

// Model chart
if (DATA.models.length) {
  const colors = ['#3b82f6','#f59e0b','#10b981','#8b5cf6','#ef4444','#ec4899','#14b8a6','#f97316','#6366f1','#06b6d4','#84cc16','#d946ef','#0ea5e9','#fb923c','#a855f7','#22c55e'];
  new Chart(document.getElementById('modelChart'), {
    type: 'doughnut',
    data: {
      labels: DATA.models.map(m => m.name),
      datasets: [{ data: DATA.models.map(m => m.output), backgroundColor: colors.slice(0, DATA.models.length) }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 10 } } } },
      cutout: '55%' }
  });

  // Model breakdown table
  let modelHtml = '<table><thead><tr><th>Model</th><th class="num">Input</th><th class="num">Output</th><th class="num">Total</th><th class="num">Cost</th><th class="num">Sessions</th></tr></thead><tbody>';
  for (const m of DATA.models) {
    const total = (m.input||0)+(m.output||0);
    modelHtml += '<tr><td><span class="tag '+tagClass(m.name)+'">'+esc(m.name)+'</span></td>'+
      '<td class="num">'+fmt(m.input)+'</td>'+
      '<td class="num">'+fmt(m.output)+'</td>'+
      '<td class="num"><strong>'+fmt(total)+'</strong></td>'+
      '<td class="num">'+fmtUSD(m.cost)+'</td>'+
      '<td class="num">'+m.sessions+'</td></tr>';
  }
  modelHtml += '</tbody></table>';
  document.getElementById('modelTableWrap').innerHTML = modelHtml;
} else {
  document.getElementById('modelChart').parentNode.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">No model data yet.</div>';
}

// ── Sessions tab (accordion) ─────────────────────────────
const tbody = document.getElementById('sessionBody');
if (DATA.sessions.length) {
  tbody.innerHTML = DATA.sessions.map((s, idx) => {
    const entryRows = (s.entries||[]).map(e => {
      const qText = esc(e.q||'');
      const aText = esc(e.a||'');
      const emodel = e.model || s.model || '';
      return '<div class="entry-row">' +
        '<div class="entry-header" onclick="toggleEntry(this)">' +
          '<span style="color:#64748b;font-size:12px;">#'+(e.n||'?')+'</span>' +
          (emodel ? '<span class="tag '+tagClass(emodel)+'" style="font-size:10px;margin:0 6px;">'+esc(emodel)+'</span>' : '') +
          '<span style="color:#64748b;font-size:12px;">'+fmt(e.in)+' in · '+fmt(e.out)+' out</span>' +
          '<span style="color:#94a3b8;font-size:10px;">▸</span>' +
        '</div>' +
        '<div class="entry-body">' +
          (qText ? '<div class="qa-bubble qa-q"><span style="color:#2563eb;font-weight:500;">Q:</span> '+qText+'</div>' : '') +
          (aText ? '<div class="qa-bubble qa-a"><span style="color:#7c3aed;font-weight:500;">A:</span> '+aText+'</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    return '<tr>' +
      '<td style="font-family:monospace;font-size:12px;">'+esc(s.id)+'</td>' +
      '<td>'+esc(s.label.slice(0,30))+'</td>' +
      '<td><span class="tag '+tagClass(s.model)+'">'+esc(s.model||'-')+'</span></td>' +
      '<td class="num">'+fmt(s.input)+'</td>' +
      '<td class="num">'+fmt(s.output)+'</td>' +
      '<td class="num"><strong>'+fmt(s.total)+'</strong></td>' +
      '<td>'+(s.status==='active'?'<span class="dot-active"></span>active':'✅ done')+'</td>' +
    '</tr>' +
    '<tr id="entries-'+idx+'" style="display:none;"><td colspan="7" style="padding:8px 16px 16px 16px;background:#f8fafc;">'+entryRows+'</td></tr>';
  }).join('');
} else {
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px;">No sessions yet.</td></tr>';
}

// Make session rows toggleable
document.querySelectorAll('#sessionTable tbody tr:first-child').forEach(row => {
  // Already handled by the onclick below
});

// ── Sessions: toggle entries on row click ────────────────
document.querySelectorAll('#sessionBody tr:first-child').forEach((row, idx) => {
  // Skip header-rows — use all rows that have a sibling with id=entries-N
  // Actually just click the whole tr
});

// Click handler via delegation
document.getElementById('sessionBody').addEventListener('click', function(e) {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const next = tr.nextElementSibling;
  if (next && next.id && next.id.startsWith('entries-')) {
    const isHidden = next.style.display === 'none' || !next.style.display;
    next.style.display = isHidden ? 'table-row' : 'none';
  }
});

function toggleEntry(header) {
  const body = header.nextElementSibling;
  if (body) body.classList.toggle('open');
}

// ── Q&A Log tab ──────────────────────────────────────────
function renderQALog() {
  const filter = document.getElementById('qaSessionFilter').value;
  const container = document.getElementById('qaLogEntries');

  // Collect all entries from all sessions
  const all = [];
  for (const s of DATA.sessions) {
    if (filter && s.id !== filter) continue;
    for (const e of (s.entries||[])) {
      all.push({ ...e, sessionId: s.id, sessionLabel: s.label, sessionModel: s.model });
    }
  }

  // Sort newest first (by turn number descending)
  all.sort((a, b) => (b.n||0) - (a.n||0));

  document.getElementById('qaTotalCount').textContent = all.length+' entries';

  if (!all.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">No entries with Q&A content.</div>';
    return;
  }

  container.innerHTML = all.map(e => {
    const total = (e.in||0)+(e.out||0);
    const qText = esc(e.q||'');
    const aText = esc(e.a||'');
    const emodel = e.model || e.sessionModel || '';
    return '<div class="entry-row">' +
      '<div class="entry-header" onclick="toggleEntry(this)">' +
        '<div>' +
          '<span style="font-family:monospace;font-size:12px;color:#2563eb;">'+esc(e.sessionId)+'</span>' +
          '<span style="color:#94a3b8;font-size:11px;margin-left:6px;">'+esc(e.sessionLabel||'')+'</span>' +
          (emodel ? '<span class="tag '+tagClass(emodel)+'" style="font-size:10px;margin-left:6px;">'+esc(emodel)+'</span>' : '') +
          '<span style="color:#94a3b8;font-size:11px;margin-left:6px;">· #'+(e.n||'?')+'</span>' +
        '</div>' +
        '<span style="color:#64748b;font-size:12px;">'+fmt(e.in)+' in · '+fmt(e.out)+' out · '+fmt(total)+' total</span>' +
      '</div>' +
      '<div class="entry-body">' +
        (qText ? '<div class="qa-bubble qa-q"><span style="color:#2563eb;font-weight:500;">Q:</span> '+qText+'</div>' : '') +
        (aText ? '<div class="qa-bubble qa-a"><span style="color:#7c3aed;font-weight:500;">A:</span> '+aText+'</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// Populate session filter
const filterSelect = document.getElementById('qaSessionFilter');
for (const s of DATA.sessions) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.id + ' · ' + (s.label||'').slice(0,20);
  filterSelect.appendChild(opt);
}
renderQALog();

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;

  const defaultName = `token-report-${new Date().toISOString().slice(0, 10)}.html`;
  const outPath = outputPath || path.join(process.cwd(), defaultName);
  fs.writeFileSync(outPath, html, 'utf8');
  return outPath;
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { generateHtml };
