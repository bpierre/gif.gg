import type { EncoderRequest, EncoderResponse } from "./encoder-protocol";

interface RenderCallbacks {
  progress(value: number): void;
  finished(blob: Blob): void;
  error(error: Error): void;
}

// One worker per render. Cancellation also interrupts synchronous native encoding.
export function encodeGif(
  frames: readonly Uint8ClampedArray[],
  width: number,
  height: number,
  delay: number,
  callbacks: RenderCallbacks,
  workerScript = "/js/gif-worker.js",
): () => void {
  const worker = new Worker(workerScript, { type: "module" });
  let stopped = false;
  let next = 0;
  const stop = (): void => {
    stopped = true;
    worker.terminate();
  };
  const fail = (error: Error): void => {
    if (stopped) return;
    stop();
    callbacks.error(error);
  };
  const post = (message: EncoderRequest, transfer: Transferable[] = []): void => {
    worker.postMessage(message, transfer);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    fail(new Error(event.message || "GIF worker failed"));
  };
  worker.onmessageerror = () => fail(new Error("Could not read GIF worker response"));
  worker.onmessage = ({ data }: MessageEvent<EncoderResponse>) => {
    if (stopped) return;
    try {
      switch (data.type) {
        case "ready": {
          const source = frames[next++];
          if (!source) throw new Error("Unexpected GIF frame request");
          // Retain originals for speed changes; transfer just one copy at a time.
          const pixels = source.slice();
          post({ type: "frame", pixels }, [pixels.buffer]);
          break;
        }
        case "progress":
          callbacks.progress(data.value);
          break;
        case "finished":
          stop();
          callbacks.finished(new Blob([data.bytes], { type: "image/gif" }));
          break;
        case "error":
          fail(new Error(data.message));
          break;
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error("GIF encoding failed"));
    }
  };
  try {
    post({ type: "start", width, height, count: frames.length, delay });
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
