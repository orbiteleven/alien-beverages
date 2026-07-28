import { expect, it, vi } from "vitest";
import { createLlmClient } from "../src/llm.js";

const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Blank out any LLM_* vars the host happens to have set, so tests are hermetic. */
function clearLlmEnv() {
  for (const key of ["LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL", "LLM_TIMEOUT_MS"]) {
    vi.stubEnv(key, "");
  }
}

/**
 * Replace the global fetch with a stub returning a real Response, and record
 * what it was called with. Real Response objects keep the fake honest.
 */
function stubFetch(body: unknown, init: ResponseInit = { status: 200 }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn((url: string, requestInit: RequestInit) => {
    calls.push({ url, init: requestInit });
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve(new Response(payload, init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

/** Shape of a successful OpenRouter reply. */
function reply(content: string) {
  return { choices: [{ message: { content } }] };
}

function sentBody(init: RequestInit) {
  return JSON.parse(String(init.body));
}

it("posts to OpenRouter with the key, model and messages", async () => {
  clearLlmEnv();
  const { calls } = stubFetch(reply("Static Cling"));

  const client = createLlmClient({ apiKey: "test-key" });
  const messages = [{ role: "user" as const, content: "something smoky" }];
  const answer = await client.chat(messages);

  expect(answer).toBe("Static Cling");
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(CHAT_URL);
  expect(calls[0].init.method).toBe("POST");

  const headers = calls[0].init.headers as Record<string, string>;
  expect(headers.Authorization).toBe("Bearer test-key");
  expect(headers["Content-Type"]).toBe("application/json");

  expect(sentBody(calls[0].init)).toMatchObject({
    model: "anthropic/claude-sonnet-5",
    messages,
  });
});

it("passes temperature and maxTokens through, and omits them otherwise", async () => {
  clearLlmEnv();
  const { calls } = stubFetch(reply("ok"));

  const client = createLlmClient({ apiKey: "test-key" });
  await client.chat([{ role: "user", content: "hi" }], { temperature: 0.2, maxTokens: 800 });
  await client.chat([{ role: "user", content: "hi" }]);

  expect(sentBody(calls[0].init)).toMatchObject({ temperature: 0.2, max_tokens: 800 });
  expect(sentBody(calls[1].init)).not.toHaveProperty("temperature");
  expect(sentBody(calls[1].init)).not.toHaveProperty("max_tokens");
});

it("chatJson asks for JSON mode and parses the reply", async () => {
  clearLlmEnv();
  const { calls } = stubFetch(reply('{"picks":["Static Cling"]}'));

  const client = createLlmClient({ apiKey: "test-key" });
  const result = await client.chatJson<{ picks: string[] }>([{ role: "user", content: "hi" }]);

  expect(result).toEqual({ picks: ["Static Cling"] });
  expect(sentBody(calls[0].init).response_format).toEqual({ type: "json_object" });
});

it("chatJson strips a ```json code fence", async () => {
  clearLlmEnv();
  stubFetch(reply('```json\n{"picks":["Vacuum Bloom"]}\n```'));

  const client = createLlmClient({ apiKey: "test-key" });
  await expect(client.chatJson([{ role: "user", content: "hi" }])).resolves.toEqual({
    picks: ["Vacuum Bloom"],
  });
});

it("chatJson throws a readable error when the reply is not JSON", async () => {
  clearLlmEnv();
  stubFetch(reply("Sorry, I can only recommend drinks."));

  const client = createLlmClient({ apiKey: "test-key" });
  await expect(client.chatJson([{ role: "user", content: "hi" }])).rejects.toThrow(
    /did not return valid JSON: Sorry, I can only/,
  );
});

// docker-compose passes `LLM_API_KEY=${LLM_API_KEY:-}`, so an unset key
// reaches the container as an empty string rather than as an absent var.
it.each([
  ["absent", undefined],
  ["an empty string", ""],
  ["only whitespace", "   "],
])("is unconfigured and never calls fetch when the key is %s", async (_label, value) => {
  clearLlmEnv();
  if (value === undefined) {
    delete process.env.LLM_API_KEY;
  } else {
    vi.stubEnv("LLM_API_KEY", value);
  }
  const { fetchMock } = stubFetch(reply("unreachable"));

  const client = createLlmClient();

  expect(client.isConfigured).toBe(false);
  await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/LLM_API_KEY/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("surfaces a non-2xx response without leaking the key", async () => {
  clearLlmEnv();
  stubFetch("rate limited", { status: 429 });

  const client = createLlmClient({ apiKey: "secret-key" });
  const error = await client.chat([{ role: "user", content: "hi" }]).catch((err: Error) => err);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("429");
  expect((error as Error).message).toContain("rate limited");
  expect((error as Error).message).not.toContain("secret-key");
});

it("surfaces a 200 response carrying an error envelope", async () => {
  clearLlmEnv();
  stubFetch({ error: { message: "no credits" } });

  const client = createLlmClient({ apiKey: "test-key" });
  await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/no credits/);
});

it("throws when the response has no message content", async () => {
  clearLlmEnv();
  stubFetch({ choices: [] });

  const client = createLlmClient({ apiKey: "test-key" });
  await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
    /no message content/,
  );
});

it("wraps network failures", async () => {
  clearLlmEnv();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))),
  );

  const client = createLlmClient({ apiKey: "test-key" });
  await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
    /LLM request failed: getaddrinfo ENOTFOUND/,
  );
});

it("resolves model and base URL as config > env > default", async () => {
  clearLlmEnv();
  vi.stubEnv("LLM_MODEL", "from/env");
  vi.stubEnv("LLM_BASE_URL", "http://localhost:9999/v1/");
  const { calls } = stubFetch(reply("ok"));

  const fromEnv = createLlmClient({ apiKey: "test-key" });
  expect(fromEnv.model).toBe("from/env");
  await fromEnv.chat([{ role: "user", content: "hi" }]);
  // Trailing slashes on the base URL are trimmed.
  expect(calls[0].url).toBe("http://localhost:9999/v1/chat/completions");

  const fromConfig = createLlmClient({ apiKey: "test-key", model: "from/config" });
  expect(fromConfig.model).toBe("from/config");

  await fromConfig.chat([{ role: "user", content: "hi" }], { model: "from/options" });
  expect(sentBody(calls[1].init).model).toBe("from/options");
});

it("sends an abort signal so requests cannot hang forever", async () => {
  clearLlmEnv();
  const { calls } = stubFetch(reply("ok"));

  await createLlmClient({ apiKey: "test-key" }).chat([{ role: "user", content: "hi" }]);

  expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
});
