import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("browser bundle", () => {
  test("contains no unresolved Bun CommonJS helper", () => {
    const bundle = readFileSync(resolve("public/js/gif.gg.js"), "utf8");

    expect(bundle).not.toContain("__require");
  });
});
