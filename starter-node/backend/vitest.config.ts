import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Undo vi.fn/vi.stubGlobal/vi.stubEnv between tests so stubs don't bleed.
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
