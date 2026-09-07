import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { InclusiveRandomInteger } from "../../src/id/alphabet";
import { createApp, type GifApp } from "../../src/server/app";
import type { AppConfig } from "../../src/server/config";
import { MAX_UPLOAD_BODY_BYTES, UPLOAD_LIMITS } from "../../src/shared/upload-policy";
import { gifFixture } from "./gif-fixture";

interface TestContext {
  app: GifApp;
  config: AppConfig;
}

const contexts: TestContext[] = [];

function createTestApp(randomValues: readonly number[] = [0, 1, 2, 3, 4, 5, 6]): TestContext {
  const dataDir = mkdtempSync(join(tmpdir(), "gifgg-server-test-"));
  let randomPosition = 0;
  const randomInteger: InclusiveRandomInteger = () => {
    const value = randomValues[randomPosition];
    if (value === undefined) {
      throw new Error("random sequence exhausted");
    }
    randomPosition += 1;
    return value;
  };
  const config: AppConfig = {
    dataDir,
    databasePath: join(dataDir, "gifgg.sqlite"),
    gifsDir: join(dataDir, "gifs"),
    debug: true,
    version: "test",
  };
  const context = {
    app: createApp(config, { randomInteger }),
    config,
  };
  contexts.push(context);
  return context;
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.app.close();
    rmSync(context.config.dataDir, { recursive: true, force: true });
  }
});

describe("Bun backend", () => {
  test("renders the existing main and about routes", async () => {
    const { app } = createTestApp();

    const main = await app.fetch(new Request("http://gif.gg/"));
    expect(main.status).toBe(200);
    expect(await main.text()).toContain(
      "<script type=\"module\" src=\"/js/gif.gg.js?test\"></script>",
    );

    const about = await app.fetch(new Request("http://gif.gg/about"));
    expect(about.status).toBe(200);
    expect(await about.text()).toContain("gif.gg is");

    const stylesheet = await app.fetch(new Request("http://gif.gg/css/index.css"));
    expect(stylesheet.headers.get("cache-control")).toBe("no-store");
  });

  test("preserves the upload response with fixed seven-character IDs", async () => {
    const { app, config } = createTestApp([61, 0, 1, 2, 3, 4, 5]);
    const form = new FormData();
    form.append("gif", new File([gifFixture()], "capture.gif", { type: "image/gif" }));
    const request = new Request("http://gif.gg/", {
      method: "POST",
      body: form,
    });

    const response = await app.fetch(request, {
      requestIP: () => ({ address: "203.0.113.8" }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("/0abcdef");
    expect(new Uint8Array(readFileSync(join(config.gifsDir, "0abcdef.gif")))).toEqual(gifFixture());
    expect(app.database.findGif("0abcdef")).toMatchObject({
      urlId: "0abcdef",
      private: true,
      ip: "203.0.113.8",
    });
  });

  test("serves the native encoder as WebAssembly", async () => {
    const { app } = createTestApp();
    const response = await app.fetch(new Request("http://gif.gg/js/msf-gif.wasm"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect(WebAssembly.validate(await response.arrayBuffer())).toBe(true);
  });

  test("continues serving short legacy IDs without rewriting them", async () => {
    const { app, config } = createTestApp();
    app.database.insertGif({ urlId: "a0", private: true, ip: "", createdAt: "2020-01-01" });
    await Bun.write(join(config.gifsDir, "a0.gif"), gifFixture());
    for (const path of ["/a0", "/a0.gif", "/gifs/a0.gif", "/twitter-player/a0"]) {
      expect((await app.fetch(new Request(`http://gif.gg${path}`))).status).toBe(200);
    }
  });

  test("serves GIF and metadata routes from the external data directory", async () => {
    const { app } = createTestApp();
    const form = new FormData();
    form.append("gif", new File([gifFixture()], "capture.gif"));
    await app.fetch(new Request("http://gif.gg/", { method: "POST", body: form }));

    const page = await app.fetch(new Request("http://gif.gg/abcdefg"));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<img src=\"/abcdefg.gif\" alt=\"\">");

    const image = await app.fetch(new Request("http://gif.gg/abcdefg.gif"));
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(gifFixture());

    const player = await app.fetch(
      new Request("http://gif.gg/twitter-player/abcdefg"),
    );
    expect(player.status).toBe(200);
  });

  test("returns a structured validation error for a missing upload", async () => {
    const { app } = createTestApp();
    const response = await app.fetch(
      new Request("http://gif.gg/", { method: "POST", body: new FormData() }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid" });
  });

  test("rejects invalid uploads before creating files or database rows", async () => {
    const { app, config } = createTestApp();
    for (
      const [bytes, error] of [
        [new TextEncoder().encode("GIF89a"), "invalid"],
        [gifFixture(1, 1921, 1), "dimensions"],
        [gifFixture(501), "frames"],
        [gifFixture(28, 1920, 1920), "pixels"],
        [new Uint8Array(UPLOAD_LIMITS.bytes + 1), "too_large"],
      ] as const
    ) {
      const form = new FormData();
      form.append("gif", new File([bytes], "pretend.gif", { type: "image/gif" }));
      const response = await app.fetch(
        new Request("http://gif.gg/", { method: "POST", body: form }),
      );
      expect(response.status).toBe(error === "too_large" ? 413 : 422);
      expect(await response.json()).toEqual({ error });
      expect(readdirSync(config.gifsDir)).toEqual([]);
      expect(app.database.hasGif("abcdefg")).toBe(false);
    }
  });

  test("bounds chunked bodies without trusting Content-Length", async () => {
    const { app } = createTestApp();
    const response = await app.fetch(
      new Request("http://gif.gg/", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_UPLOAD_BODY_BYTES + 1));
            controller.close();
          },
        }),
      }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
  });

  test("only enables UI error previews in development", async () => {
    const { app, config } = createTestApp();
    expect(await (await app.fetch(new Request("http://gif.gg/?upload-errors"))).text())
      .toContain("data-development=\"true\"");
    config.debug = false;
    expect(await (await app.fetch(new Request("http://gif.gg/?upload-errors"))).text())
      .not.toContain("data-development");
  });

  test("limits concurrent uploads without blocking page requests", async () => {
    const { app } = createTestApp();
    const controllers: ReadableStreamDefaultController[] = [];
    const pending = Array.from({ length: 2 }, () =>
      app.fetch(
        new Request("http://gif.gg/", {
          method: "POST",
          body: new ReadableStream({
            start(controller) {
              controllers.push(controller);
            },
          }),
        }),
      ));
    try {
      const busy = await app.fetch(new Request("http://gif.gg/", { method: "POST", body: "test" }));
      expect(busy.status).toBe(503);
      expect(await busy.json()).toEqual({ error: "busy" });
      expect((await app.fetch(new Request("http://gif.gg/"))).status).toBe(200);
    } finally {
      for (const controller of controllers) controller.close();
      await Promise.all(pending);
    }
  });

  test("rejects duplicate files and ignores claimed MIME types", async () => {
    const { app } = createTestApp();
    const duplicate = new FormData();
    duplicate.append("gif", new File([gifFixture()], "a.gif"));
    duplicate.append("gif", new File([gifFixture()], "b.gif"));
    const rejected = await app.fetch(
      new Request("http://gif.gg/", { method: "POST", body: duplicate }),
    );
    expect(rejected.status).toBe(422);
    const valid = new FormData();
    valid.append("gif", new File([gifFixture()], "untrusted.txt", { type: "text/plain" }));
    const accepted = await app.fetch(
      new Request("http://gif.gg/", { method: "POST", body: valid }),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toBe("/abcdefg");
  });

  test("renders a 404 page for unknown IDs", async () => {
    const { app } = createTestApp();
    const response = await app.fetch(new Request("http://gif.gg/notfound"));

    expect(response.status).toBe(404);
    expect(await response.text()).toContain(
      "Sorry, the page you are looking for is not available.",
    );
  });
});
