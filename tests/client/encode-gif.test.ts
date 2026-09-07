import { afterEach, describe, expect, test } from "bun:test";
import { encodeGif } from "../../src/client/encode-gif";
import type { EncoderRequest, EncoderResponse } from "../../src/client/encoder-protocol";

const originalWorker = globalThis.Worker;
class FakeWorker {
  static latest: FakeWorker;
  terminated = false;
  requests: EncoderRequest[] = [];
  onmessage: ((event: { data: EncoderResponse; }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void; }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    FakeWorker.latest = this;
  }
  postMessage(message: EncoderRequest): void {
    this.requests.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  receive(data: EncoderResponse): void {
    this.onmessage?.({ data });
  }
}

afterEach(() => {
  globalThis.Worker = originalWorker;
});

function setup() {
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const progress: number[] = [];
  const blobs: Blob[] = [];
  const errors: Error[] = [];
  const pixels = new Uint8ClampedArray(16);
  const cancel = encodeGif([pixels, pixels], 2, 2, 400, {
    progress: (value) => progress.push(value),
    finished: (blob) => blobs.push(blob),
    error: (error) => errors.push(error),
  });
  return { worker: FakeWorker.latest, progress, blobs, errors, cancel, pixels };
}

describe("GIF worker lifecycle", () => {
  test("sends copies one at a time and terminates after completion", () => {
    const { worker, progress, blobs, errors, pixels } = setup();
    expect(worker.requests).toEqual([{ type: "start", width: 2, height: 2, count: 2, delay: 400 }]);
    worker.receive({ type: "ready" });
    expect(worker.requests.length).toBe(2);
    const frame = worker.requests[1];
    if (frame?.type !== "frame") throw new Error("Missing frame");
    expect(frame.pixels).not.toBe(pixels);
    worker.receive({ type: "progress", value: 0.5 });
    worker.receive({ type: "ready" });
    worker.receive({ type: "progress", value: 1 });
    worker.receive({ type: "finished", bytes: new Uint8Array([71, 73, 70]) });
    expect(progress).toEqual([0.5, 1]);
    expect(blobs[0]?.type).toBe("image/gif");
    expect(worker.terminated).toBe(true);
    expect(errors).toEqual([]);
  });

  test("cancellation ignores queued messages and does not emit completion", () => {
    const { worker, progress, blobs, errors, cancel } = setup();
    cancel();
    cancel();
    worker.receive({ type: "ready" });
    worker.receive({ type: "progress", value: 1 });
    worker.receive({ type: "finished", bytes: new Uint8Array() });
    worker.receive({ type: "error", message: "stale" });
    expect(worker.terminated).toBe(true);
    expect(worker.requests.length).toBe(1);
    expect([progress, blobs, errors]).toEqual([[], [], []]);
  });

  test("native, loading and message failures terminate the worker", () => {
    for (const mode of ["native", "load", "message"]) {
      const { worker, errors } = setup();
      if (mode === "native") worker.receive({ type: "error", message: "native failed" });
      if (mode === "load") worker.onerror?.({ message: "load failed", preventDefault() {} });
      if (mode === "message") worker.onmessageerror?.();
      expect(worker.terminated).toBe(true);
      expect(errors.length).toBe(1);
    }
  });
});
