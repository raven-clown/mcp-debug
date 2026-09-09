# Changelog

## 1.6.1

- Fixed `mcp-debug doctor` always emitting ANSI color codes, even when output isn't a real terminal (introduced in 1.5.0)

## 1.6.0

- `mcp-debug replay --follow` keeps printing new lines as another run appends to the session file
- Old session files are cleaned up automatically, keeping the most recent 20

## 1.5.0

- `mcp-debug doctor -- <command>` checks the runtime, whether the target command resolves on `PATH`, and whether the current directory is writable

## 1.4.0

- `mcp-debug stats [file]` summarizes a saved session: request/response/error counts, avg and p95 latency, slowest call, and a per-method breakdown

## 1.3.0

- `--level=debug|info|warn|error` filters which debug logs show in the terminal (the session file still gets everything)
- `--verbose` prints full request/response payloads, with likely-sensitive fields (tokens, keys, passwords) redacted
- `--no-color` disables ANSI colors; colors now also auto-disable when output isn't a real terminal

## 1.2.0

- Requests are now traced too, not just responses (`→ ping id=1` / `← ping id=1 (55ms)`)
- Slow responses (over 500ms) and JSON-RPC error responses are highlighted in red
- Protocol anomalies are flagged: duplicate request ids, responses with no matching request, malformed messages
- JSON-RPC batch requests/responses are now traced (previously silently skipped)
- A one-line summary prints when the wrapped server exits
- `replay` highlights the same slow/error/anomaly cases as a live run

## 1.1.0

- Responses now report round-trip latency (`id=1 (57ms)`)
- `mcp-debug replay [session-file]` pretty-prints a saved session, defaulting to the latest

## 1.0.0

- `--version` and `--help` flags
- Test suite covering the line splitter and end-to-end CLI behavior
- CI runs on Linux, Windows, and macOS
- Verified against the official `@modelcontextprotocol/server-filesystem`

## 0.1.3

- Log writes are async instead of blocking on every line
- Fixed a race where the log file could close before the last buffered line was written
- Removed an unused, disconnected logging API from the library

## 0.1.2

- Fixed orphaned child processes on Windows when the wrapper is killed

## 0.1.1

- Fixed spawning `.cmd`-based commands (`npm`, `npx`, `yarn`) on Windows
- Signals (Ctrl+C) now forward to the wrapped process
- Fixed output truncation and dropped trailing log lines on exit

## 0.1.0

- Initial release
