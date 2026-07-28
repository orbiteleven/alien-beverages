import { expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

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
