# gif.gg

## Requirements

- Bun 1.4+
- `mkcert` for local development

## Installation

Install the pinned development dependencies and build the browser assets:

```sh
bun install --frozen-lockfile
bun run build
```

Start the development server:

```sh
bun run dev
```

Development defaults to `/tmp/gifgg-development`. The server creates
`gifgg.sqlite` and a `gifs/` directory there. Set `DATA_DIR` to use another
external location.

Production requires an explicit persistent directory:

```sh
NODE_ENV=production DATA_DIR=/absolute/path/to/gifgg-data bun run start
```

The server listens on port `3000` by default. Set `PORT` to override it. `bun
serve` is also available as an alias for `bun run start`.

## Development

Run the HTTPS development server with automatic restarts:

```sh
bun run dev
```

The first run uses `mkcert` to install a local certificate authority and create
a certificate. Then open <https://gif.localhost:3000>. Run `bun run cert:dev`
to regenerate the certificate if needed.

Format the repository with `bun run format`. Run formatting checks, type checks,
tests, and the production frontend build with `bun run check`.

Maintained browser code lives in `src/client/` and is compiled as an ES module.
GIFs are encoded with `msf_gif` in a dedicated worker. The compiled WASM is
included; normal builds need no native toolchain. Pinned source, licensing,
and optional rebuild instructions are in [tools/msf-gif](tools/msf-gif/README.md).

See [UPGRADE.md](UPGRADE.md) for the legacy MySQL-to-SQLite migration procedure.

## Uploads

New uploads must be valid image GIFs, at most 10 MiB, 1920x1920 pixels,
500 frames, and 100 million decoded pixels (canvas width * height * frame count).
There is no duration limit. Existing GIFs are unaffected.
Capture stops at 500 frames, keeping the preview, speed controls and Save available.
Capture pauses when current size + 3 * average frame size would exceed 10 MiB.
A notice appears below the controls; the preview and Save remain available.
This is an estimate, not a guarantee. Server validation rejects oversized GIFs if
the estimate misses; reset to make a smaller GIF.

In development, open <https://gif.localhost:3000/?upload-errors> to preview the four
error categories in place of the GIF preview. Temporary errors offer "retry save" to save the
same GIF; validation errors require a reset. In the playground, "retry save" only
clears the error. No camera permission is needed and no uploads are sent.
The playground is disabled in production.

## License

<a href="http://pierre.mit-license.org/">MIT</a>
