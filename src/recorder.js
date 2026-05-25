// token-tracker — Token recording module
//
// Modes:
//   1. stdin (JSON) — parse usage from piped JSON
//   2. stdin (text) — count tokens via tiktoken for accuracy
//   3. API (Anthropic) — call Claude, capture usage from response
//   4. API (OpenAI)   — call GPT, capture usage from response
//   5. manual         — from CLI arguments

const db = require('./db');
const tokenizer = require('./tokenizer');
const https = require('https');

// ─── Stdin mode ────────────────────────────────────────────

function recordFromStdin(sessionId) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => {
      try {
        const raw = chunks.join('').trim();
        if (!raw) {
          console.log('- Empty stdin. Nothing recorded.');
          resolve(false);
          return;
        }

        // Try JSON first (structured token data)
        try {
          const data = JSON.parse(raw);
          const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
          const inTokens = toNum(data.input || data.input_tokens);
          const outTokens = toNum(data.output || data.output_tokens);
          db.insertEntry({
            session_id: sessionId,
            input_tokens: inTokens,
            output_tokens: outTokens,
            cache_write: toNum(data.cache_write || data.cache_creation),
            cache_read: toNum(data.cache_read || data.cache_read_input),
            record_method: 'stdin-json',
            prompt_preview: String(data.prompt || data.question || ''),
            response_text: String(data.response || data.answer || ''),
          });
          const total = inTokens + outTokens;
          console.log(`✓ Recorded: +${total.toLocaleString()} tokens`);
          resolve(true);
          return;
        } catch {}

        // Raw text: count tokens accurately via tiktoken
        // If user piped a response, this IS the response text
        const model = process.env.TOKEN_TRACKER_MODEL || '';
        const { tokens, encoder } = tokenizer.countTokens(raw, model);
        if (encoder) encoder.free();

        // Try to detect if this is a Q&A format (contains both question and answer)
        let promptText = '';
        let responseText = raw;
        const qaMatch = raw.match(/^Q[:：]?\s*(.*?)(?:\nA[:：]?\s*)/is);
        if (qaMatch) {
          promptText = qaMatch[1].trim();
          responseText = raw.slice(qaMatch[0].length - (raw.match(/A[:：]?\s*/)?.[0]?.length || 0)).trim();
        }

        db.insertEntry({
          session_id: sessionId,
          input_tokens: 0,
          output_tokens: tokens,
          record_method: 'stdin-text',
          prompt_preview: promptText.slice(0, 200),
          response_text: responseText.slice(0, 5000),
        });
        console.log(`✓ Recorded: ${tokens.toLocaleString()} output tokens (via tiktoken)`);
        resolve(true);
      } catch (err) {
        reject(err);
      }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Record from CLI arguments.
 */
function recordFromArgs(sessionId, args) {
  db.insertEntry({
    session_id: sessionId,
    input_tokens: parseInt(args.input) || 0,
    output_tokens: parseInt(args.output) || 0,
    cache_write: parseInt(args['cache-write']) || 0,
    cache_read: parseInt(args['cache-read']) || 0,
    record_method: 'manual',
    prompt_preview: args.label || '',
    response_text: args.response || '',
  });
  const total = (parseInt(args.input) || 0) + (parseInt(args.output) || 0);
  console.log(`✓ Recorded: +${total.toLocaleString()} tokens`);
}

// ─── API mode: shared helpers ──────────────────────────────

function updateModelIfNeeded(sessionId, model) {
  const session = db.getSession(sessionId);
  if (session && !session.model) {
    const database = db.getDb();
    database.prepare(`UPDATE sessions SET model = ? WHERE id = ?`).run(model, sessionId);
  }
}

function printUsage(inputTokens, outputTokens, cacheRead, responseText) {
  const line = `── [${inputTokens} in · ${outputTokens} out · ${cacheRead} cache] ──`;
  process.stderr.write(`\n${line}\n`);
}

// ─── API mode: Anthropic ───────────────────────────────────

function callAnthropic(sessionId, prompt, model, apiKey) {
  const body = JSON.stringify({
    model: model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error(`✗ Anthropic API error (${res.statusCode}): ${data.slice(0, 500)}`);
          reject(new Error(`Anthropic API returned ${res.statusCode}`));
          return;
        }
        try {
          const response = JSON.parse(data);
          const usage = response.usage || {};
          const inputTokens = usage.input_tokens || 0;
          const outputTokens = usage.output_tokens || 0;
          const cacheWrite = usage.cache_creation_input_tokens || 0;
          const cacheRead = usage.cache_read_input_tokens || 0;

          // Extract response text (handle non-array content defensively)
          const content = Array.isArray(response.content) ? response.content : [];
          let responseText = '';
          for (const block of content) {
            if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
              responseText += block.text;
            }
          }

          db.insertEntry({
            session_id: sessionId,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_write: cacheWrite,
            cache_read: cacheRead,
            record_method: 'api',
            prompt_preview: prompt.slice(0, 200),
            response_text: responseText.slice(0, 5000),
          });

          updateModelIfNeeded(sessionId, model);

          // Print response
          process.stdout.write(responseText);
          if (!responseText) process.stdout.write(JSON.stringify(response, null, 2));
          process.stdout.write('\n');

          printUsage(inputTokens, outputTokens, cacheRead, responseText);
          resolve(response);
        } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── API mode: OpenAI ──────────────────────────────────────

function callOpenAI(sessionId, prompt, model, apiKey) {
  const body = JSON.stringify({
    model: model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error(`✗ OpenAI API error (${res.statusCode}): ${data.slice(0, 500)}`);
          reject(new Error(`OpenAI API returned ${res.statusCode}`));
          return;
        }
        try {
          const response = JSON.parse(data);
          const usage = response.usage || {};
          const inputTokens = usage.prompt_tokens || 0;
          const outputTokens = usage.completion_tokens || 0;
          const cacheRead = usage.prompt_tokens_details?.cached_tokens || 0;

          const responseText = response.choices?.[0]?.message?.content || '';

          db.insertEntry({
            session_id: sessionId,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_write: 0,
            cache_read: cacheRead,
            record_method: 'api',
            prompt_preview: prompt.slice(0, 200),
            response_text: responseText.slice(0, 5000),
          });

          updateModelIfNeeded(sessionId, model);

          process.stdout.write(responseText);
          if (!responseText) process.stdout.write(JSON.stringify(response, null, 2));
          process.stdout.write('\n');

          printUsage(inputTokens, outputTokens, cacheRead, responseText);
          resolve(response);
        } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── API dispatcher ────────────────────────────────────────

function callAndRecord(sessionId, prompt, model, apiKey, apiType) {
  const type = (apiType || 'anthropic').toLowerCase();
  if (type === 'openai') return callOpenAI(sessionId, prompt, model, apiKey);
  return callAnthropic(sessionId, prompt, model, apiKey);
}

module.exports = { recordFromStdin, recordFromArgs, callAndRecord };
