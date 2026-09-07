import { UPLOAD_LIMITS, type UploadErrorCode, uploadErrorCode } from "../shared/upload-policy";
import { createCameraPreview } from "./camera";
import { maximumCaptureFrames, nextFrameExceedsSizeLimit } from "./capture-limits";
import { button, element, insertAfter, slider, type Timer, timer } from "./dom";
import { createGifMaker } from "./gif-maker";
import { createPreviewError } from "./preview-error";
import { createProgress } from "./progress";

const WIDTH = 320;
const HEIGHT = 240;
const MAXIMUM_CAPTURE_FRAMES = maximumCaptureFrames(WIDTH, HEIGHT);
const MAXIMUM_CAPTURE_BYTES = UPLOAD_LIMITS.bytes;
const INITIAL_DELAY = 400;
const MINIMUM_DELAY = 20;
const MAXIMUM_DELAY = 1_000;

const body = document.body;
const firstElement = body.firstElementChild;
if (!firstElement) {
  throw new Error("Expected the page heading to exist");
}

const main = insertAfter(body, element("div", { id: "main" }), firstElement);
const progress = createProgress(100, body);
const appElement = element("div", { className: "app", hidden: true }, main);
const screens = element("div", { className: "screens" }, appElement);
const errorPlayground = body.dataset.development === "true"
  && new URLSearchParams(location.search).has("upload-errors");
const previewError = createPreviewError(screens, resetCapture, () => {
  if (errorPlayground) {
    previewError.hide();
  } else {
    save();
  }
});
const startElement = element("div", { className: "start" }, main);
const startMessage = element("p", { textContent: "please allow access to your camera" });
startElement.appendChild(startMessage);

const gifMaker = createGifMaker(WIDTH, HEIGHT, screens);
const camera = createCameraPreview(WIDTH, HEIGHT, screens, {
  waiting() {
    progress.value(false);
    progress.show("Waiting for the camera…");
  },
  started() {
    progress.hide();
    startElement.hidden = true;
    appElement.hidden = false;
  },
  failed(error) {
    progress.hide();
    startElement.hidden = false;
    appElement.hidden = true;
    startMessage.className = "unsupported";
    startMessage.textContent = error instanceof DOMException && error.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access in your browser, then try again."
      : "Camera access is unavailable. Make sure a camera is connected and this page uses HTTPS or localhost.";
  },
});

button("begin capture", () => void camera.requestAccess(), startElement);
if (errorPlayground) {
  startElement.hidden = true;
  appElement.hidden = false;
} else {
  void camera.requestAccess();
}

const controls = element("div", { className: "controls" }, appElement);
const shotButtonContainer = element("div", { className: "shot-button" }, controls);
let currentTimer: Timer | null = null;
let uploading = false;
let capturing = false;
let rendering = false;
let captureRevision = 0;
const captureLimitMessage = element("p", {
  className: "capture-limit",
  textContent: `${MAXIMUM_CAPTURE_FRAMES}-frame limit reached.`,
  hidden: true,
}, shotButtonContainer);
captureLimitMessage.setAttribute("role", "status");

function atCaptureSizeLimit(): boolean {
  return nextFrameExceedsSizeLimit(
    gifMaker.blob()?.size ?? 0,
    gifMaker.frames().length,
    MAXIMUM_CAPTURE_BYTES,
  );
}

function updateCaptureControls(): void {
  const atLimit = gifMaker.frames().length >= MAXIMUM_CAPTURE_FRAMES;
  const atSizeLimit = atCaptureSizeLimit();
  shotButton.disabled = uploading || capturing || rendering || atLimit || atSizeLimit;
  captureLimitMessage.textContent = atSizeLimit
    ? "GIF size limit reached."
    : `${MAXIMUM_CAPTURE_FRAMES}-frame limit reached.`;
  captureLimitMessage.hidden = !atLimit && !atSizeLimit;
}

const selfTimer = slider(
  0,
  0,
  10,
  1,
  shotButtonContainer,
  (control) => {
    currentTimer?.cancel();
    control.text.textContent = "Delay";
  },
);

const timerOverlay = (() => {
  const overlay = element("div", { className: "timer-on-preview", hidden: true }, appElement);
  return {
    show(text: string | number, cssClass?: string): void {
      overlay.textContent = String(text);
      overlay.hidden = false;
      if (cssClass) overlay.classList.add(cssClass);
      window.setTimeout(() => {
        overlay.hidden = true;
        if (cssClass) overlay.classList.remove(cssClass);
      }, 50);
    },
  };
})();

let shotButton: HTMLButtonElement;
const takeShot = (): void => {
  if (uploading || capturing || rendering || gifMaker.frames().length >= MAXIMUM_CAPTURE_FRAMES) {
    return;
  }
  if (atCaptureSizeLimit()) return;
  capturing = true;
  const expectedRevision = ++captureRevision;
  const label = shotButton.textContent;
  const resetUi = (): void => {
    if (expectedRevision !== captureRevision) return;
    capturing = false;
    shotButton.textContent = label;
    updateCaptureControls();
  };

  shotButton.style.width = `${shotButton.getBoundingClientRect().width}px`;
  shotButton.disabled = true;
  currentTimer = timer(
    selfTimer.value(),
    (remaining) => {
      timerOverlay.show(remaining);
      shotButton.textContent = String(remaining);
    },
    () => {
      timerOverlay.show("!", "photo");
      void camera.capture()
        .then((image) => {
          if (expectedRevision === captureRevision && !uploading) gifMaker.addFrame(image);
        })
        .catch(() => window.alert("The camera frame could not be captured. Please try again."))
        .finally(resetUi);
    },
    () => {
      if (expectedRevision !== captureRevision) return;
      resetUi();
      captureRevision++;
    },
  );
};

shotButton = button("Photo", takeShot, shotButtonContainer);
document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !shotButton.disabled) {
    event.preventDefault();
    takeShot();
  }
});

const delaySlider = slider(
  INITIAL_DELAY,
  MINIMUM_DELAY,
  MAXIMUM_DELAY,
  10,
  controls,
  (_control, _input, delay) => gifMaker.delay(delay),
  true,
);
delaySlider.label.className = "gif-delay";
delaySlider.text.textContent = "gif speed";
delaySlider.label.append(
  element("span", { className: "min", textContent: "Slow" }),
  element("span", { className: "max", textContent: "Fast" }),
);

gifMaker.emptyPreview.innerHTML = "← you, probably<br>↙ take photos<br>change speed ↓";

let saveButton: HTMLButtonElement;
let resetButton: HTMLButtonElement;

gifMaker.on("start", () => {
  rendering = true;
  updateCaptureControls();
  previewError.hide();
  saveButton.disabled = true;
  resetButton.disabled = false;
  progress.show("rendering…");
});
const renderEnded = (): void => {
  rendering = false;
  saveButton.disabled = !gifMaker.blob();
  resetButton.disabled = gifMaker.frames().length === 0;
  updateCaptureControls();
  progress.hide();
};
gifMaker.on("abort", renderEnded);
gifMaker.on("finished", renderEnded);
gifMaker.on("progress", (value) => progress.value(value * 100));
gifMaker.on("error", () => {
  renderEnded();
  previewError.show("render");
});

const bottomControls = element("div", { className: "bottom-controls" }, controls);

function save(): void {
  if (uploading) return;
  if (
    gifMaker.frames().length < 2
    && !window.confirm("To make an animation, you need to add another image. Save anyway?")
  ) {
    return;
  }

  const blob = gifMaker.blob();
  if (!blob) return;
  previewError.hide();

  const form = new FormData();
  const request = new XMLHttpRequest();
  form.append("gif", blob);
  request.open("POST", "/", true);
  request.timeout = 60_000;
  const failed = (code: UploadErrorCode): void => {
    uploading = false;
    progress.hide();
    restoreControls();
    previewError.show(code);
  };
  request.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) {
      progress.value(event.loaded / event.total * 100);
    }
  });
  request.addEventListener("load", () => {
    progress.hide();
    if (request.status === 200 && /^\/[0-9A-Za-z]+$/.test(request.responseText)) {
      window.location.assign(request.responseText);
      return;
    }
    let code: UploadErrorCode = request.status === 413 ? "too_large" : "internal";
    try {
      code = uploadErrorCode(JSON.parse(request.responseText).error);
    } catch {
      // Includes non-JSON responses from the reverse proxy.
    }
    failed(code);
  });
  request.addEventListener("error", () => {
    failed("network");
  });
  request.addEventListener("timeout", () => failed("timeout"));
  request.addEventListener("abort", () => failed("network"));
  uploading = true;
  currentTimer?.cancel();
  progress.show("saving…");
  saveButton.disabled = true;
  resetButton.disabled = true;
  shotButton.disabled = true;
  delaySlider.input.disabled = true;
  try {
    request.send(form);
  } catch {
    failed("network");
  }
}

function restoreControls(): void {
  saveButton.disabled = !gifMaker.blob();
  resetButton.disabled = gifMaker.frames().length === 0;
  updateCaptureControls();
  delaySlider.input.disabled = false;
}

function resetCapture(): void {
  if (uploading) return;
  previewError.hide();
  gifMaker.reset();
  saveButton.disabled = true;
  resetButton.disabled = true;
  currentTimer?.cancel();
  updateCaptureControls();
  shotButton.focus();
}

saveButton = button("save", save, bottomControls);
saveButton.disabled = true;

resetButton = button("reset", resetCapture, bottomControls);
resetButton.disabled = true;

if (errorPlayground) {
  const playground = element("section", { className: "error-playground" }, main);
  element(
    "p",
    { textContent: "Development only: preview errors. No uploads are sent." },
    playground,
  );
  const examples = [
    ["unexpected error", "invalid"],
    ["too large", "too_large"],
    ["save failed", "internal"],
    ["render failed", "render"],
  ] as const;
  for (const [label, code] of examples) {
    button(label, () => previewError.show(code), playground);
  }
  previewError.show("too_large");
}
