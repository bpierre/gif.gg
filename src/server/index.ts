import { MAX_UPLOAD_BODY_BYTES } from "../shared/upload-policy";
import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = createApp(config);
const port = Number(process.env.PORT ?? "3000");

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const server = Bun.serve({
  port,
  maxRequestBodySize: MAX_UPLOAD_BODY_BYTES,
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

console.log(`gif.gg listening on ${server.url}`);
