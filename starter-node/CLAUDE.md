# CLAUDE.md

Node/TypeScript starter for the "spaceport bar" exercise. See `README.md` for the
exercise framing. Work happens in `backend/`; the `frontend/` is a bare React/Vite
harness you shouldn't need to touch.

## Commands
Everything runs in Docker (`make` targets wrap `docker compose`):
- `make up`   — build + run full stack (backend :8000, frontend :5173)
- `make test` — backend tests (vitest)
- `make lint` — `eslint .` + `tsc --noEmit`

Single test (inside backend container): `docker compose run --rm --no-deps backend npx vitest run test/api.test.ts`
Smoke: `curl http://localhost:8000/health` → `{"status":"ok"}`

## Architecture (backend/src)
- `index.ts`    — entry; listens on 0.0.0.0:8000
- `app.ts`      — `buildApp()`; Fastify instance, `/health`, `POST /recommendations`
- `loader.ts`   — reads `data/recipes/*.md` (YAML frontmatter + markdown body) at startup;
                  records exposed as `app.recipes: RecipeRecord[]`
- `matching.ts` — search/matching logic (empty, TODO)
- `llm.ts`      — LLM integration (empty, TODO)

Data: recipe cards are markdown w/ YAML frontmatter in `data/recipes/` (git-empty until
the dataset is dropped in). Each `RecipeRecord` = frontmatter keys + `body` (raw markdown)
+ `source_file`. `RECIPES_DIR` env sets the dir; `LLM_API_KEY` from `.env`.

## Conventions
- ESM (`"type": "module"`) — relative imports use `.js` extensions (NodeNext).
- TypeScript `strict: true`, `noEmit` (tsx runs sources directly, no build step).
- Fastify 5; tests in `backend/test/` with vitest.
- Commit small and often with clear messages (interviewers watch the process).
