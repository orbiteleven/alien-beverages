import { describe, expect, it } from "vitest";
import type { RecipeRecord } from "../src/loader.js";
import { buildMessages, formatRecipesForPrompt, resolvePicks } from "../src/matching.js";

const BODY = `# Airlock Kiss

## Description
A small, cold, weirdly tender thing.

## Method
1. Combine 45ml Synthline 40 in a chilling coil.

## Bartender's notes
The fog is the garnish, functionally.
`;

function recipe(overrides: Partial<RecipeRecord> = {}): RecipeRecord {
  return {
    name: "Airlock Kiss",
    base_spirit: "Synthline 40",
    ingredients: "Synthline 40, rimefrost cordial",
    flavor_profile: "cold, sweet, delicate",
    glassware: "zero-G bulb",
    garnish: "frozen brine pearl",
    method: "flash-chilled",
    difficulty: "Intermediate",
    prep_minutes: 5,
    abv_estimate: 21,
    origin: "The Slipway, Luna",
    body: BODY,
    source_file: "airlock-kiss.md",
    ...overrides,
  };
}

describe("formatRecipesForPrompt", () => {
  it("includes the identifiers and the fields a customer chooses on", () => {
    const text = formatRecipesForPrompt([recipe()]);

    expect(text).toContain("[airlock-kiss.md] Airlock Kiss");
    expect(text).toContain("base_spirit: Synthline 40");
    expect(text).toContain("abv: 21");
    expect(text).toContain("prep: 5 min");
    expect(text).toContain("flavor: cold, sweet, delicate");
    expect(text).toContain("origin: The Slipway, Luna");
  });

  it("keeps the description but drops the method and the bartender's notes", () => {
    const text = formatRecipesForPrompt([recipe()]);

    expect(text).toContain("A small, cold, weirdly tender thing.");
    expect(text).not.toContain("chilling coil");
    expect(text).not.toContain("The fog is the garnish");
  });

  it("reads the variant frontmatter keys some cards use", () => {
    const odd = recipe({
      base_spirit: undefined,
      spirit: "Dockgrain",
      prep_minutes: undefined,
      time_minutes: 9,
    });

    const text = formatRecipesForPrompt([odd]);

    expect(text).toContain("base_spirit: Dockgrain");
    expect(text).toContain("prep: 9 min");
  });

  it("omits missing fields rather than printing undefined", () => {
    const sparse: RecipeRecord = { body: "Just a body.", source_file: "sparse.md" };

    const text = formatRecipesForPrompt([sparse]);

    expect(text).not.toContain("undefined");
    expect(text).toBe("[sparse.md] sparse.md\nJust a body.");
  });

  it("falls back to the whole body when there is no Description heading", () => {
    const text = formatRecipesForPrompt([recipe({ body: "# Airlock Kiss\n\nNo headings here." })]);

    expect(text).toContain("No headings here.");
  });

  it("separates recipes so they do not run together", () => {
    const text = formatRecipesForPrompt([
      recipe(),
      recipe({ name: "Ballast Burn", source_file: "ballast-burn.md" }),
    ]);

    expect(text).toContain("\n\n[ballast-burn.md] Ballast Burn");
  });
});

describe("buildMessages", () => {
  it("puts the rules in the system message and fences the customer's request", () => {
    const [system, user] = buildMessages("something smoky", [recipe()]);

    expect(system.role).toBe("system");
    expect(system.content).toContain("Never invent a drink");

    expect(user.role).toBe("user");
    expect(user.content).toContain("--- BEGIN CUSTOMER REQUEST ---\nsomething smoky");
    expect(user.content).toContain("[airlock-kiss.md] Airlock Kiss");
  });
});

describe("resolvePicks", () => {
  const recipes = [
    recipe(),
    recipe({ name: "Ballast Burn", source_file: "ballast-burn.md" }),
    recipe({ name: "Cargo Cult", source_file: "cargo-cult.md" }),
    recipe({ name: "Clean Burn", source_file: "clean-burn.md" }),
  ];

  it("returns the full record with the model's reason attached", () => {
    const [pick, ...rest] = resolvePicks(recipes, {
      picks: [{ source_file: "airlock-kiss.md", reason: "  Cold and delicate.  " }],
    });

    expect(rest).toHaveLength(0);
    expect(pick.name).toBe("Airlock Kiss");
    expect(pick.body).toBe(BODY);
    expect(pick.reason).toBe("Cold and delicate.");
  });

  it("preserves the order the model returned", () => {
    const picks = resolvePicks(recipes, {
      picks: [{ source_file: "cargo-cult.md" }, { source_file: "airlock-kiss.md" }],
    });

    expect(picks.map((p) => p.source_file)).toEqual(["cargo-cult.md", "airlock-kiss.md"]);
  });

  it("drops picks for drinks that are not on the menu", () => {
    const picks = resolvePicks(recipes, {
      picks: [{ source_file: "invented-drink.md" }, { source_file: "ballast-burn.md" }],
    });

    expect(picks.map((p) => p.source_file)).toEqual(["ballast-burn.md"]);
  });

  it("drops repeats of the same drink", () => {
    const picks = resolvePicks(recipes, {
      picks: [{ source_file: "airlock-kiss.md" }, { source_file: "airlock-kiss.md" }],
    });

    expect(picks).toHaveLength(1);
  });

  it("caps at three even when the model returns more", () => {
    const picks = resolvePicks(
      recipes,
      { picks: recipes.map((r) => ({ source_file: r.source_file })) },
    );

    expect(picks).toHaveLength(3);
  });

  it("defaults a missing or non-string reason to an empty string", () => {
    const picks = resolvePicks(recipes, {
      picks: [{ source_file: "airlock-kiss.md" }, { source_file: "ballast-burn.md", reason: 7 }],
    });

    expect(picks.map((p) => p.reason)).toEqual(["", ""]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a bare string", "no thanks"],
    ["an object without picks", {}],
    ["picks that is not an array", { picks: "airlock-kiss.md" }],
    ["picks of junk", { picks: [null, 3, "airlock-kiss.md", {}] }],
  ])("returns nothing for %s", (_label, raw) => {
    expect(resolvePicks(recipes, raw)).toEqual([]);
  });
});
