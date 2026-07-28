import Fastify from "fastify";
import { loadRecipes, type RecipeRecord } from "./loader.js";
import { createLlmClient, type LlmClient } from "./llm.js";
import { buildMessages, resolvePicks } from "./matching.js";

/**
 * Longest customer request we'll act on, in characters.
 *
 * Roughly 500 tokens — generous for describing a mood, and small next to the
 * ~29KB menu that shares the context window with it.
 */
const MAX_NEED_LENGTH = 2000;

declare module "fastify" {
  interface FastifyInstance {
    recipes: RecipeRecord[];
    llm: LlmClient;
  }
}

export function buildApp() {
  const app = Fastify({ logger: true });

  const recipesDir = process.env.RECIPES_DIR ?? "data/recipes";
  app.decorate("recipes", loadRecipes(recipesDir));
  app.log.info(`Loaded ${app.recipes.length} recipe(s) from ${recipesDir}`);

  // Handlers reach the client via `request.server.llm`.
  const llm = createLlmClient();
  app.decorate("llm", llm);
  if (llm.isConfigured) {
    app.log.info(`LLM client ready (model: ${llm.model})`);
  } else {
    app.log.warn("LLM_API_KEY is not set — LLM calls will fail. Copy .env.example to .env.");
  }

  app.get("/health", async () => ({ status: "ok" }));

  app.post<{ Body: { need: string } }>(
    "/recommendations",
    {
      schema: {
        body: {
          type: "object",
          required: ["need"],
          properties: {
            need: { type: "string", minLength: 1, maxLength: MAX_NEED_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const { recipes, llm } = request.server;

      // Nothing to recommend from — don't spend a request finding that out.
      if (recipes.length === 0) {
        request.log.warn("No recipes loaded; returning no recommendations.");
        return [];
      }

      try {
        const raw = await llm.chatJson(buildMessages(request.body.need, recipes), {
          temperature: 0.3,
          maxTokens: 500,
        });
        return resolvePicks(recipes, raw);
      } catch (err) {
        // Everything llm.ts throws lands here: no API key, a non-2xx, a
        // timeout, or a reply that wasn't JSON. Those messages can carry
        // response fragments, so they're logged and never sent.
        request.log.error({ err }, "Recommendation request failed");
        return reply.code(502).send({ error: "Could not reach the recommendation service." });
      }
    },
  );

  return app;
}
