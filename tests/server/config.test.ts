import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { loadConfig } from "../../src/server/config";

describe("server configuration", () => {
  test("uses an external temporary directory during development", () => {
    const config = loadConfig({});

    expect(config.dataDir).toBe(resolve(tmpdir(), "gifgg-development"));
    expect(config.debug).toBe(true);
  });

  test("requires an explicit persistent directory in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "DATA_DIR must point",
    );
  });

  test("derives persistent paths and production settings", () => {
    const config = loadConfig({
      DATA_DIR: "./persistent-data",
      NODE_ENV: "production",
      APP_VERSION: "release-42",
    });

    expect(config).toEqual({
      dataDir: resolve("./persistent-data"),
      databasePath: resolve("./persistent-data/gifgg.sqlite"),
      gifsDir: resolve("./persistent-data/gifs"),
      debug: false,
      version: "release-42",
    });
  });
});
