# CLAUDE.md

Node/TypeScript backend for the "spaceport bar" exercise. **Read `README.md`** for setup,
`make` commands, the data/loader model, and where the TODOs are. The backend is small — read
`backend/src/` directly; it documents itself. Only the non-obvious rules live here:

- **ESM `.js` import extensions.** `"type": "module"` + NodeNext — relative imports need a
  `.js` suffix even from `.ts` sources: `import { buildApp } from "./app.js"`. Omitting it
  fails at runtime.
- **No build step.** `strict: true`, `noEmit` — `tsx` runs sources directly.
- **The response shape of `POST /recommendations` is undefined and yours to design** — it
  returns `[]` today, and the test only asserts it's an array.
- Single test: `docker compose run --rm --no-deps backend npx vitest run test/api.test.ts`
