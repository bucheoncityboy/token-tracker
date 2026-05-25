#!/usr/bin/env node
// token-tracker — CLI entry point

const path = require('path');
const fs = require('fs');

const MINIMIST_PATH = require.resolve('minimist', { paths: [__dirname] });

function parseArgs(argv) {
  try {
    const minimist = require(MINIMIST_PATH);
    return minimist(argv, {
      string: ['model', 'port', 'since'],
      boolean: ['help', 'all', 'html', 'json'],
      alias: { h: 'help', p: 'port', m: 'model' },
    });
  } catch {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a.startsWith('--')) {
        const key = a.slice(2);
        const val = argv[i + 1];
        if (val && !val.startsWith('--')) { args[key] = val; i++; }
        else { args[key] = true; }
      } else if (a.startsWith('-') && a.length === 2) {
        const key = a.slice(1);
        const val = argv[i + 1];
        if (val && !val.startsWith('--') && !val.startsWith('-')) { args[key] = val; i++; }
        else { args[key] = true; }
      } else {
        args._.push(a);
      }
    }
    return args;
  }
}

function printHelp() {
  console.log(`
🪨  Token Tracker — Dashboard for Codex

Usage:
  token-tracker <command> [options]

Commands:
  status                        Show global statistics
    [--since 7d]               Filter by time range

  ls                           List sessions
    [--since 7d]               Filter by time range
    [--model <name>]           Filter by model
    [--limit N]                Max results
    [--json]                   JSON output

  report                       Generate report
    --html                     HTML report with charts
    [--since 7d]               Time range

  serve                        Start web dashboard
    [--port N]                 Port (default: 3000)

Options:
  --help, -h                   Show this help
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args._.length === 0) {
    printHelp();
    return;
  }

  const cmd = args._[0];

  try {
    switch (cmd) {
      case 'status': {
        const db = require('./db');
        const formatter = require('./formatter');
        const stats = db.getGlobalStats({ since: args.since });
        console.log(formatter.formatGlobalStats(stats, args.since));
        break;
      }

      case 'ls': {
        const db = require('./db');
        const formatter = require('./formatter');

        let limit = args.limit ? parseInt(args.limit) : null;
        if (!args.all && !limit) limit = 20;

        let sessions = db.listSessions({
          limit,
          since: args.since || null,
          model: args.model || null,
        });

        if (args.json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else {
          console.log(formatter.formatSessionList(sessions));
        }
        break;
      }

      case 'report': {
        const report = require('./report');

        if (args.html) {
          const outputPath = args.output || report.generateHtml({ since: args.since });
          console.log(`✓ Report saved: ${outputPath}`);
        } else {
          console.error('✗ Use --html to generate a report');
        }
        break;
      }

      case 'serve': {
        const serve = require('./serve');
        const port = args.port ? parseInt(args.port) : 3000;
        serve.startServer(port);
        break;
      }

      default:
        console.error(`✗ Unknown command: ${cmd}`);
        console.error('  Run "token-tracker --help" for usage.');
        process.exit(1);
    }
  } catch (err) {
    console.error(`✗ Error: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

main();
