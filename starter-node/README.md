# Starter: spaceport bar exercise (Node/TypeScript)

Your interviewer will explain the task at the start of the session.

## Setup

Prerequisites: Docker with the compose plugin.

```bash
cp .env.example .env   # fill in LLM_API_KEY if/when you need it
make up                # or: docker compose up --build
```

- Backend (Fastify): http://localhost:8000
- Frontend (React/Vite): http://localhost:5173

The frontend is deliberately bare: a text box that POSTs to
`/recommendations` and dumps the raw JSON response. You shouldn't need to
touch it to see your results.

## Smoke test

```bash
curl http://localhost:8000/health
# → {"status":"ok"}
```

## Data & the loader

Recipe cards live in `data/recipes/` as markdown files with YAML
frontmatter — the house menu of a spaceport bar. The directory is empty for
now — you'll receive the dataset at the start of the exercise; drop the
files in and restart. `backend/src/loader.ts` reads them at startup;
they're available on the Fastify instance as `app.recipes`. Each record is
an object with:

- every key from the file's YAML frontmatter, parsed as-is
- `body` — the raw markdown body below the frontmatter, as a single string
  (the `##` sections are **not** parsed — that's up to you if you need them)
- `source_file` — the filename the record came from

The loader is intentionally naive: it handles well-formed files and skips
anything that fails to parse with a logged warning. Extend it as needed.

## LLM client

`backend/src/llm.ts` is a thin OpenRouter client — no SDK, just Node's
global `fetch`. It's built once in `buildApp()` and hangs off the Fastify
instance as `app.llm`, so handlers reach it via `request.server.llm`.

```ts
const text = await request.server.llm.chat([
  { role: "system", content: "You are a spaceport bartender." },
  { role: "user", content: need },
]);

// Or ask for JSON mode and get it parsed (cast only — validate it yourself):
const picks = await request.server.llm.chatJson<{ picks: string[] }>(messages);
```

Configuration is explicit config → environment → default:

| Env var          | Default                          |
| ---------------- | -------------------------------- |
| `LLM_API_KEY`    | — (required to make a call)      |
| `LLM_MODEL`      | `anthropic/claude-sonnet-5`      |
| `LLM_BASE_URL`   | `https://openrouter.ai/api/v1`   |
| `LLM_TIMEOUT_MS` | `20000`                          |

Without a key the client still builds — `isConfigured` is `false`, the app
logs a warning at startup, and `/health` keeps working. The first `chat()`
call then throws immediately instead of firing a doomed request.

`.env` is loaded by docker compose, so `make up` and `make test` just work.
Running on the host instead? Pass the key inline
(`LLM_API_KEY=sk-or-... npm run dev`) or use `node --env-file=../.env`.

Tests never hit the network. Route tests mock the module:

```ts
const { chat, chatJson } = vi.hoisted(() => ({ chat: vi.fn(), chatJson: vi.fn() }));
vi.mock("../src/llm.js", () => ({
  createLlmClient: () => ({ isConfigured: true, model: "fake", chat, chatJson }),
}));
```

The client's own tests (`backend/test/llm.test.ts`) stub the global `fetch`
with `vi.stubGlobal` to check the wire format and error handling.

## Where to work

- `backend/src/matching.ts` — search/matching logic (empty, TODO)
- `backend/src/app.ts` — `POST /recommendations` currently returns `[]`

## Commands

```bash
make up     # build + run the full stack
make test   # run backend tests (vitest)
make lint   # eslint + tsc --noEmit
```

## Workflow

Please commit as you go — small, frequent commits with clear messages. We
want to see how you work, not just the end state.
