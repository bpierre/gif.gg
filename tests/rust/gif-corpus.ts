import { resolve } from "node:path";
import { createGifEncoder } from "../../src/client/msf-gif";
import { UPLOAD_LIMITS } from "../../src/shared/upload-policy";
import { gifFixture } from "./gif-fixture";

export async function gifCorpus(): Promise<Uint8Array<ArrayBuffer>[]> {
  const project = resolve(import.meta.dir, "../..");
  const corpus: Uint8Array<ArrayBuffer>[] = [];
  const valid = gifFixture();
  for (let end = 0; end <= valid.length; end++) corpus.push(valid.slice(0, end));
  for (let position = 0; position < valid.length; position++) {
    for (let value = 0; value < 256; value++) {
      const bytes = valid.slice();
      bytes[position] = value;
      corpus.push(bytes);
    }
  }
  corpus.push(
    gifFixture(500),
    gifFixture(501),
    gifFixture(27, 1920, 1920),
    gifFixture(28, 1920, 1920),
    new Uint8Array(UPLOAD_LIMITS.bytes + 1),
  );
  // Legal and malformed extension/control combinations, local palettes,
  // interlacing, trailer handling, and palette/transparency bounds.
  const extensions = [
    [0x21, 0xfe, 3, 65, 66, 67, 0],
    [0x21, 0xff, 11, ...new TextEncoder().encode("NETSCAPE2.0"), 3, 1, 0, 0, 0],
    [0x21, 0xf9, 4, 1, 255, 255, 1, 0],
    [0x21, 0xf9, 4, 1, 0, 0, 2, 0],
    [0x21, 0xf9, 4, 16, 0, 0, 0, 0],
    [0x21, 1, 0],
  ];
  for (const extension of extensions) {
    corpus.push(new Uint8Array([...valid.slice(0, 19), ...extension, ...valid.slice(19)]));
    corpus.push(
      new Uint8Array([...valid.slice(0, 19), ...extension, ...extension, ...valid.slice(19)]),
    );
    corpus.push(new Uint8Array([...valid.slice(0, -1), ...extension, 0x3b]));
  }
  const wasm = await Bun.file(resolve(project, "public/js/msf-gif.wasm")).arrayBuffer();
  const encoder = await createGifEncoder(wasm, 320, 240);
  let seed = 123;
  const random = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  for (let frame = 0; frame < 3; frame++) {
    const pixels = new Uint8ClampedArray(320 * 240 * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = random() >>> 24;
    encoder.addFrame(pixels, frame === 2 ? 655_350 : 20);
  }
  const noisy = encoder.finish();
  corpus.push(noisy);
  for (let i = 0; i < 100; i++) {
    const bytes = noisy.slice();
    bytes[random() % bytes.length] = random() >>> 24;
    corpus.push(bytes);
    corpus.push(noisy.slice(0, random() % noisy.length));
  }
  return corpus;
}
