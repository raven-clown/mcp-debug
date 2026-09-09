# Contributing

## Setup

```bash
bun install
bun run build
bun run typecheck
```

## Making changes

1. Fork the repo and create a branch off `main`.
2. Keep changes scoped — one fix or feature per pull request.
3. Run `bun run typecheck` and `bun run build` before opening a PR.
4. Describe what changed and why in the PR description.

## Reporting bugs

Open an issue with:
- what you ran (`mcp-debug run -- ...`)
- what you expected vs. what happened
- your OS and Node/Bun version

## Code style

- No unnecessary comments — code should read on its own.
- Keep functions small and single-purpose.
