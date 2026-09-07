import { describe, expect, test } from "bun:test";
import { createGifEncoder } from "../../src/client/msf-gif";
import { validateGif } from "../../src/server/validate-gif";
import { UPLOAD_LIMITS, UploadError, type UploadErrorCode } from "../../src/shared/upload-policy";
import { gifFixture } from "./gif-fixture";

function rejects(bytes: Uint8Array, code: UploadErrorCode = "invalid"): void {
  try {
    validateGif(bytes);
    throw new Error("Expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).code).toBe(code);
  }
}

describe("GIF upload validation", () => {
  test("accepts 87a/89a, single frames and boundary limits", () => {
    expect(validateGif(gifFixture())).toEqual({ width: 1, height: 1, frames: 1 });
    const older = gifFixture();
    older[4] = 55;
    expect(validateGif(older).frames).toBe(1);
    expect(validateGif(gifFixture(500)).frames).toBe(500);
    expect(validateGif(gifFixture(27, 1920, 1920)).frames).toBe(27);
  });

  test("rejects truncated data, trailing bytes, absent frames and invalid LZW", () => {
    const valid = gifFixture();
    for (let end = 0; end < valid.length; end++) rejects(valid.slice(0, end));
    rejects(new Uint8Array([...valid, 0]));
    rejects(gifFixture(0));
    const badCode = valid.slice();
    badCode[31] = 0xff;
    rejects(badCode);
    const badPaletteIndex = valid.slice();
    badPaletteIndex[31] = 0x5c; // clear, palette index 3 (only 2 entries), end.
    rejects(badPaletteIndex);
    const wrongPixelCount = valid.slice();
    wrongPixelCount[6] = 2;
    wrongPixelCount[24] = 2;
    rejects(wrongPixelCount);
    const outOfBounds = valid.slice();
    outOfBounds[20] = 1;
    rejects(outOfBounds);
  });

  test("enforces each resource limit", () => {
    rejects(new Uint8Array(UPLOAD_LIMITS.bytes + 1), "too_large");
    rejects(gifFixture(1, 1921, 1), "dimensions");
    rejects(gifFixture(1, 1, 1921), "dimensions");
    rejects(gifFixture(501), "frames");
    rejects(gifFixture(28, 1920, 1920), "pixels");
  });

  test("accepts real msf_gif output, palette changes, and very slow frames", async () => {
    const wasm = await Bun.file(new URL("../../public/js/msf-gif.wasm", import.meta.url))
      .arrayBuffer();
    const encoder = await createGifEncoder(wasm, 320, 240);
    const pixels = new Uint8ClampedArray(320 * 240 * 4);
    for (let frame = 0; frame < 6; frame++) {
      for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 17 + frame * 31) % 256;
      encoder.addFrame(pixels, 655_350);
    }
    expect(validateGif(encoder.finish())).toEqual({ width: 320, height: 240, frames: 6 });
  });

  test("validates noisy output through LZW dictionary growth and resets", async () => {
    const wasm = await Bun.file(new URL("../../public/js/msf-gif.wasm", import.meta.url))
      .arrayBuffer();
    const encoder = await createGifEncoder(wasm, 320, 240);
    const pixels = new Uint8ClampedArray(320 * 240 * 4);
    let seed = 123;
    for (let frame = 0; frame < 3; frame++) {
      for (let i = 0; i < pixels.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels[i] = seed >>> 24;
      }
      encoder.addFrame(pixels, 20);
    }
    expect(validateGif(encoder.finish()).frames).toBe(3);
  });
});
