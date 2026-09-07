import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { InclusiveRandomInteger } from "../id/alphabet";
import { generateId } from "../id/generate-id";
import {
  MAX_UPLOAD_BODY_BYTES,
  UPLOAD_LIMITS,
  UploadError,
  type UploadErrorCode,
} from "../shared/upload-policy";
import type { AppConfig } from "./config";
import { GifDatabase } from "./database";
import { renderAbout, renderError, renderGif, renderMain, renderTwitterPlayer } from "./html";
import { validateUpload } from "./validate-upload";

const ID_PATTERN = /^[0-9A-Za-z]+$/;
const GIF_PATH_PATTERN = /^\/(?:gifs\/)?([0-9A-Za-z]+)\.gif$/;
const PUBLIC_PATH_PATTERN = /^\/(?:css|js)\/[0-9A-Za-z._-]+$/;
const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const PUBLIC_DIR = join(PROJECT_ROOT, "public");

export interface RequestServer {
  requestIP(request: Request): { address: string; } | null;
}

export interface AppDependencies {
  randomInteger?: InclusiveRandomInteger;
}

export interface GifApp {
  database: GifDatabase;
  fetch(request: Request, server?: RequestServer): Promise<Response>;
  close(): void;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function uploadFailure(code: UploadErrorCode): Response {
  const status = code === "too_large"
    ? 413
    : code === "busy" || code === "timeout"
    ? 503
    : code === "internal"
    ? 500
    : 422;
  return Response.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
}

async function readUpload(request: Request): Promise<FormData> {
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BODY_BYTES) {
    void request.body?.cancel().catch(() => {});
    throw new UploadError("too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new UploadError("invalid");
  const body = new Uint8Array(MAX_UPLOAD_BODY_BYTES);
  let length = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 30_000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > MAX_UPLOAD_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new UploadError("too_large");
      }
      body.set(value, length);
      length += value.length;
    }
    if (timedOut) throw new UploadError("timeout");
    return await new Response(body.subarray(0, length), { headers: request.headers }).formData();
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

async function existingFile(path: string, disableCache: boolean): Promise<Response | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }

  const response = new Response(file);
  response.headers.set("x-content-type-options", "nosniff");
  if (disableCache) {
    response.headers.set("cache-control", "no-store");
  }
  return response;
}

export function createApp(
  config: AppConfig,
  dependencies: AppDependencies = {},
): GifApp {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.gifsDir, { recursive: true });
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const database = new GifDatabase(config.databasePath);
  const randomInteger = dependencies.randomInteger
    ?? ((minimumInclusive: number, maximumInclusive: number) =>
      randomInt(minimumInclusive, maximumInclusive + 1));

  let activeUploads = 0;
  async function upload(request: Request, server?: RequestServer): Promise<Response> {
    if (activeUploads >= 2) {
      void request.body?.cancel().catch(() => {});
      return uploadFailure("busy");
    }
    activeUploads++;
    try {
      return await processUpload(request, server);
    } finally {
      activeUploads--;
    }
  }

  async function processUpload(request: Request, server?: RequestServer): Promise<Response> {
    let formData: FormData;

    try {
      formData = await readUpload(request);
    } catch (error) {
      return uploadFailure(error instanceof UploadError ? error.code : "invalid");
    }

    const gif = formData.get("gif");
    if (!(gif instanceof File) || formData.getAll("gif").length !== 1) {
      return uploadFailure("invalid");
    }
    if (gif.size > UPLOAD_LIMITS.bytes) return uploadFailure("too_large");
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await validateUpload(new Uint8Array(await gif.arrayBuffer()));
    } catch (error) {
      return uploadFailure(error instanceof UploadError ? error.code : "internal");
    }

    const id = generateId({
      randomInteger,
      idExists: (candidate) =>
        database.hasGif(candidate)
        || existsSync(join(config.gifsDir, `${candidate}.gif`)),
    });
    const destination = join(config.gifsDir, `${id}.gif`);
    let metadataStored = false;

    try {
      database.insertGif({
        urlId: id,
        private: true,
        ip: server?.requestIP(request)?.address || null,
        createdAt: new Date().toISOString(),
      });
      metadataStored = true;
      await Bun.write(destination, bytes);
      return new Response(`/${id}`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    } catch (error) {
      if (metadataStored) {
        database.deleteGif(id);
      }
      if (existsSync(destination)) {
        unlinkSync(destination);
      }
      console.error("Failed to store GIF", error);
      return uploadFailure("internal");
    }
  }

  async function fetch(request: Request, server?: RequestServer): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (request.method === "GET" && pathname === "/") {
        return html(renderMain(config));
      }

      if (request.method === "POST" && pathname === "/") {
        return upload(request, server);
      }

      if (request.method === "GET" && pathname === "/about") {
        return html(renderAbout(config));
      }

      if (request.method === "GET" && pathname === "/favicon.png") {
        return (await existingFile(join(PUBLIC_DIR, "favicon.png"), config.debug))
          ?? html(renderError(config, 404), 404);
      }

      if (request.method === "GET" && PUBLIC_PATH_PATTERN.test(pathname)) {
        return (await existingFile(join(PUBLIC_DIR, pathname), config.debug))
          ?? html(renderError(config, 404), 404);
      }

      const gifPathMatch = GIF_PATH_PATTERN.exec(pathname);
      if (request.method === "GET" && gifPathMatch) {
        const id = gifPathMatch[1];
        if (id) {
          return (await existingFile(join(config.gifsDir, `${id}.gif`), false))
            ?? html(renderError(config, 404), 404);
        }
      }

      const twitterPlayerPrefix = "/twitter-player/";
      if (request.method === "GET" && pathname.startsWith(twitterPlayerPrefix)) {
        const id = pathname.slice(twitterPlayerPrefix.length);
        if (
          ID_PATTERN.test(id)
          && existsSync(join(config.gifsDir, `${id}.gif`))
        ) {
          return html(renderTwitterPlayer(id));
        }

        return html(renderError(config, 404), 404);
      }

      const id = pathname.slice(1);
      if (
        request.method === "GET"
        && ID_PATTERN.test(id)
        && database.hasGif(id)
      ) {
        return html(renderGif(config, id));
      }

      return html(renderError(config, 404), 404);
    } catch (error) {
      console.error("Request failed", error);
      return html(renderError(config, 500), 500);
    }
  }

  return {
    database,
    fetch,
    close() {
      database.close();
    },
  };
}
