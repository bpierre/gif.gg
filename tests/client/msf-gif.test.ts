import { describe, expect, test } from "bun:test";

import { createGifEncoder } from "../../src/client/msf-gif";

const wasm = await Bun.file(new URL("../../public/js/msf-gif.wasm", import.meta.url)).arrayBuffer();

// Walk GIF blocks independently of the encoder to verify container semantics.
function inspect(
  bytes: Uint8Array,
): { width: number; height: number; delays: number[]; loop: number; } {
  const word = (position: number): number => bytes[position]! | (bytes[position + 1]! << 8);
  expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe("GIF89a");
  const width = word(6);
  const height = word(8);
  let position = 13;
  if (bytes[10]! & 128) position += 3 * (2 ** ((bytes[10]! & 7) + 1));
  const delays: number[] = [];
  let pendingDelay = 0;
  let loop = -1;
  const skipBlocks = (): void => {
    while (bytes[position]) {
      position += bytes[position]! + 1;
      if (position >= bytes.length) throw new Error("Truncated GIF");
    }
    position++;
  };
  while (position < bytes.length) {
    const marker = bytes[position++];
    if (marker === 0x3b) return { width, height, delays, loop };
    if (marker === 0x21) {
      const type = bytes[position++];
      if (type === 0xf9) pendingDelay = word(position + 2);
      if (type === 0xff) {
        const name = new TextDecoder().decode(bytes.subarray(position + 1, position + 12));
        if (name === "NETSCAPE2.0") loop = word(position + 14);
      }
      skipBlocks();
    } else if (marker === 0x2c) {
      const flags = bytes[position + 8]!;
      position += 9;
      if (flags & 128) position += 3 * (2 ** ((flags & 7) + 1));
      position++; // LZW minimum code size.
      skipBlocks();
      delays.push(pendingDelay);
    } else {
      throw new Error("Invalid GIF block");
    }
  }
  throw new Error("Missing GIF trailer");
}

describe("msf_gif WASM", () => {
  test("encodes dimensions, every frame, variable delays and infinite looping", async () => {
    const encoder = await createGifEncoder(wasm, 320, 240);
    const pixels = new Uint8ClampedArray(320 * 240 * 4);
    for (const delay of [20, 400, 1000, 25]) {
      pixels.fill(delay % 256);
      encoder.addFrame(pixels, delay);
    }
    const bytes = encoder.finish();
    expect(inspect(bytes)).toEqual({
      width: 320,
      height: 240,
      delays: [2, 40, 100, 3],
      loop: 0,
    });
    encoder.dispose();
    expect(() => encoder.addFrame(pixels, 20)).toThrow("closed");
    expect(() => encoder.finish()).toThrow();
  });

  test("retains identical frames and supports a single-frame GIF", async () => {
    for (const count of [1, 3]) {
      const encoder = await createGifEncoder(wasm, 2, 2);
      for (let index = 0; index < count; index++) {
        encoder.addFrame(new Uint8ClampedArray(16).fill(255), 400);
      }
      expect(inspect(encoder.finish()).delays).toEqual(Array(count).fill(40));
    }
  });

  test("rejects invalid inputs and supports idempotent disposal", async () => {
    for (const [width, height] of [[0, 1], [-1, 1], [1.5, 2], [65_536, 1], [16_777_216, 2]]) {
      await expect(createGifEncoder(wasm, width!, height!)).rejects.toThrow("dimensions");
    }
    const encoder = await createGifEncoder(wasm, 2, 2);
    expect(() => encoder.finish()).toThrow("No GIF frames");
    expect(() => encoder.addFrame(new Uint8ClampedArray(4), 20)).toThrow("size");
    for (const delay of [NaN, Infinity, -1, 655_360]) {
      expect(() => encoder.addFrame(new Uint8ClampedArray(16), delay)).toThrow("delay");
    }
    encoder.dispose();
    encoder.dispose();
    expect(() => encoder.addFrame(new Uint8ClampedArray(16), 20)).toThrow("closed");
  });

  test("rejects a corrupt WASM payload", async () => {
    await expect(createGifEncoder(new Uint8Array([1, 2, 3]), 2, 2)).rejects.toThrow();
  });
});
