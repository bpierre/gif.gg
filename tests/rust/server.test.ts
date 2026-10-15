import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MAX_UPLOAD_BODY_BYTES, UPLOAD_LIMITS } from "../../src/shared/upload-policy";
import { gifCorpus } from "./gif-corpus";
import { gifFixture } from "./gif-fixture";

const project = resolve(import.meta.dir, "../..");
const directories: string[] = [];
const processes: Bun.Subprocess[] = [];
const socketResponses = new WeakMap<Socket, string>();

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "gifgg-rust-parity-"));
  directories.push(path);
  return path;
}

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
}

async function holdUpload(url: string): Promise<Socket> {
  const { hostname, port } = new URL(url);
  return await new Promise((resolve, reject) => {
    const socket = createConnection({ host: hostname, port: Number(port) });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`No 100 Continue from ${url}: ${socketResponses.get(socket)}`));
    }, 3000);
    socketResponses.set(socket, "");
    let continued = false;
    socket.on("data", (bytes) => {
      const response = socketResponses.get(socket)! + bytes.toString();
      socketResponses.set(socket, response);
      if (!continued && response.includes("100 Continue\r\n")) {
        continued = true;
        clearTimeout(timer);
        socket.write("8\r\n--test\r\n\r\n", () => resolve(socket));
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("connect", () => {
      socket.write(
        "POST / HTTP/1.1\r\nHost: gif.gg\r\nContent-Type: multipart/form-data; boundary=test\r\nTransfer-Encoding: chunked\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n",
      );
    });
  });
}

async function rustServer(dataDir: string, production = false, developmentTls = false) {
  const port = freePort();
  const process = Bun.spawn([
    join(project, "server/target/debug/gifgg-server"),
    ...(developmentTls ? ["--dev"] : []),
  ], {
    cwd: project,
    env: {
      ...Bun.env,
      DATA_DIR: dataDir,
      NODE_ENV: production ? "production" : "development",
      APP_VERSION: " parity !'()* café /?& ",
      PORT: String(port),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  processes.push(process);
  const url = `${developmentTls ? "https" : "http"}://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Rust server exited: ${await new Response(process.stderr).text()}`);
    }
    try {
      const response = await fetch(url, { tls: { rejectUnauthorized: false } });
      await response.arrayBuffer();
      return { url, process };
    } catch {
      await Bun.sleep(20);
    }
  }
  throw new Error("Rust server did not start");
}

beforeAll(() => {
  const result = Bun.spawnSync([
    "cargo",
    "build",
    "--manifest-path",
    "server/Cargo.toml",
    "--locked",
    "--bins",
    "--examples",
  ], { cwd: project, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}, 120_000);

afterAll(async () => {
  for (const process of processes) process.kill("SIGTERM");
  await Promise.all(processes.map(async (process) => {
    const timer = setTimeout(() => process.kill("SIGKILL"), 3000);
    try {
      await process.exited;
    } finally {
      clearTimeout(timer);
    }
  }));
  for (const path of directories) rmSync(path, { recursive: true, force: true });
});

type Fingerprint = { bytes: number; sha256: string; };
// Captured from the original backend at 66a7e54 before removing its source.
const baseline = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/baseline.json"), "utf8"),
) as {
  html: Record<string, Fingerprint>;
  validator: { count: number; sha256: string; };
};
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function seed(dataDir: string) {
  const database = new Database(join(dataDir, "gifgg.sqlite"));
  const columns = readFileSync(join(project, "server/gif-columns.sql"), "utf8");
  database.exec(`CREATE TABLE gifs (${columns});`);
  for (const id of ["a0", "metadataOnly"]) {
    database.query(
      "INSERT INTO gifs (url_id, private, ip, created_at) VALUES (?, 1, NULL, '2020-01-01')",
    ).run(id);
  }
  database.close();
  // The server creates the media directory at startup.
}

async function expectHtml(
  response: Response,
  production: boolean,
  name: string,
  status = 200,
  head = false,
) {
  const expected = baseline.html[`${production ? "production" : "development"}/${name}`]!;
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("content-length")).toBe(String(expected.bytes));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (head) expect(bytes.length).toBe(0);
  else expect(sha256(bytes)).toBe(expected.sha256);
}

async function expectUploadError(response: Response, error: string, status = 422) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe("application/json;charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error });
}

describe("Rust backend", () => {
  test("keeps browser and server upload limits identical", () => {
    const result = Bun.spawnSync([
      join(project, "server/target/debug/examples/validate"),
      "--limits",
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      ...UPLOAD_LIMITS,
      bodyBytes: MAX_UPLOAD_BODY_BYTES,
    });
  });

  test("preserves complete HTML, legacy routes, static files and unsupported methods", async () => {
    for (const production of [false, true]) {
      const dataDir = directory();
      seed(dataDir);
      const server = await rustServer(dataDir, production);
      for (const id of ["a0", "orphan"]) {
        writeFileSync(join(dataDir, "gifs", `${id}.gif`), gifFixture());
      }
      const pages: Record<string, string> = {
        "/": "main",
        "/?upload-errors": "main",
        "/about": "about",
        "/a0": "a0",
        "/metadataOnly": "metadataOnly",
        "/twitter-player/a0": "playerA0",
        "/twitter-player/orphan": "playerOrphan",
        "/%2e%2e/about": "about",
      };
      for (const [path, name] of Object.entries(pages)) {
        await expectHtml(await fetch(server.url + path), production, name);
      }
      for (
        const path of [
          "/about/",
          "/metadataOnly.gif",
          "/twitter-player/metadataOnly",
          "/orphan",
          "/unknown",
          "/unknown.gif",
          "/twitter-player/unknown",
          "/js/missing.js",
          "/js/nested/file.js",
          "/js/%6dsf-gif.wasm",
          "/a%30",
          "/a0.gif/",
        ]
      ) {
        await expectHtml(await fetch(server.url + path), production, "error", 404);
      }
      for (const method of ["HEAD", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
        for (const path of ["/", "/about", "/a0", "/a0.gif", "/js/msf-gif.wasm"]) {
          await expectHtml(
            await fetch(server.url + path, { method }),
            production,
            "error",
            404,
            method === "HEAD",
          );
        }
      }
      const publicFiles: [string, string][] = [
        ["/favicon.png", "image/png"],
        ["/css/index.css", "text/css;charset=utf-8"],
        ["/css/gif.gg.css", "text/css;charset=utf-8"],
        ["/js/gif.gg.js", "text/javascript;charset=utf-8"],
        ["/js/gif-worker.js", "text/javascript;charset=utf-8"],
        ["/js/msf-gif.wasm", "application/wasm"],
        ["/js/msf-gif.LICENSE.txt", "text/plain;charset=utf-8"],
      ];
      for (const [path, type] of publicFiles) {
        const response = await fetch(server.url + path + "?version=1");
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(type);
        expect(response.headers.get("cache-control")).toBe(production ? null : "no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
          new Uint8Array(readFileSync(join(project, "public", path))),
        );
      }
      for (
        const path of [
          "/a0.gif",
          "/gifs/a0.gif",
          "/orphan.gif",
          "/gifs/orphan.gif",
          "/gifs/../a0.gif",
        ]
      ) {
        const response = await fetch(server.url + path);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/gif");
        expect(response.headers.get("cache-control")).toBeNull();
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(gifFixture());
      }
    }
  }, 30_000);

  test("preserves file byte ranges and malformed-range behavior", async () => {
    const server = await rustServer(directory());
    const wasm = new Uint8Array(readFileSync(join(project, "public/js/msf-gif.wasm")));
    const cases: [string, [number, number] | "invalid" | "ignored"][] = [
      ["bytes=0-10", [0, 10]],
      ["bytes=10-", [10, wasm.length - 1]],
      ["bytes=-10", [wasm.length - 10, wasm.length - 1]],
      ["bytes=-0", "invalid"],
      ["bytes=999999-", "invalid"],
      ["bytes=10-0", "ignored"],
      ["bytes=foo", "ignored"],
      ["bytes=0-1,4-5", "ignored"],
      ["items=0-10", "ignored"],
      ["bytes=0-999999", [0, wasm.length - 1]],
      ["bytes=-999999", [0, wasm.length - 1]],
    ];
    for (const [range, expected] of cases) {
      const response = await fetch(server.url + "/js/msf-gif.wasm", { headers: { range } });
      expect(response.status).toBe(
        expected === "ignored" ? 200 : expected === "invalid" ? 416 : 206,
      );
      const body = new Uint8Array(await response.arrayBuffer());
      if (expected === "ignored") {
        expect(response.headers.get("content-range")).toBeNull();
        expect(response.headers.get("accept-ranges")).toBeNull();
        expect(body).toEqual(wasm);
      } else {
        expect(response.headers.get("accept-ranges")).toBe("bytes");
        if (expected === "invalid") {
          expect(response.headers.get("content-range")).toBe(`bytes */${wasm.length}`);
          expect(body.length).toBe(0);
        } else {
          const [start, end] = expected;
          expect(response.headers.get("content-range")).toBe(
            `bytes ${start}-${end}/${wasm.length}`,
          );
          expect(body).toEqual(wasm.slice(start, end + 1));
        }
      }
    }
  });

  test("preserves multipart field selection and file detection", async () => {
    const server = await rustServer(directory());
    const dispositions = [
      "form-data; name=\"gif\"; filename=\"capture.gif\"",
      "form-data; name=gif; filename=capture.gif",
      "form-data; name=\"gif\"; filename=capture.gif",
      "form-data; filename=\"capture.gif\"; name=gif",
      "FORM-DATA; NAME=\"gif\"; FILENAME=\"capture.gif\"",
      "form-data; name=\"gif\"; filename=\"\"",
      "form-data; name=\"gif\"; filename=\"a/b.gif\"",
      "form-data; name=\"gif\"; filename*=UTF-8''capture.gif",
      "form-data; name=\"gif\"",
      "form-data; name=\"GIF\"; filename=\"capture.gif\"",
      "attachment; name=\"gif\"; filename=\"capture.gif\"",
    ];
    for (let index = 0; index < dispositions.length; index++) {
      for (const ending of ["\r\n--test--\r\n", "\r\n--test--", "", "\r\n--test--\r\nepilogue"]) {
        const body = new Blob([
          `--test\r\nContent-Disposition: ${
            dispositions[index]
          }\r\nContent-Type: image/gif\r\n\r\n`,
          gifFixture(),
          ending,
        ]);
        const response = await fetch(server.url, {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=\"test\"" },
          body,
        });
        if ([0, 2, 3, 4, 5, 6].includes(index) && ending !== "") {
          expect(response.status).toBe(200);
          expect(await response.text()).toMatch(/^\/[a-zA-Z0-9]{7}$/);
        } else await expectUploadError(response, "invalid");
      }
    }
  });

  test(
    "rejects invalid uploads without writes and stores valid GIF bytes and metadata",
    async () => {
      const dataDir = directory();
      const server = await rustServer(dataDir);
      const fixtures: [Uint8Array<ArrayBuffer> | null, string][] = [
        [null, "invalid"],
        [new Uint8Array(), "invalid"],
        [new TextEncoder().encode("GIF89a"), "invalid"],
        [gifFixture(0), "invalid"],
        [gifFixture(1, 1921, 1), "dimensions"],
        [gifFixture(1, 1, 1921), "dimensions"],
        [gifFixture(501), "frames"],
        [gifFixture(28, 1920, 1920), "pixels"],
        [new Uint8Array(UPLOAD_LIMITS.bytes + 1), "too_large"],
      ];
      for (const [bytes, error] of fixtures) {
        const form = new FormData();
        if (bytes !== null) {
          form.append(
            "gif",
            new File([bytes], "capture.gif", { type: "image/gif" }),
          );
        }
        await expectUploadError(
          await fetch(server.url, { method: "POST", body: form }),
          error,
          error === "too_large" ? 413 : 422,
        );
        expect(readdirSync(join(dataDir, "gifs"))).toEqual([]);
      }
      const duplicate = new FormData();
      duplicate.append("gif", new File([gifFixture()], "a.gif"));
      duplicate.append("gif", new File([gifFixture()], "b.gif"));
      const text = new FormData();
      text.append("gif", "GIF89a");
      for (
        const body of ["not multipart", new URLSearchParams({ gif: "not a file" }), duplicate, text]
      ) {
        await expectUploadError(await fetch(server.url, { method: "POST", body }), "invalid");
      }
      const form = new FormData();
      form.append("ignored", "extra field");
      form.append("gif", new File([gifFixture()], "untrusted.txt", { type: "text/plain" }));
      const response = await fetch(server.url, { method: "POST", body: form });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      const path = await response.text();
      expect(path).toMatch(/^\/[a-zA-Z0-9]{7}$/);
      const id = path.slice(1);
      expect(new Uint8Array(readFileSync(join(dataDir, "gifs", `${id}.gif`)))).toEqual(
        gifFixture(),
      );
      const database = new Database(join(dataDir, "gifgg.sqlite"), { readonly: true });
      try {
        const record = database.query<
          { url_id: string; private: number; ip: string; created_at: string; },
          []
        >("SELECT * FROM gifs").get()!;
        expect(record.url_id).toBe(id);
        expect(record.private).toBe(1);
        expect(record.ip).toBe("::ffff:127.0.0.1");
        expect(record.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(database.query("SELECT count(*) AS count FROM gifs").get()).toEqual({ count: 1 });
      } finally {
        database.close();
      }
      for (const route of [path, `${path}.gif`, `/gifs${path}.gif`, `/twitter-player${path}`]) {
        const response = await fetch(server.url + route);
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      }
    },
    30_000,
  );

  test("bounds chunked request bodies", async () => {
    const server = await rustServer(directory());
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_UPLOAD_BODY_BYTES + 1));
          controller.close();
        },
      }),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("");
  });

  test("keeps pages available while uploads are busy and releases canceled upload slots", async () => {
    const server = await rustServer(directory());
    // 100 Continue confirms that both uploads reached body reading before a
    // third request can race them for a slot.
    const pending = await Promise.all([holdUpload(server.url), holdUpload(server.url)]);
    try {
      await expectUploadError(
        await fetch(server.url, { method: "POST", body: "test" }),
        "busy",
        503,
      );
      const page = await fetch(server.url);
      expect(page.status).toBe(200);
      await page.text();
    } finally {
      for (const socket of pending) socket.destroy();
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const form = new FormData();
      form.append("gif", new File([gifFixture()], "capture.gif"));
      const response = await fetch(server.url, { method: "POST", body: form });
      await response.text();
      if (response.status === 200) return;
      expect(response.status).toBe(503);
      await Bun.sleep(10);
    }
    throw new Error("Canceled uploads did not release their slots");
  });

  test("preserves validation results for the captured 9,220-input corpus", async () => {
    const corpus = await gifCorpus();
    const frames: BlobPart[] = [];
    for (const bytes of corpus) {
      const length = new Uint8Array(4);
      new DataView(length.buffer).setUint32(0, bytes.length, true);
      frames.push(length, bytes);
    }
    const process = Bun.spawn([join(project, "server/target/debug/examples/validate")], {
      stdin: new Blob(frames),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errors, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(code, errors).toBe(0);
    const actual = output.trim().split("\n").map(line =>
      JSON.parse(line) as Record<string, unknown>
    );
    expect(actual.length).toBe(baseline.validator.count);
    const canonical = actual.map(result => JSON.stringify(result, Object.keys(result).sort())).join(
      "\n",
    );
    expect(sha256(canonical)).toBe(baseline.validator.sha256);
  }, 30_000);

  test("upgrades old databases while preserving rows, indexes, triggers and deleted IDs", async () => {
    const dataDir = directory();
    const path = join(dataDir, "gifgg.sqlite");
    const database = new Database(path);
    database.exec(`
      CREATE TABLE gifs (id INTEGER PRIMARY KEY AUTOINCREMENT, url_id TEXT NOT NULL UNIQUE,
        private INTEGER NOT NULL DEFAULT 1 CHECK (private IN (0, 1)), ip TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO gifs VALUES (7, 'a0', 0, '203.0.113.7', '2020-01-01');
      INSERT INTO gifs VALUES (8, 'emptyIp', 1, '', '2020-01-02');
      INSERT INTO gifs VALUES (99, 'deleted', 1, '', '2020-01-03');
      DELETE FROM gifs WHERE id = 99;
      CREATE INDEX custom_ip_idx ON gifs (ip);
      CREATE TABLE audit (url_id TEXT);
      CREATE TRIGGER audit_gifs AFTER INSERT ON gifs BEGIN INSERT INTO audit VALUES (new.url_id); END;
    `);
    database.close();
    const server = await rustServer(dataDir);
    for (const expectedId of [100, 101]) {
      const form = new FormData();
      form.append("gif", new File([gifFixture()], "capture.gif"));
      const response = await fetch(server.url, { method: "POST", body: form });
      expect(response.status).toBe(200);
      const id = (await response.text()).slice(1);
      const inspection = new Database(path, { readonly: true });
      try {
        expect(inspection.query("SELECT id FROM gifs WHERE url_id = ?").get(id)).toEqual({
          id: expectedId,
        });
        expect(inspection.query("SELECT * FROM gifs WHERE id < 99 ORDER BY id").all()).toEqual([
          { id: 7, url_id: "a0", private: 0, ip: "203.0.113.7", created_at: "2020-01-01" },
          { id: 8, url_id: "emptyIp", private: 1, ip: null, created_at: "2020-01-02" },
        ]);
        expect(inspection.query("SELECT * FROM audit WHERE url_id = ?").get(id)).toEqual({
          url_id: id,
        });
        const indexes = inspection.query<{ name: string; }, []>("PRAGMA index_list(gifs)").all()
          .map(row => row.name);
        expect(indexes).toContain("custom_ip_idx");
        expect(indexes).toContain("gifs_created_at_idx");
        expect(inspection.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      } finally {
        inspection.close();
      }
    }
  });

  test("rolls back a failed schema upgrade and preserves an empty table's sequence", async () => {
    for (const fail of [true, false]) {
      const dataDir = directory();
      const path = join(dataDir, "gifgg.sqlite");
      const database = new Database(path);
      database.exec(`
        CREATE TABLE gifs (id INTEGER PRIMARY KEY AUTOINCREMENT, url_id TEXT NOT NULL UNIQUE,
          private INTEGER NOT NULL DEFAULT 1 CHECK (private IN (0, 1)), ip TEXT NOT NULL, created_at TEXT NOT NULL);
        INSERT INTO gifs VALUES (42, 'existing', 1, '', '2020-01-01');
        ${fail ? "CREATE VIEW gif_view AS SELECT * FROM gifs;" : "DELETE FROM gifs;"}
      `);
      database.close();
      if (fail) {
        const process = Bun.spawn([join(project, "server/target/debug/gifgg-server")], {
          env: { ...Bun.env, DATA_DIR: dataDir, PORT: String(freePort()) },
          stdout: "pipe",
          stderr: "pipe",
        });
        processes.push(process);
        expect(await process.exited).not.toBe(0);
        const inspection = new Database(path);
        try {
          expect(inspection.query("SELECT ip FROM gifs").get()).toEqual({ ip: "" });
          expect(
            inspection.query("SELECT [notnull] FROM pragma_table_info('gifs') WHERE name='ip'")
              .get(),
          ).toEqual({ notnull: 1 });
          expect(
            inspection.query("SELECT name FROM sqlite_schema WHERE name='gifs_nullable_ip'").get(),
          ).toBeNull();
          expect(inspection.query("SELECT seq FROM sqlite_sequence WHERE name='gifs'").get())
            .toEqual({ seq: 42 });
          expect(inspection.query("SELECT ip FROM gif_view").get()).toEqual({ ip: "" });
        } finally {
          inspection.close();
        }
      } else {
        const rust = await rustServer(dataDir);
        const form = new FormData();
        form.append("gif", new File([gifFixture()], "capture.gif"));
        const response = await fetch(rust.url, { method: "POST", body: form });
        expect(response.status).toBe(200);
        await response.text();
        const inspection = new Database(path);
        try {
          expect(inspection.query("SELECT id FROM gifs").get()).toEqual({ id: 43 });
        } finally {
          inspection.close();
        }
      }
    }
  });
});
