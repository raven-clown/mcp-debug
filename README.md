# mcp-debug

[![npm version](https://img.shields.io/npm/v/mcp-stdio-debug.svg)](https://www.npmjs.com/package/mcp-stdio-debug)
[![npm downloads](https://img.shields.io/npm/dm/mcp-stdio-debug.svg)](https://www.npmjs.com/package/mcp-stdio-debug)
[![CI](https://github.com/raven-clown/mcp-debug/actions/workflows/ci.yml/badge.svg)](https://github.com/raven-clown/mcp-debug/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/mcp-stdio-debug.svg)](LICENSE)

Debug logging and protocol tracing for stdio-based MCP servers.

## The problem

Stdio MCP servers use `stdout` as the JSON-RPC transport. A stray
`console.log` writes into that same stream and breaks the client's
parser — so the usual way to debug is unavailable.

## What it does

`mcp-debug` wraps your server process. `stdout` is relayed to the
client byte-for-byte, untouched. Everything useful for a human —
your debug logs and a summary of each JSON-RPC message — goes to
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

Each run writes a session file to `.mcp-debug/session-<time>.jsonl`
with every log line and protocol message, in order.

Replay a saved session later — defaults to the most recent one:

```bash
mcp-debug replay
mcp-debug replay .mcp-debug/session-1234567890.jsonl
```

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

### Doctor

Sanity-check the environment before you spend time debugging the
wrong thing — is the command on `PATH`, is the current directory
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
a file or another process. `--verbose` redacts fields that look like
secrets (`token`, `apiKey`, `password`, `authorization`, ...) before
printing or logging them — the raw data passed through `stdout` is
never touched.

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

MIT — see [LICENSE](LICENSE).
