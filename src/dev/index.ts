import { resolve } from "node:path";

import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import { MAX_UPLOAD_BODY_BYTES } from "../shared/upload-policy";

const config = loadConfig();
const app = createApp(config);
const port = Number(process.env.PORT ?? "3000");

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const certificate = Bun.file(resolve(".certs/localhost.pem"));
const key = Bun.file(resolve(".certs/localhost-key.pem"));
if (!(await certificate.exists()) || !(await key.exists())) {
  throw new Error("development certificate is missing; run `bun run cert:dev`");
}

const server = Bun.serve({
  port,
  maxRequestBodySize: MAX_UPLOAD_BODY_BYTES,
  tls: { cert: certificate, key },
  fetch(request, bunServer) {
    return app.fetch(request, bunServer);
  },
});

function stop(): void {
  server.stop();
  app.close();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

console.log(`gif.gg development server listening on ${server.url}`);
