# mcp-debug

[![npm version](https://img.shields.io/npm/v/mcp-stdio-debug.svg)](https://www.npmjs.com/package/mcp-stdio-debug)
[![npm downloads](https://img.shields.io/npm/dm/mcp-stdio-debug.svg)](https://www.npmjs.com/package/mcp-stdio-debug)
[![CI](https://github.com/raven-clown/mcp-debug/actions/workflows/ci.yml/badge.svg)](https://github.com/raven-clown/mcp-debug/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/mcp-stdio-debug.svg)](LICENSE)

Debug logging and protocol tracing for stdio-based MCP servers.

## The problem

Stdio MCP servers use `stdout` as the JSON-RPC transport. A stray
`console.log` writes into that same stream and breaks the client's
parser, so the usual way to debug is unavailable.

## What it does

`mcp-debug` wraps your server process. `stdout` is relayed to the
client byte-for-byte, untouched. Everything useful for a human,
your debug logs and a summary of each JSON-RPC message, goes to
`stderr` and to a session log file instead.

![mcp-debug terminal output](assets/terminal.svg)

## Install

```bash
npm i mcp-stdio-debug
```

## Usage

Wrap the command you'd normally point your MCP client at:

```bash
mcp-debug run -- node server.js
```

In your server code, swap `console.log` for the logger so output
never touches `stdout`:

```ts
import { debug, info, warn, error } from "mcp-stdio-debug";

info("server.start", { pid: process.pid });
debug("request.received", { method: "ping" });
```

Each request and response is traced with a direction arrow, and each
response is tagged with how long the server took to answer it. Slow
responses (over 500ms) and JSON-RPC errors are highlighted in red;
a response with no matching request, a duplicate request id, or a
malformed message is flagged as an anomaly in yellow:

```
[rpc] → ping id=1
[rpc] ← ping id=1 (55ms)
```

A one-line summary prints when the server exits:

```
mcp-debug summary: 1 requests, 1 responses, avg 55ms, slowest 55ms
```

Each run writes a session file to
`.mcp-debug/session-YYYY-MM-DD-00001.jsonl` with every log line and
protocol message, in order.

Replay a saved session later. Defaults to the most recent one:

```bash
mcp-debug replay
mcp-debug replay .mcp-debug/session-2026-01-01-00001.jsonl
mcp-debug replay --follow   # keep printing new lines as another run appends them
```

Only the most recent 20 session files are kept; older ones are
deleted automatically on the next run.

Or get a summary instead of the full trace:

```bash
mcp-debug stats
```
```
Requests: 12
Responses: 12 (1 errors)
Notifications: 2
Latency: avg 34ms, p95 112ms
Slowest: tools/call id=9 (340ms)

By method:
  tools/call: 8 calls, avg 45ms
  resources/read: 4 calls, avg 12ms
```

### Flags

```bash
mcp-debug run --verbose -- node server.js       # show full request/response payloads
mcp-debug run --level=warn -- node server.js    # only show warn/error debug logs
mcp-debug run --no-color -- node server.js      # disable ANSI colors
```

Fields that look like secrets (`token`, `apiKey`, `password`,
`authorization`, ...) are redacted in `--verbose` payloads and in
`data` passed to the logger (`debug("auth", { token })`), both on
screen and in the session file, regardless of `--verbose`.

### Session file management

Session files live in `.mcp-debug/` by default, named
`session-YYYY-MM-DD-00001.jsonl`, `session-YYYY-MM-DD-00002.jsonl`, and
so on. By default at most 20 are kept; older ones are deleted as new
runs start.

```bash
mcp-debug run --max-sessions=50 -- node server.js     # keep the 50 most recent session files
mcp-debug run --max-age=7 -- node server.js           # also delete session files older than 7 days
mcp-debug run --max-size=10MB -- node server.js       # rotate to a new file once one passes 10MB, instead of growing it forever
mcp-debug run --session-dir=/var/log/mcp -- node server.js   # write session files somewhere else
mcp-debug run --session-name=myserver -- node server.js      # use a custom filename prefix
```

Rotating on `--max-size` never stops logging: a run that produces a
lot of traffic just ends up with several sequentially numbered files
instead of one unbounded one.

Each flag has an equivalent environment variable, which a flag
overrides if both are set: `MCP_DEBUG_MAX_SESSIONS`,
`MCP_DEBUG_MAX_AGE`, `MCP_DEBUG_MAX_SIZE`, `MCP_DEBUG_SESSION_DIR`,
`MCP_DEBUG_SESSION_NAME`.

### Topics: splitting logs into separate files

`debug`/`info`/`warn`/`error` take an optional third argument to
route that entry to its own session file instead of the main one,
for example to keep an `api` log and a `chat` log apart:

```ts
import { info } from "mcp-stdio-debug";

info("request", { ip: "203.0.113.4" }, "api");
info("message", { text: "hi" }, "chat");
```

By default each topic gets its own subfolder under the session
directory (`.mcp-debug/api/`, `.mcp-debug/chat/`), created
automatically, with the same rotation and retention rules as the
main log. To send a topic's files somewhere else entirely, set
`MCP_DEBUG_TOPIC_DIR_<TOPIC>` (uppercased), for example
`MCP_DEBUG_TOPIC_DIR_API=/var/log/myserver/api`.

### Doctor

Sanity-check the environment before you spend time debugging the
wrong thing: is the command on `PATH`, is the current directory
writable:

```bash
mcp-debug doctor -- node server.js
```
```
✓ runtime: linux, node v22.15.0
✓ command "node" on PATH: /usr/bin/node
✓ current directory writable: /home/you/project
```

Colors are on automatically in a real terminal and off when piped to
a file or another process.

```bash
mcp-debug --version
mcp-debug --help
```

## Development

```bash
bun install
bun run build
bun run typecheck
bun test
```

## License

MIT. See [LICENSE](LICENSE).
