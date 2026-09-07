import { maximumCaptureFrames } from "./capture-limits";
import { element } from "./dom";
import { encodeGif } from "./encode-gif";

interface GifMakerEvents {
  abort: undefined;
  finished: undefined;
  progress: number;
  start: undefined;
  error: Error;
}

type GifMakerEvent = keyof GifMakerEvents;
type Listener<Event extends GifMakerEvent> = (value: GifMakerEvents[Event]) => void;

export interface GifMaker {
  readonly emptyPreview: HTMLDivElement;
  addFrame(image: HTMLImageElement): void;
  blob(): Blob | null;
  delay(milliseconds: number): void;
  frames(): readonly Uint8ClampedArray[];
  on<Event extends GifMakerEvent>(event: Event, listener: Listener<Event>): void;
  reset(): void;
}

export function createGifMaker(
  width: number,
  height: number,
  container: Node,
  workerScript = "/js/gif-worker.js",
): GifMaker {
  const listeners: { [Event in GifMakerEvent]: Array<Listener<Event>>; } = {
    abort: [],
    finished: [],
    progress: [],
    start: [],
    error: [],
  };
  const preview = element("img", { className: "gif-preview", hidden: true }, container);
  const emptyPreview = element("div", { className: "gif-preview empty" }, container);
  let currentPreview = preview;
  let frameDelay = 500;
  let renderedBlob: Blob | null = null;
  let lastObjectUrl: string | null = null;
  let frames: Uint8ClampedArray[] = [];
  let cancelRender: (() => void) | null = null;
  let revision = 0;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable");

  function emit<Event extends GifMakerEvent>(event: Event, value: GifMakerEvents[Event]): void {
    for (const listener of listeners[event]) {
      listener(value);
    }
  }

  function updatePreview(source: string): void {
    const expectedRevision = revision;
    const nextPreview = new Image();
    nextPreview.className = "gif-preview";
    nextPreview.addEventListener("load", () => {
      if (expectedRevision !== revision) return;
      container.replaceChild(nextPreview, currentPreview);
      currentPreview = nextPreview;
    }, { once: true });
    nextPreview.src = source;
  }

  function finished(blob: Blob): void {
    renderedBlob = blob;
    if (lastObjectUrl) {
      URL.revokeObjectURL(lastObjectUrl);
    }
    lastObjectUrl = URL.createObjectURL(blob);
    updatePreview(lastObjectUrl);
    emit("finished", undefined);
  }

  function abort(): void {
    revision++;
    if (!cancelRender) return;
    cancelRender();
    cancelRender = null;
    emit("abort", undefined);
  }

  function render(): void {
    abort();
    renderedBlob = null;
    if (!frames.length) return;
    const expectedRevision = revision;
    emit("start", undefined);
    emit("progress", 0);
    const failed = (error: Error): void => {
      if (expectedRevision !== revision) return;
      cancelRender = null;
      emit("error", error);
    };
    try {
      cancelRender = encodeGif(frames, width, height, frameDelay, {
        progress(value) {
          if (expectedRevision === revision) emit("progress", value);
        },
        finished(blob) {
          if (expectedRevision !== revision) return;
          cancelRender = null;
          finished(blob);
        },
        error: failed,
      }, workerScript);
    } catch (error) {
      failed(error instanceof Error ? error : new Error("GIF encoding failed"));
    }
  }

  preview.width = width;
  preview.height = height;

  return {
    emptyPreview,
    addFrame(image) {
      if (frames.length >= maximumCaptureFrames(width, height)) return;
      currentPreview.hidden = false;
      emptyPreview.hidden = true;
      context.drawImage(image, 0, 0, width, height);
      frames.push(context.getImageData(0, 0, width, height).data);
      render();
    },
    blob() {
      return renderedBlob;
    },
    delay(milliseconds) {
      frameDelay = milliseconds;
      render();
    },
    frames() {
      return frames;
    },
    on(event, listener) {
      listeners[event].push(listener);
    },
    reset() {
      currentPreview.src = "";
      currentPreview.hidden = true;
      emptyPreview.hidden = false;
      abort();
      if (lastObjectUrl) {
        URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
      }
      renderedBlob = null;
      frames = [];
    },
  };
}
