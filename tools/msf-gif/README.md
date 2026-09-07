# msf_gif WASM

Vendored unmodified msf_gif 2.4 from commit
`e280bc2189ed32b743c7f634cd21c0eb5def7046`:
<https://github.com/notnullnotvoid/msf_gif>.
The MIT/public-domain license is included at the end of `msf_gif.h`.
Distribution notices accompany the binary in `public/js/msf-gif.LICENSE.txt`.

`public/js/msf-gif.wasm` is included so normal development and deployment
only need Bun. To rebuild it, install Rust with the
`wasm32-unknown-unknown` target and clang with WebAssembly support, then run:

```sh
bun run build:encoder
```

The included binary was built with Rust 1.89.0 and clang 22.1.8.
Different compiler versions may produce different bytes.

SHA-256:

- `msf_gif.h`: `9648294925df507dbe010ef5917ab7ab1a0351d6dd99f3cc5dc71d6588041315`
- `msf-gif.wasm`: `c53e023b6c2ec426b3ed3436cd973cf283dade18911f1be603b13352f8466660`

The C bridge exposes incremental frame encoding at upstream quality 16,
with default dithering and infinite looping. Rust supplies allocation only;
there are no Cargo dependencies. Linear memory is capped at 256 MiB.
The worker copies one RGBA frame into a reusable input buffer at a time.
Terminate the worker to cancel; disposal releases native allocations on completion
or failure. This is our integration, not an upstream-supported WASM package.
