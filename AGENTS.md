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
- Use `useMemo`, `useCallback`, and refs for media-facing code where they prevent stale closures or unnecessary redraw work.
- Keep side effects inside `useEffect` with complete dependency arrays.
- Prefer named exports for reusable modules.
- Use CSS modules or plain scoped CSS through the app stylesheet; avoid inline style objects except for dynamic CSS custom properties.

## Server Rules

- Keep server endpoints small and validate user input before invoking external tools.
- Never shell-concatenate untrusted input. Pass arguments as arrays or use library APIs.
- Store generated media under a dedicated ignored directory and serve it statically.
- Return structured JSON errors to the frontend.

## Testing And Verification Loop

Before finishing any implementation, run:

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`

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
