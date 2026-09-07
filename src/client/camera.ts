import { element } from "./dom";

export interface CameraPreview {
  capture(): Promise<HTMLImageElement>;
  requestAccess(): Promise<void>;
}

export interface CameraCallbacks {
  waiting(): void;
  started(): void;
  failed(error: unknown): void;
}

export function createCameraPreview(
  width: number,
  height: number,
  container: Node,
  callbacks: CameraCallbacks,
): CameraPreview {
  const video = element(
    "video",
    { width, height, autoplay: true, muted: true, hidden: true },
    container,
  );
  video.playsInline = true;

  const canvas = element(
    "canvas",
    { width, height, className: "cam-preview" },
    container,
  );
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The browser does not support a 2D canvas context");
  }

  context.translate(width, 0);
  context.scale(-1, 1);

  let drawing = false;
  let started = false;
  let accessRequest: Promise<void> | null = null;

  const draw = (): void => {
    window.requestAnimationFrame(draw);
    if (!started && video.videoWidth > 0) {
      started = true;
      callbacks.started();
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      context.drawImage(video, 0, 0, width, height);
    }
  };

  video.addEventListener("loadeddata", () => {
    if (!drawing) {
      drawing = true;
      draw();
    }
  });

  async function openCamera(): Promise<void> {
    callbacks.waiting();
    let stream: MediaStream | undefined;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not supported by this browser");
      }

      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      callbacks.failed(error);
    }
  }

  function requestAccess(): Promise<void> {
    accessRequest ??= openCamera().finally(() => {
      accessRequest = null;
    });
    return accessRequest;
  }

  async function capture(): Promise<HTMLImageElement> {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("Could not capture camera frame")), {
        once: true,
      });
    });
    image.src = canvas.toDataURL("image/png");
    await loaded;
    return image;
  }

  return { capture, requestAccess };
}
