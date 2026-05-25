// token-tracker — CLI output formatter

const db = require('./db');

const SEP = '─'.repeat(50);

function humanizeTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt) return '-';
  const start = new Date(startedAt);
  if (isNaN(start.getTime())) return '-';
  const end = endedAt ? new Date(endedAt) : new Date();
  if (isNaN(end.getTime())) return '-';
  const diffMs = end - start;
  if (diffMs < 0) return '-';
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatUsd(amount) {
  if (amount == null || amount <= 0) return '-';
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}

function formatSessionSummary(stats) {
  const total = (stats.total_input || 0) + (stats.total_output || 0);
  return `${stats.turns || 0} turns · ${humanizeTokens(total)} total tokens (in ${humanizeTokens(stats.total_input)} + out ${humanizeTokens(stats.total_output)})`;
}

function formatSessionStats(stats) {
  if (!stats) return 'Session not found.';

  const total = (stats.total_input || 0) + (stats.total_output || 0);
  const duration = formatDuration(stats.started_at, stats.ended_at);
  const cost = db.estimateCost(stats.model, stats.total_input || 0, stats.total_output || 0);
  const cacheRate = stats.total_input > 0
    ? ` (${Math.round((stats.total_cache_read || 0) / stats.total_input * 100)}% cached)`
    : '';

  const lines = [
    `Session: ${stats.id}  [${stats.label || '(no label)'}]`,
    `Model:   ${stats.model || '(not set)'}`,
    `Status:  ${stats.ended_at ? '✅ completed' : '● active'}`,
    `Duration: ${duration}`,
    SEP,
    `Turns:   ${stats.turns || 0}`,
    `Input:   ${(stats.total_input || 0).toLocaleString()} tokens${cacheRate}`,
    `Output:  ${(stats.total_output || 0).toLocaleString()} tokens`,
    `Total:   ${total.toLocaleString()} tokens`,
    SEP,
  ];

  if (cost !== null) {
    lines.push(`Est. cost: ${formatUsd(cost)}`);
  } else if (stats.model) {
    lines.push(`Cost:     unknown (no pricing for "${stats.model}")`);
  }

  return '\n' + lines.join('\n') + '\n';
}

function formatGlobalStats(stats, since) {
  const total = (stats.total_input || 0) + (stats.total_output || 0);
  const header = since ? `Lifetime Stats (last ${since})` : 'Lifetime Stats';

  const lines = [
    header,
    SEP,
    `Sessions: ${stats.total_sessions || 0} (${stats.completed_sessions || 0} done, ${stats.active_sessions || 0} active)`,
    `Entries:  ${stats.total_entries || 0}`,
    SEP,
    `Input:    ${(stats.total_input || 0).toLocaleString()} tokens`,
    `Output:   ${(stats.total_output || 0).toLocaleString()} tokens`,
    `Total:    ${total.toLocaleString()} tokens`,
    SEP,
  ];

  return '\n' + lines.join('\n') + '\n';
}

function formatSessionList(sessions) {
  if (!sessions || sessions.length === 0) return '\nNo sessions found.\n';

  // Calculate column widths
  const rows = sessions.map(s => ({
    id: s.id,
    label: (s.label || '').slice(0, 28),
    model: (s.model || '-').slice(0, 18),
    total: ((s.total_input || 0) + (s.total_output || 0)),
    status: s.ended_at ? '✅' : '●',
    date: (s.started_at || '').slice(0, 10),
  }));

  const lines = [
    '',
    `${'Status'.padEnd(6)} ${'Session'.padEnd(14)} ${'Label'.padEnd(30)} ${'Model'.padEnd(20)} ${'Tokens'.padEnd(10)} ${'Date'.padEnd(12)}`,
    `${''.padEnd(6, '─')} ${''.padEnd(14, '─')} ${''.padEnd(30, '─')} ${''.padEnd(20, '─')} ${''.padEnd(10, '─')} ${''.padEnd(12, '─')}`,
  ];

  for (const r of rows) {
    lines.push(
      `${r.status.padEnd(6)} ${r.id.padEnd(14)} ${r.label.padEnd(30)} ${r.model.padEnd(20)} ${humanizeTokens(r.total).padStart(10)} ${r.date.padEnd(12)}`
    );
  }

  const total = rows.reduce((s, r) => s + r.total, 0);
  lines.push('', `Total: ${rows.length} sessions · ${total.toLocaleString()} tokens`, '');

  return lines.join('\n');
}

module.exports = {
  humanizeTokens, formatDuration, formatUsd,
  formatSessionSummary, formatSessionStats, formatGlobalStats, formatSessionList,
};
