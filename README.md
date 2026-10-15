# gif.gg

## Requirements

- Bun 1.4+
- Rust 1.89+ and a C compiler (for bundled SQLite)

## Development

```sh
bun install --frozen-lockfile
bun run dev
```

`dev` builds and watches the browser assets (client, worker, and CSS). Refresh the
browser after changes. The application server is a single HTTP binary; Nix manages
the local service and Nginx proxy, and Nginx handles production TLS.

The neighboring `ubuntu-2022/nixos` configuration exposes the local VM at
<http://gifgg.localhost:8080>. Its gif.gg package must be updated from the old Bun
source pin to this Rust version before it can run this branch. Browser asset
watching here does not update a packaged Nix service; rebuild its package/VM to
test source changes there.

For a standalone local run, build and start the same HTTP binary:

```sh
bun run build
bun run start
```

Then open <http://localhost:3000>. Without `NODE_ENV=production`, data defaults to
`/tmp/gifgg-development`; set `DATA_DIR` to override it. The server creates
`gifgg.sqlite` and a `gifs/` directory there.

Format the repository with `bun run format`. Run formatting checks, type checks,
tests, Rust lint checks, and the production build with `bun run check`.

The backend lives in `server/`. Tests cover HTTP responses, database upgrades, and
a GIF validation corpus using temporary data directories. Captured response and
validation fingerprints preserve the behavior from before the migration.

Maintained browser code lives in `src/client/` and is compiled as an ES module.
GIFs are encoded with `msf_gif` in a dedicated worker. The compiled WASM is
included; rebuilding the encoder separately requires clang with WebAssembly support. Pinned source, licensing,
and optional rebuild instructions are in [tools/msf-gif](tools/msf-gif/README.md).

See [UPGRADE.md](UPGRADE.md) for the legacy MySQL-to-SQLite migration procedure.

## Production

Build the server and browser assets, then start with an explicit persistent directory:

```sh
bun install --frozen-lockfile
bun run build
NODE_ENV=production DATA_DIR=/absolute/path/to/gifgg-data bun run start
```

Production serves HTTP behind your TLS reverse proxy. The default port is `3000`;
set `PORT` to override it.

The production server is `server/target/release/gifgg-server`. It can run directly
without Bun. To deploy outside the checkout, place the built `public/` directory
beside the binary. Keep the same `NODE_ENV`, `DATA_DIR`, `PORT`, and `APP_VERSION`
settings. Existing SQLite databases, GIF files, and URLs require no data migration.
Stop the running server before switching binaries.

## Uploads

New uploads must be valid image GIFs, at most 10 MiB, 1920x1920 pixels,
500 frames, and 100 million decoded pixels (canvas width * height * frame count).
There is no duration limit. Existing GIFs are unaffected.
Capture stops at 500 frames, keeping the preview, speed controls and Save available.
Capture pauses when current size + 3 * average frame size would exceed 10 MiB.
A notice appears below the controls; the preview and Save remain available.
This is an estimate, not a guarantee. Server validation rejects oversized GIFs if
the estimate misses; reset to make a smaller GIF.

Outside production mode, open <http://localhost:3000/?upload-errors> to preview the four
error categories in place of the GIF preview. Temporary errors offer "retry save" to save the
same GIF; validation errors require a reset. In the playground, "retry save" only
clears the error. No camera permission is needed and no uploads are sent.
The playground is disabled in production.

## License

<a href="http://pierre.mit-license.org/">MIT</a>
