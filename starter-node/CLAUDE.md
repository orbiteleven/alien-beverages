# CLAUDE.md

Node/TypeScript starter for the "spaceport bar" exercise. **Read `README.md` first** —
it covers setup, the `make` commands (`up`/`test`/`lint`), the data/loader model, and
where the TODOs live. This file only adds the architecture and conventions the README
leaves implicit.

Work happens in `backend/`. The `frontend/` is a deliberately bare React/Vite harness —
don't touch it to see results.

## Request flow
```
browser :5173 ──POST /recommendations──▶ Vite dev-server proxy ──▶ Fastify :8000
```
`frontend/vite.config.js` proxies `/recommendations` and `/health` to the backend, so the
frontend does a **same-origin** `fetch('/recommendations')` — no CORS, no hardcoded backend
URL. The full loop: handler in `app.ts` reads `app.recipes`, delegates to `matching.ts` /
`llm.ts` (both empty TODOs), returns a JSON array the frontend dumps raw.

## Architecture seams (backend/src)
- **`buildApp()` is a test seam.** `index.ts` only `.listen()`s; `app.ts` exports
  `buildApp()`. Tests import it and use `app.inject()` (in-process, no network — see
  `test/api.test.ts`). Add routes in `buildApp`; test them with `inject`, never boot a server.
- **Recipes are load-once, in-memory.** `app.decorate("recipes", loadRecipes(...))` runs at
  startup; matching runs against that array, not a DB or per-request read. Adding recipe
  files requires a restart.
- **The response shape is your design space.** Request body is `{ need: string }`, validated
  by the route's JSON schema (a missing `need` auto-400s — don't hand-validate). The response
  is currently `[]` and the test only asserts `Array.isArray(...)`, so what a recommendation
  looks like is undefined and up to you.

## Fastify idioms for this repo
- When you define the recommendation shape, declare it in the route's `schema.response` —
  in Fastify that drives fast serialization *and* documents the contract, not just validation.
- Need a shared client (e.g. LLM)? Decorate it onto the app like `app.recipes` already does,
  rather than a module-level singleton.

## Conventions
- ESM (`"type": "module"`) — **relative imports need `.js` extensions** (NodeNext), even for
  `.ts` sources: `import { buildApp } from "./app.js"`.
- TypeScript `strict: true`, `noEmit` — `tsx` runs sources directly, there's no build step.
- Fastify 5; tests in `backend/test/` with vitest. Single test:
  `docker compose run --rm --no-deps backend npx vitest run test/api.test.ts`
- Commit small and often with clear messages (interviewers watch the process).
