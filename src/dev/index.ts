import { watch } from "node:fs";
import { resolve } from "node:path";

const project = resolve(import.meta.dir, "../..");
let server: Bun.Subprocess | undefined;
let build: Bun.Subprocess | undefined;
let stopping = false;
let rebuilding = false;
let pending = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

async function rebuild(): Promise<void> {
  pending = true;
  if (rebuilding || stopping) return;
  rebuilding = true;
  try {
    while (pending && !stopping) {
      pending = false;
      build = Bun.spawn(["cargo", "build", "--manifest-path", "server/Cargo.toml", "--locked"], {
        cwd: project,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const status = await build.exited;
      build = undefined;
      if (stopping) break;
      if (status !== 0) {
        console.error("Rust build failed; waiting for changes.");
        continue;
      }
      if (server) {
        server.kill("SIGTERM");
        await server.exited;
      }
      if (stopping) break;
      server = Bun.spawn([resolve(project, "server/target/debug/gifgg-server"), "--dev"], {
        cwd: project,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const started = server;
      void started.exited.then((code) => {
        if (!stopping && server === started && code !== 0) {
          console.error(`Rust server exited (${code}); waiting for changes.`);
        }
      });
    }
  } finally {
    rebuilding = false;
  }
}

function changed(): void {
  clearTimeout(debounce);
  debounce = setTimeout(() => void rebuild(), 100);
}

// Watch source trees explicitly so Cargo's target directory cannot trigger
// rebuild loops or consume recursive filesystem watches.
const watchers = [
  watch(resolve(project, "server/src"), { recursive: true }, changed),
  watch(resolve(project, "server/templates"), { recursive: true }, changed),
  watch(resolve(project, "server"), (_event, file) => {
    if (file === "Cargo.toml" || file === "Cargo.lock" || file === "gif-columns.sql") changed();
  }),
];

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearTimeout(debounce);
  for (const watcher of watchers) watcher.close();
  build?.kill("SIGTERM");
  server?.kill("SIGTERM");
  await Promise.all([build?.exited, server?.exited]);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await rebuild();
