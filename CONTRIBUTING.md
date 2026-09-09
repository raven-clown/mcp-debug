# Contributing

## Setup

```bash
bun install
bun run build
bun run typecheck
bun test
```

## Making changes

1. Fork the repo and create a branch off `master`.
2. Keep changes scoped: one fix or feature per pull request.
3. Run `bun run typecheck`, `bun run build`, and `bun test` before opening a PR.
4. Describe what changed and why in the PR description.

## Reporting bugs

Open an issue with:
- what you ran (`mcp-debug run -- ...`)
- what you expected vs. what happened
- your OS and Node/Bun version

## Code style

- No unnecessary comments. Code should read on its own.
- Keep functions small and single-purpose.
