import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { ChatMessage } from "../src/llm.js";

// Route tests never talk to OpenRouter. vi.hoisted gives us handles to the
// mock functions that the (hoisted) vi.mock factory can legally close over,
// so each test can set its own canned response.
const { chat, chatJson } = vi.hoisted(() => ({
  chat: vi.fn(),
  chatJson: vi.fn(),
}));

vi.mock("../src/llm.js", () => ({
  createLlmClient: () => ({ isConfigured: true, model: "fake", chat, chatJson }),
}));

function card(name: string, flavor: string) {
  return `---
name: ${name}
base_spirit: dockgrain spirit
flavor_profile: ${flavor}
---

## Description
A ${flavor} drink.

## Method
1. Pour it.
`;
}

/** Point the loader at a two-recipe fixture menu for this test. */
function withRecipes() {
  const dir = mkdtempSync(join(tmpdir(), "recipes-"));
  writeFileSync(join(dir, "static-cling.md"), card("Static Cling", "tart"));
  writeFileSync(join(dir, "ballast-burn.md"), card("Ballast Burn", "smoky"));
  vi.stubEnv("RECIPES_DIR", dir);
}

it("health returns ok", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok" });
});

it("recommendations accepts a need", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/recommendations",
    payload: { need: "something smoky, not too strong" },
  });
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res.json())).toBe(true);
});

it("exposes the mocked llm client on the app", async () => {
  chat.mockResolvedValue("Static Cling");

  const app = buildApp();

  expect(app.llm.model).toBe("fake");
  await expect(app.llm.chat([{ role: "user", content: "something smoky" }])).resolves.toBe(
    "Static Cling",
  );
});

it("returns the picked recipes with the model's reasons", async () => {
  withRecipes();
  chatJson.mockResolvedValue({
    picks: [
      { source_file: "ballast-burn.md", reason: "Smoky, as asked." },
      { source_file: "static-cling.md", reason: "A lighter second round." },
    ],
  });

  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/recommendations",
    payload: { need: "something smoky" },
  });

  expect(res.statusCode).toBe(200);
  const picks = res.json();
  expect(picks.map((p: { name: string }) => p.name)).toEqual(["Ballast Burn", "Static Cling"]);
  expect(picks[0].reason).toBe("Smoky, as asked.");
  // We return the whole record, body and all.
  expect(picks[0].body).toContain("A smoky drink.");
});

it("drops picks for drinks that are not on the menu", async () => {
  withRecipes();
  chatJson.mockResolvedValue({
    picks: [{ source_file: "invented-drink.md" }, { source_file: "static-cling.md" }],
  });

  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/recommendations",
    payload: { need: "surprise me" },
  });

  expect(res.json().map((p: { source_file: string }) => p.source_file)).toEqual([
    "static-cling.md",
  ]);
});

it("sends the customer's need and the loaded menu to the model", async () => {
  withRecipes();
  chatJson.mockResolvedValue({ picks: [] });

  const app = buildApp();
  await app.inject({
    method: "POST",
    url: "/recommendations",
    payload: { need: "something smoky" },
  });

  const [messages] = chatJson.mock.calls[0] as [ChatMessage[]];
  expect(messages[0].role).toBe("system");
  expect(messages[1].content).toContain("something smoky");
  expect(messages[1].content).toContain("[ballast-burn.md] Ballast Burn");
  // The method steps stay out of the prompt.
  expect(messages[1].content).not.toContain("Pour it.");
});

it("skips the llm entirely when no recipes are loaded", async () => {
  vi.stubEnv("RECIPES_DIR", mkdtempSync(join(tmpdir(), "recipes-empty-")));

  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/recommendations",
    payload: { need: "anything" },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual([]);
  expect(chatJson).not.toHaveBeenCalled();
});

it("returns 502 without leaking the underlying error when the llm fails", async () => {
  withRecipes();
  chatJson.mockRejectedValue(new Error("LLM request failed (429): sk-or-secret rate limited"));

  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/recommendations",
    payload: { need: "something smoky" },
  });

  expect(res.statusCode).toBe(502);
  expect(res.json()).toEqual({ error: "Could not reach the recommendation service." });
  expect(res.body).not.toContain("sk-or-secret");
  expect(res.body).not.toContain("429");
});

it.each([
  ["a need longer than the cap", { need: "x".repeat(2001) }],
  ["an empty need", { need: "" }],
  ["a missing need", {}],
  // Fastify's ajv coerces scalars to string, but not these — so the length
  // cap can't be sidestepped by sending a different JSON type.
  ["an array need", { need: ["x".repeat(2001)] }],
  ["an object need", { need: { text: "smoky" } }],
])("rejects %s with a 400 and never calls the llm", async (_label, payload) => {
  withRecipes();

  const app = buildApp();
  const res = await app.inject({ method: "POST", url: "/recommendations", payload });

  expect(res.statusCode).toBe(400);
  expect(chatJson).not.toHaveBeenCalled();
});

it("accepts a need right at the cap", async () => {
  withRecipes();
  chatJson.mockResolvedValue({ picks: [] });

  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/recommendations",
    payload: { need: "x".repeat(2000) },
  });

  expect(res.statusCode).toBe(200);
});
