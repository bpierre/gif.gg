import type { EncoderRequest, EncoderResponse } from "./encoder-protocol";
import { createGifEncoder, type GifEncoder } from "./msf-gif";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<EncoderRequest>) => void) | null;
  postMessage(message: EncoderResponse, transfer?: Transferable[]): void;
};
let encoder: GifEncoder | undefined;
let started = false;
let count = 0;
let completed = 0;
let delay = 0;

async function receive(message: EncoderRequest): Promise<void> {
  try {
    if (message.type === "start") {
      if (started) throw new Error("Encoder already started");
      started = true;
      if (!Number.isSafeInteger(message.count) || message.count < 1) {
        throw new Error("No GIF frames to encode");
      }
      count = message.count;
      delay = message.delay;
      const response = await fetch("/js/msf-gif.wasm");
      if (!response.ok) throw new Error("Could not load the GIF encoder");
      encoder = await createGifEncoder(await response.arrayBuffer(), message.width, message.height);
      scope.postMessage({ type: "ready" });
    } else {
      if (!encoder || completed >= count) throw new Error("Unexpected GIF frame");
      encoder.addFrame(message.pixels, delay);
      completed++;
      scope.postMessage({ type: "progress", value: completed / count });
      if (completed === count) {
        const bytes = encoder.finish();
        scope.postMessage({ type: "finished", bytes }, [bytes.buffer]);
      } else {
        scope.postMessage({ type: "ready" });
      }
    }
  } catch (error) {
    encoder?.dispose();
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "GIF encoding failed",
    });
  }
}

scope.onmessage = (event) => void receive(event.data);
