# Changelog

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
