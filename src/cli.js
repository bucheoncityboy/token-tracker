#!/usr/bin/env node
// token-tracker — CLI entry point
//
// Usage:
//   token-tracker <command> [options]
//
// Commands:
//   init                  Create SQLite DB
//   session start|end     Manage sessions
//   record                Record token usage (stdin or args)
//   call                  API call + auto record
//   status                Session statistics
//   ls                    List sessions
//   report --html         Generate HTML report
//   serve                 Start web dashboard

const path = require('path');
const fs = require('fs');

// Infer API type from model name
function inferApiType(model) {
  const m = (model || '').toLowerCase();
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('text-')) return 'openai';
  if (m.startsWith('claude') || m.startsWith('gemini')) return 'anthropic';
  return 'anthropic'; // default
}

// Lazy-load heavy modules only when needed
const MINIMIST_PATH = require.resolve('minimist', { paths: [__dirname] });

function parseArgs(argv) {
  try {
    const minimist = require(MINIMIST_PATH);
    return minimist(argv, {
      string: ['session', 'label', 'model', 'output', 'port', 'since', 'api-type', 'prompt', 'file', 'api-key', 'db', 'as'],
      boolean: ['help', 'all', 'html', 'json', 'stdin', 'dry-run'],
      alias: { h: 'help', o: 'output', p: 'port', m: 'model', s: 'session' },
    });
  } catch {
    // Fallback: bare-minimal parsing without minimist
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
🪨  Token Tracker — Track AI token usage across sessions

Usage:
  token-tracker <command> [options]

Commands:
  init                         Initialize SQLite DB at ~/.token-tracker/tokens.db

  session start                Start a new session
    --label "..."              Session label (e.g. "fix auth bug")
    --model <name>             Model name (e.g. claude-sonnet-4)
    --api-type <type>          API provider (anthropic, openai, custom)

  session end [--session <id>] End a session (default: active session)

  record                        Record token usage from stdin
    Echo JSON: {"input":N, "output":N, "cache_read":N}
    Or pipe response text (auto-counts tokens)

  call                         Call API + auto record
    --prompt "..."             Prompt text
    --model <name>             Model to use (claude-sonnet-4 / gpt-4o)
    --api-type <type>          Auto-detected from model, or: anthropic / openai
    --api-key <key>            API key (default: ANTHROPIC_API_KEY / OPENAI_API_KEY)
    --file <path>              Read prompt from file

  openai                        OpenAI login & key management
    login                       Interactive: paste API key
    login --key "sk-..."        Save API key directly
    login --subscription        OAuth login via browser (ChatGPT Plus)
    logout                      Remove saved key
    status                      Check login status

  status                        Show session statistics
    [--all]                    Show lifetime stats

  ls [--all]                   List sessions
    [--since 7d]               Filter by time range
    [--model <name>]           Filter by model
    [--limit N]                Max results
    [--json]                   JSON output

  report                       Generate report
    --html                     HTML report with charts
    [--since 7d]               Time range
    [--output <file>]          Output path (default: token-report-<date>.html)

  serve                        Start web dashboard
    [--port N]                 Port (default: 3000)
    [--db <path>]              Custom DB path

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
  const sub = args._[1];

  try {
    switch (cmd) {
      case 'init':
        await require('./db');
        const db = require('./db');
        console.log(`✓ Initialized at ${db.DB_PATH}`);
        break;

      case 'session': {
        const db = require('./db');
        const formatter = require('./formatter');

        if (sub === 'start') {
          const sid = db.createSession({
            label: args.label || '',
            model: args.model || '',
            api_type: args['api-type'] || 'custom',
          });
          console.log(`✓ Session started: ${sid}`);
          if (args.label) console.log(`  Label: ${args.label}`);
          if (args.model) console.log(`  Model: ${args.model}`);
        } else if (sub === 'end') {
          const sid = args.session || db.getActiveSession();
          if (!sid) { console.error('✗ No active session. Specify --session or start one.'); process.exit(1); }
          if (db.endSession(sid)) {
            const stats = db.getSessionStats(sid);
            console.log(`✓ Session ${sid} ended.`);
            console.log(`  ${formatter.formatSessionSummary(stats)}`);
          } else {
            console.log(`- Session ${sid} already ended or not found.`);
          }
        } else {
          console.error('✗ Usage: token-tracker session start|end [options]');
          process.exit(1);
        }
        break;
      }

      case 'record': {
        const db = require('./db');
        const recorder = require('./recorder');

        // --as: 작업 단위 세션 전환
        let sid;
        if (args.as !== undefined && args.as !== '') {
          sid = db.getOrCreateSessionByLabel(args.as, args.model || '');
        } else {
          sid = args.session || db.getActiveSession();
        }
        if (!sid) {
          // Auto-create session
          sid = db.createSession({ label: 'adhoc' });
          console.log(`  Auto-created session: ${sid}`);
        }

        // Check if stdin has data (pipe mode)
        const hasStdin = !process.stdin.isTTY;
        if (hasStdin) {
          await recorder.recordFromStdin(sid);
        } else if (args.input !== undefined || args.output !== undefined) {
          recorder.recordFromArgs(sid, args);
        } else {
          console.error('✗ Pipe data to stdin or use --input/--output flags');
          console.error('  echo \'{"input":50,"output":200}\' | token-tracker record');
          console.error('  echo "response text" | token-tracker record  (auto-counts)');
          process.exit(1);
        }
        break;
      }

      case 'call': {
        const db = require('./db');
        const recorder = require('./recorder');

        let prompt = args.prompt || '';
        if (args.file) {
          prompt = fs.readFileSync(path.resolve(args.file), 'utf8');
        }
        if (!prompt) {
          console.error('✗ Specify --prompt or --file');
          process.exit(1);
        }

        // --as: 작업 단위 세션 전환
        let sid;
        if (args.as !== undefined && args.as !== '') {
          sid = db.getOrCreateSessionByLabel(args.as, args.model || '');
        } else {
          sid = args.session || db.getActiveSession();
        }
        if (!sid) {
          sid = db.createSession({ label: prompt.slice(0, 40), model: args.model || '' });
          console.log(`  Auto-created session: ${sid}`);
        }

        const model = args.model || 'claude-sonnet-4';
        let apiType = (args['api-type'] || inferApiType(model)).toLowerCase();

        // Pick the right API key: --api-key > env var > config file
        let apiKey = args['api-key'];
        if (!apiKey && apiType === 'openai') {
          // Check if subscription mode
          const config = require('./config');
          const auth = config.getOpenAIAuth();

          if (auth.type === 'subscription') {
            // Subscription: ensure token is valid (auto-refresh if needed)
            const oauth = require('./oauth');
            apiKey = await oauth.ensureValidToken();
            apiType = 'openai-subscription';
          } else if (auth.type === 'api_key') {
            apiKey = auth.token;
          }
        }
        if (!apiKey) {
          const config = require('./config');
          apiKey = config.getApiKey(apiType);
        }
        if (!apiKey) {
          const envVar = apiType.startsWith('openai') ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
          console.error(`✗ No API key found. Set ${envVar} or run:`);
          if (apiType.startsWith('openai')) {
            console.error(`  token-tracker openai login --key "sk-..."`);
            console.error(`  token-tracker openai login --subscription  (for ChatGPT Plus)`);
          }
          process.exit(1);
        }

        await recorder.callAndRecord(sid, prompt, model, apiKey, apiType);
        break;
      }

      case 'openai': {
        const config = require('./config');
        const sub2 = args._[1];

        if (sub2 === 'login') {
          if (args.key) {
            // Key provided via --key flag
            config.set('openai_auth_type', 'api_key');
            config.set('openai_api_key', args.key);
            console.log(`✓ API key saved to ${config.CONFIG_PATH}`);
          } else if (args.subscription || args['subscription-login']) {
            // Full OAuth subscription login (same flow as pi)
            console.log(`\n🪨  OpenAI Subscription Login\n`);
            console.log(`  This will open your browser to authenticate with your`);
            console.log(`  OpenAI account (ChatGPT Plus subscription).\n`);
            try {
              const oauth = require('./oauth');
              const result = await oauth.loginWithSubscription();
              const plan = result.payload?.['https://api.openai.com/auth']?.chatgpt_plan_type || 'unknown';
              const email = result.payload?.['https://api.openai.com/profile']?.email || 'unknown';
              config.saveSubscriptionAuth({
                accessToken: result.access_token,
                refreshToken: result.refresh_token,
                expiresIn: result.expires_in,
              });
              console.log(`\n✓ Logged in via OpenAI subscription!`);
              console.log(`  Account: ${email}`);
              console.log(`  Plan:    ${plan}`);
              console.log(`  Mode:    Subscription (Responses API)`);
              console.log(`  Token saved to ${config.CONFIG_PATH}`);
              process.exit(0);
            } catch (e) {
              console.error(`\n✗ Login failed: ${e.message}`);
              process.exit(1);
            }
          } else {
            // Interactive: guide user to get API key
            const apiKeysUrl = 'https://platform.openai.com/api-keys';
            console.log(`1. Open this URL in your browser:\n   ${apiKeysUrl}`);
            console.log(`2. Click "+ Create new secret key"`);
            console.log(`3. Copy the generated key (sk-...)`);
            try {
              const { execSync } = require('child_process');
              execSync(`start "" "${apiKeysUrl}"`, { timeout: 3000, windowsHide: true });
              console.log('   (Browser opened automatically)');
            } catch {}
            console.log('');
            const readline = require('readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
            const key = await new Promise(resolve => {
              process.stderr.write('Paste your API key (or leave blank to cancel): ');
              process.stdin.once('data', buf => {
                const k = buf.toString().trim();
                process.stderr.write('\n');
                resolve(k);
              });
            });
            if (!key) { console.log('- Login cancelled.'); rl.close(); break; }
            if (!key.startsWith('sk-')) {
              console.error('✗ Invalid API key. Must start with "sk-".');
              process.exit(1);
            }
            config.set('openai_auth_type', 'api_key');
            config.set('openai_api_key', key);
            console.log(`✓ API key saved to ${config.CONFIG_PATH}`);
            rl.close();
          }
        } else if (sub2 === 'logout') {
          const auth = config.getOpenAIAuth();
          if (auth.type) {
            config.unset('openai_auth_type');
            config.unset('openai_api_key');
            config.unset('openai_oauth_token');
            config.unset('openai_refresh_token');
            config.unset('openai_token_expires_at');
            const label = auth.type === 'subscription' ? 'subscription token' : 'API key';
            console.log(`✓ Logged out. ${label} removed from ${config.CONFIG_PATH}`);
          } else {
            console.log(`- Not logged in. No key to remove.`);
          }
        } else if (sub2 === 'status') {
          const auth = config.getOpenAIAuth();

          if (auth.type === 'subscription') {
            // Subscription mode — decode JWT for details
            const token = auth.token || '';
            let email = 'unknown', plan = 'unknown';
            if (token.startsWith('eyJ')) {
              try {
                const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                plan = payload['https://api.openai.com/auth']?.chatgpt_plan_type || 'unknown';
                email = payload['https://api.openai.com/profile']?.email || 'unknown';
              } catch {}
            }
            const expired = config.isTokenExpired();
            const expiresAt = auth.expiresAt ? new Date(auth.expiresAt).toLocaleString() : 'unknown';
            console.log(`● Logged in via Subscription (Responses API)`);
            console.log(`  Account:  ${email}`);
            console.log(`  Plan:     ${plan}`);
            console.log(`  Expires:  ${expiresAt} ${expired ? '(⚠ EXPIRED — will auto-refresh)' : '(valid)'}`);
            console.log(`  Refresh:  ${auth.refreshToken ? '✓ available' : '✗ none'}`);
          } else if (auth.type === 'api_key') {
            console.log(`● Logged in via API Key (${auth.token.slice(0, 7)}...)`);
            console.log(`  Endpoint: api.openai.com/v1/chat/completions`);
          } else {
            console.log(`✗ Not logged in.`);
            console.log(`  Run: token-tracker openai login`);
            console.log(`        token-tracker openai login --subscription  (for ChatGPT Plus)`);
          }
          console.log(`  Config: ${config.CONFIG_PATH}`);
        } else {
          console.error(`✗ Usage: token-tracker openai login|logout|status`);
          console.error(`  login                     Interactive: paste API key`);
          console.error(`  login --key "sk-..."      Save API key directly`);
          console.error(`  login --subscription      OAuth login via browser`);
          console.error(`  logout                    Remove saved key`);
          console.error(`  status                    Check login status`);
          process.exit(1);
        }
        break;
      }

      case 'status': {
        const db = require('./db');
        const formatter = require('./formatter');

        if (args.all) {
          const stats = db.getGlobalStats({ since: args.since });
          console.log(formatter.formatGlobalStats(stats, args.since));
        } else {
          let sid;
          if (args.as !== undefined && args.as !== '') {
            // Find the most recent session with this label
            const sessions = db.listSessions({ limit: 1 });
            // Actually, look up by exact label match
            const allSessions = db.listSessions({ limit: null });
            const match = allSessions.find(s => s.label === args.as && s.ended_at === null);
            sid = match ? match.id : null;
            if (!sid) {
              // Try any session with this label
              const anyMatch = allSessions.find(s => s.label === args.as);
              sid = anyMatch ? anyMatch.id : null;
            }
          } else {
            sid = args.session || db.getActiveSession();
          }
          if (!sid) { console.error('✗ No active session.\n  Start one: token-tracker session start --label "..."'); process.exit(1); }
          const stats = db.getSessionStats(sid);
          if (!stats) { console.error(`✗ Session not found: ${sid}`); process.exit(1); }
          console.log(formatter.formatSessionStats(stats));
        }
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

        // --as 로 라벨 필터
        if (args.as !== undefined && args.as !== '') {
          sessions = sessions.filter(s => s.label === args.as);
        }

        if (args.json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else {
          console.log(formatter.formatSessionList(sessions));
        }
        break;
      }

      case 'report': {
        const db = require('./db');
        const report = require('./report');

        if (args.html) {
          const outputPath = args.output || report.generateHtml({ since: args.since });
          console.log(`✓ Report saved: ${outputPath}`);
        } else {
          console.error('✗ Use --html to generate a report');
          console.error('  token-tracker report --html [--since 7d] [--output report.html]');
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
