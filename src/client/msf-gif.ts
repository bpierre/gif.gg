interface EncoderExports {
  memory: WebAssembly.Memory;
  encoder_begin(width: number, height: number): number;
  encoder_pixels(): number;
  encoder_frame(delay: number): number;
  encoder_end(): number;
  encoder_size(): number;
  encoder_dispose(): void;
}

export interface GifEncoder {
  addFrame(pixels: Uint8ClampedArray, milliseconds: number): void;
  finish(): Uint8Array<ArrayBuffer>;
  dispose(): void;
}

export async function createGifEncoder(
  wasm: BufferSource,
  width: number,
  height: number,
): Promise<GifEncoder> {
  if (
    !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 65_535 || height > 65_535
    || width * height > 16_777_216
  ) throw new Error("Unsupported GIF dimensions");
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module);
  const native = instance.exports as unknown as EncoderExports;
  if (!native.encoder_begin(width, height)) {
    native.encoder_dispose();
    throw new Error("Not enough memory to encode this GIF");
  }
  let closed = false;
  let frames = 0;
  const dispose = (): void => {
    if (!closed) native.encoder_dispose();
    closed = true;
  };
  return {
    addFrame(pixels, milliseconds) {
      if (closed) throw new Error("GIF encoder is closed");
      if (pixels.length !== width * height * 4) throw new Error("Invalid GIF frame size");
      const delay = Math.round(milliseconds / 10);
      if (!Number.isFinite(milliseconds) || milliseconds < 0 || delay > 65_535) {
        throw new Error("Invalid GIF frame delay");
      }
      // Native allocation may grow memory between frames; never cache the view.
      new Uint8Array(native.memory.buffer, native.encoder_pixels(), pixels.length).set(pixels);
      if (!native.encoder_frame(delay)) throw new Error("Not enough memory to encode this GIF");
      frames++;
    },
    finish() {
      if (closed || frames === 0) throw new Error("No GIF frames to encode");
      try {
        const pointer = native.encoder_end();
        const size = native.encoder_size();
        if (!pointer || !size) throw new Error("GIF encoding failed");
        return new Uint8Array(native.memory.buffer, pointer, size).slice();
      } finally {
        dispose();
      }
    },
    dispose,
  };
}
