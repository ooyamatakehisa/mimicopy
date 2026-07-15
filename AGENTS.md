# AGENTS.md

## Project Principles

- Build the app as a TypeScript-first web application with strict type checking.
- Prefer small, pure domain helpers for playback state, markers, and time formatting so behavior can be tested without a browser.
- Keep React components focused on UI and orchestration; keep media math and parsing in `src/lib`.
- Do not add unrelated frameworks or abstractions unless they remove real complexity.
- Use accessible controls with visible state, keyboard parity, and clear focus behavior.

## TypeScript And React Rules

- Keep `strict` TypeScript enabled and avoid `any`; use `unknown` plus narrowing when needed.
- Model app state with explicit types and discriminated unions where useful.
- Before splitting a large React component, first design the responsibility boundaries and state ownership. Do not merely move JSX into children while keeping all state in the old parent.
- Keep state as local as its meaning allows. Prefer component-local state and focused custom hooks for screen-local workflows; use React context only when prop drilling across meaningful distance is worse than introducing shared state.
- Avoid catch-all contexts or provider objects that gather unrelated state and commands. Split playback, marker editing, waveform viewport, routing, and library data by cohesive domain boundaries.
- Derive UI status from existing query, mutation, and domain state when possible instead of storing duplicate `loadState` or message state.
- Use TanStack Query for REST reads and writes. Do not initiate REST requests from `useEffect`; reserve effects for synchronizing with browser APIs, DOM/media elements, timers, subscriptions, and other external non-REST systems.
- Do not hand-roll client-side routing, history management, or URL param parsing for app navigation. Use the project's routing library, and add a current, established router such as React Router when the project does not already have one.
- Use `useMemo`, `useCallback`, and refs for media-facing code where they prevent stale closures or unnecessary redraw work.
- Keep side effects inside `useEffect` with complete dependency arrays.
- Prefer named exports for reusable modules.
- Prefer shared Tailwind UI primitives and design tokens over page-local styling; avoid inline style objects except when values are computed at runtime.
- Name files that export React components in PascalCase, matching the exported component name or component group. Keep non-component hooks/utilities in lower camel case.

## Server Rules

- Keep server endpoints small and validate user input before invoking external tools.
- Never shell-concatenate untrusted input. Pass arguments as arrays or use library APIs.
- Store generated media under a dedicated ignored directory and serve it statically.
- Return structured JSON errors to the frontend.

## Testing And Verification Loop

Before finishing any implementation, run:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`

For UI-facing work, also run the app locally and verify the main workflow in a browser:

- MP3 upload loads an audio source and draws a waveform.
- Play/pause works through buttons, Space, Enter, and `K`.
- Seek shortcuts work: arrows for 5 seconds, `J`/`L` for 10 seconds.
- Speed shortcuts work: `Shift+.` and `Shift+,` over `0.25x`, `0.5x`, `0.75x`, and `1x`.
- Marker creation, return, and deletion are usable from the interface and keyboard.

## Git Rules

- Check `git status` before staging.
- Stage only files changed for this task.
- Commit only staged changes after lint, typecheck, tests, build, and browser verification pass.
- Push the requested branch after the commit succeeds.
