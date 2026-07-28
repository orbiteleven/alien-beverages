import Fastify from "fastify";
import { loadRecipes, type RecipeRecord } from "./loader.js";
import { createLlmClient, type LlmClient } from "./llm.js";

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

  app.post(
    "/recommendations",
    {
      schema: {
        body: {
          type: "object",
          required: ["need"],
          properties: { need: { type: "string" } },
        },
      },
    },
    async () => {
      // TODO: implement matching
      return [];
    },
  );

  return app;
}
