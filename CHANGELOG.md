# Changelog

## 1.8.1

- Fixed a data corruption bug in session file rotation: when a long-running `mcp-debug run` process rotated across a midnight date boundary, it reused rotation number 00001 for the new date without checking whether a file with that name already existed, for example one created by a second `mcp-debug run` process sharing the same `--session-dir`/`--session-name`. It would then silently start appending into that other process's file instead of creating its own, interleaving two unrelated sessions in one file. Reproduced with a controllable clock (forcing the date to roll over mid-run while a colliding file exists) and confirmed the corruption, then fixed by switching file creation to the atomic `ax` open flag (fails immediately if the name is taken) instead of a separate existence check beforehand, which closes the same gap for any two writers racing on the same filename, not just this one date-rollover case.

## 1.8.0

- `debug`/`info`/`warn`/`error` (from the `mcp-stdio-debug` library) now take an optional topic argument that routes that entry to its own session file, e.g. `info("request", data, "api")`, under a subfolder created automatically per topic (or wherever `MCP_DEBUG_TOPIC_DIR_<TOPIC>` points), separate from the main session log.

## 1.7.0

- Added configurable session file management: `--max-sessions=<n>` (default 20, was previously fixed), `--max-age=<days>` to also delete session files older than a given age, `--max-size=<size>` (e.g. `10MB`) to rotate to a new file instead of growing one file forever, `--session-dir=<path>` to write session files somewhere other than `.mcp-debug/`, and `--session-name=<prefix>` for a custom filename prefix. Each flag also has an `MCP_DEBUG_*` environment variable equivalent. Session filenames changed from `session-<epoch-ms>.jsonl` to the more readable `session-YYYY-MM-DD-00001.jsonl`, with the trailing number incrementing on rotation instead of being reused.

## 1.6.17

- The same crash fixed in 1.6.16 had a second, narrower opening: the initial file size read before `--follow` starts watching wasn't wrapped either, so a deletion landing in that specific window (while the initial replay is still printing existing lines, for a large session file) still crashed. Now covered too.

## 1.6.16

- Fixed `mcp-debug replay --follow` crashing with an uncaught `ENOENT` exception if the session file it's watching gets deleted, for example by another `run`'s automatic session cleanup (1.6.0) evicting it once the 20-file cap is hit. It now prints a clear message and exits instead. Reproduced by starting `--follow`, deleting the file it's watching mid-session, and confirming the crash, then confirming the fix.

## 1.6.15

- Fixed a crash on Windows when Ctrl+C (or SIGTERM) triggers the `taskkill` tree-kill (1.6.2) and `taskkill` itself can't be spawned, for example on a minimal container image or a locked-down `PATH`. The spawned process had no `error` listener, and an unhandled `error` event on a `ChildProcess` throws and crashes the whole wrapper. It now logs the failure instead. Verified by reproducing the crash with a nonexistent binary name, then confirming the fix logs and survives instead of throwing.

## 1.6.14

- `mcp-debug doctor`'s command-on-PATH check spawned `where`/`which` as an external process with a timeout as a safety net against it hanging (1.6.8). That timeout turned out to be necessary but not sufficient. On Windows CI runners, `where` was sometimes still slow enough to legitimately exceed it, turning a valid command into a false "not found." Replaced the external process entirely with a native `PATH`/`PATHEXT` lookup, so the check is a synchronous filesystem read with no process-spawn or timing risk left at all.

## 1.6.13

- Fixed multi-byte UTF-8 characters (Thai, CJK, emoji, ...) getting corrupted into `�` in debug logs and the protocol trace when a character landed across two separate stdout/stderr writes. This was a real risk for any server producing non-ASCII text, since Node delivers arbitrary chunk boundaries. Switched from raw `Buffer.toString()` to `StringDecoder`, which buffers incomplete byte sequences across chunks instead of prematurely replacing them. Verified across every possible split point of a mixed Thai/CJK/emoji string, and end-to-end with a server writing one byte at a time. `stdout` passthrough was never affected (bytes were always relayed untouched); this only fixes what mcp-debug logs and displays itself.
- The test suite's own process-output capture had the identical bug (naive `.toString()` per chunk), which made the new UTF-8 test itself flaky by OS pipe timing. It passed locally and failed on all three CI runners. Fixed by decoding accumulated raw buffers once at the end instead of per chunk.

## 1.6.12 (security)

- Fixed `redact()` returning nested content completely unredacted once it passed the depth cap (6 levels), instead of hiding it. A secret nested 7+ levels deep would leak in full into `--verbose` output and the session log file. It now fails closed: content past the cap is replaced with a placeholder, never returned raw.
- Pinned every third-party GitHub Action used in CI/release workflows to an exact commit SHA instead of a floating major-version tag (e.g. `@v4`). A compromised or force-moved tag on any of these actions would otherwise be pulled in automatically on the next run with no review. This closes that supply-chain window. `publish.yml` (which holds `id-token: write` and `contents: write`) was the priority, but all workflows are now pinned.
- Removed `dependency-review.yml`: it only triggers on `pull_request`, and this repo has never used pull requests (direct pushes only), so the workflow had 0 runs since it was added. It gave the appearance of a security check that was never actually running. Dependency vulnerability coverage is already provided by the `audit.yml` workflow added earlier, which does run.

## 1.6.11 (security)

- Fixed `mcp-debug replay --follow` getting permanently stuck showing no further updates if the session file was truncated or recreated (e.g. after a disk issue, or by pointing `--follow` at a file another tool overwrites). It now detects the file shrinking and resyncs from the new content instead of waiting forever past a stale byte offset.
- Fixed a prototype pollution risk in `redact()`: a `--verbose` payload or logged data containing a `"__proto__"` key (valid, arbitrary JSON) would alter the prototype of the redacted object being built, since plain `{}` objects route `obj["__proto__"] = x` through the inherited setter. The internal object is now created with `Object.create(null)`, so `__proto__` becomes an ordinary own property instead. Impact was limited to the one object built by `redact()`, not the shared `Object.prototype`, but this closes the class of bug regardless.

## 1.6.10

- `tsconfig.json` only included `src/`, so `bun run typecheck` never actually type-checked the test suite. A real type error in a test file would silently pass CI. Added `test/` to `include` and `@types/bun` (for `bun:test`, `import.meta.dir`, ...) so tests are now properly type-checked too. Verified with an injected type error before and after the fix.
- Added a dependency vulnerability audit workflow (`npm audit`, scheduled weekly plus on push/PR). It already found one low-severity advisory in a transitive devDependency (`esbuild` via `tsup`), not fixable within `tsup`'s current version range and not exploitable by our usage (we never run esbuild's dev server), so left as a known, tracked, non-blocking finding.

## 1.6.9

- Fixed `mcp-debug doctor <command>` (forgetting `--`) silently ignoring the command and exiting 0 as if everything passed, instead of checking it. It now errors with a usage hint.

## 1.6.8

- Fixed `mcp-debug doctor` occasionally hanging indefinitely on Windows when checking whether a command is on `PATH` (seen as a CI timeout on `windows-latest`). `where`/`which` now run with a 3-second timeout instead of none.

## 1.6.7

- Reordered the release workflow to create the GitHub release/tag before publishing to npm, not after. A GitHub release can be deleted and retried if something fails; an npm version, once published, can never be reused. So npm should be the step that fails last, not first.

## 1.6.6

- Fixed the logger (`debug`/`info`/`warn`/`error`) crashing the calling server on circular references or `BigInt` values in the logged data. A logging call must never throw. Circular references are now replaced with `"[Circular]"` and `BigInt`s are stringified; if serialization still somehow fails, a safe placeholder is logged instead of throwing. Also added the test coverage for the logger that was missing since 0.1.0.

## 1.6.5

- Fixed `mcp-debug doctor` falsely reporting a valid command as "not found" when given as a relative or absolute path instead of a bare name (e.g. `./bin/server` or `/usr/local/bin/server`). `where`/`which` only resolve bare command names against `PATH` and error out or give false negatives on an actual path. Paths are now checked directly for existence instead.

## 1.6.4 (performance)

- `stdout` from the wrapped server is now relayed with `.pipe()` instead of a manual `.write()` per chunk, so Node applies backpressure automatically. Previously a server that wrote to stdout faster than the downstream client consumed it could make mcp-debug's own memory usage grow unbounded.

## 1.6.3 (security)

- `debug`/`info`/`warn`/`error` log data was written to the terminal and session file unredacted, even without `--verbose`. Fields that look like secrets (`token`, `apiKey`, `password`, `authorization`, ...) are now redacted the same way verbose protocol payloads already were. If you've used `mcp-stdio-debug` to log request data containing credentials, check `.mcp-debug/*.jsonl` files written by earlier versions and remove them.

## 1.6.2

- Fixed client responses to server-initiated requests (e.g. `sampling/createMessage`) being misclassified as malformed anomalies instead of responses. Client and server request ids are now tracked in separate pending sets, since each is an independent numbering sequence and could otherwise collide.

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
