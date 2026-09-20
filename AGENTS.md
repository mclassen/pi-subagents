# AGENTS.md

## Project acceptance

- Before product, architecture, scope, or backlog-disposition decisions, read [VISION.md](VISION.md) completely. Use it as this repository's acceptance policy for proposals, issues, and PRs.
- User-global and tool-level instructions still apply. This file adds only repository-specific rules.

## Live Pi checkout

- `C:/Users/micha/.pi/agent/settings.json` loads this checkout directly. Treat edits as changes to the active Pi package, not an inert clone.
- Never reload while child runs are active. After prompt, skill, or context-file changes, use `/reload`; after extension/runtime/package changes, restart Pi.

## Remotes and publication

- `upstream` is upstream `nicobailon/pi-subagents`; use it for fetch/sync. `origin` is writable `mclassen/pi-subagents`; push feature branches and customized `main` there. Do not push to `upstream` without explicit current-session authorization.
- Before first publication, fetch `upstream/main` and integrate the current upstream base without discarding work or force-pushing. Open or update an upstream PR only when explicitly requested.

## Boston publication window

- Repository reads, edits, staging, and validation may run anytime.
- Do not create commits or perform remote mutations—including push, PR creation/update, and publish/release—on weekdays from 09:00 inclusive until 18:00 exclusive in Boston local time. Weekends and weekdays before 09:00 or at/after 18:00 are allowed.
- Use the canonical DST-aware timezone `America/New_York` (Eastern Time; EST/EDT), not a fixed UTC offset. Check the clock immediately before each restricted action; session start time does not authorize a later action.
- Explicit current-session user authorization may override the window for the named action only.
