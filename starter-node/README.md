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
frontmatter — the house menu of a spaceport bar. There are 40 cards in the
directory; drop more in and restart to pick them up.
`backend/src/loader.ts` reads them at startup; they're available on the
Fastify instance as `app.recipes`. Each record is an object with:

- every key from the file's YAML frontmatter, parsed as-is
- `body` — the raw markdown body below the frontmatter, as a single string
  (the `##` sections are **not** parsed — that's up to you if you need them)
- `source_file` — the filename the record came from

The loader is intentionally naive: it handles well-formed files and skips
anything that fails to parse with a logged warning. Extend it as needed.

Two things the cards will catch you on. The frontmatter is not uniform —
`hazard-pay.md` uses `spirit` instead of `base_spirit`, `overtime.md` uses
`time_minutes` instead of `prep_minutes`, and two cards have no
`flavor_profile` at all — so read fields through an alias rather than
assuming a key exists. And `pressure-test.md` has an unclosed quote in its
frontmatter, so the loader skips it and only **39** of the 40 cards
actually load; watch the startup log line for the count.

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

## Recommendations

`POST /recommendations` asks the model to pick from the house menu. It never
invents a drink: the prompt says so, and `resolvePicks` enforces it by
discarding anything whose `source_file` isn't a card we actually loaded.

```bash
curl -s localhost:8000/recommendations \
  -H 'Content-Type: application/json' \
  -d '{"need":"something smoky and strong, I have had a long shift"}'
```

Request body is `{ "need": string }`, 1–2000 characters. Fastify's schema
validation rejects anything outside that with a 400 before the model is
called — 2000 characters is roughly 500 tokens, small next to the menu it
shares the context window with.

The response is a JSON array of **up to 3** recipes, best match first. Each
element is the full loader record — every frontmatter key, plus `body` and
`source_file` — with the model's one-line `reason` attached. An empty array
means nothing fit, which is a valid answer.

If the LLM call fails for any reason — no API key, a timeout, a rate limit,
a reply that isn't JSON — the route returns **502** with a fixed message.
The underlying error can quote the upstream response, so it goes to the log
and never to the caller.

`backend/src/matching.ts` owns both ends of this: `formatRecipesForPrompt`
renders the menu (customer-facing frontmatter and the `## Description`
paragraph, but not the `## Method` steps or `## Bartender's notes` — that
keeps the prompt around 29KB instead of 63KB), and `resolvePicks` narrows
the model's untrusted reply back into real records.

## Commands

```bash
make up     # build + run the full stack
make test   # run backend tests (vitest)
make lint   # eslint + tsc --noEmit
```

## Workflow

Please commit as you go — small, frequent commits with clear messages. We
want to see how you work, not just the end state.
