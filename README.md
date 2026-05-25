# Token Tracker 🪨

Track AI token usage across sessions. CLI + Web dashboard. SQLite storage.

## Installation

```bash
npm install -g token-tracker
```

Requires Node.js >= 18.

## Quick Start

```bash
# 1. Initialize database
token-tracker init

# 2. Login (pick one)
token-tracker openai login --key "sk-..."      # API key
token-tracker openai login --subscription        # ChatGPT Plus (OAuth)

# 3. Start a session and start tracking
token-tracker session start --label "refactor auth" --model gpt-4o
token-tracker call --prompt "Explain this code" --model gpt-4o

# 4. Check usage
token-tracker status
token-tracker ls

# 5. Web dashboard
token-tracker serve
```

## Usage

### Session Management

```bash
token-tracker session start --label "task name" --model gpt-4o
token-tracker session end                              # end active session
token-tracker ls                                       # list all sessions
token-tracker ls --since 7d --model gpt-4o --json      # filtered, JSON output
```

### Recording Tokens

**Via API call (auto-recorded):**
```bash
token-tracker call --prompt "Hello" --model gpt-4o
token-tracker call --prompt "Hello" --model claude-sonnet-4 --api-type anthropic
```

**Via pipe:**
```bash
echo '{"input":50,"output":150}' | token-tracker record
```

### Reports & Dashboard

```bash
token-tracker report --html                      # generate HTML report
token-tracker report --html --since 30d           # last 30 days
token-tracker serve                               # start web dashboard (port 3000)
token-tracker serve --port 4000                   # custom port
```

### OpenAI Login

```bash
token-tracker openai login --key "sk-..."         # save API key
token-tracker openai login --subscription          # OAuth via browser (ChatGPT Plus)
token-tracker openai logout                        # remove saved key
token-tracker openai status                        # check login state
```

API key priority: `--api-key` flag > `OPENAI_API_KEY` env var > config file

## Architecture

```
src/
├── cli.js          # CLI entry point
├── db.js           # SQLite storage (sessions, token_entries, meta)
├── recorder.js     # API calls + auto-tracking
├── tokenizer.js    # tiktoken-based token counting
├── config.js       # config file management (~/.token-tracker/config.json)
├── oauth.js        # OAuth PKCE flow (ChatGPT Plus login)
├── serve.js        # Web dashboard server
├── dashboard.html  # Dashboard UI (3-tab: Stats / Sessions / Q&A Log)
├── report.js       # HTML report generator
└── formatter.js    # CLI output formatting
```

## License

MIT
