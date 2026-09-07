import { canRetryUpload, UPLOAD_ERRORS, type UploadErrorCode } from "../shared/upload-policy";
import { button, element } from "./dom";

export function createPreviewError(
  screens: HTMLElement,
  reset: () => void,
  retry: () => void,
) {
  const panel = element(
    "section",
    { className: "preview-error", hidden: true },
    screens,
  );
  panel.setAttribute("role", "alert");
  panel.setAttribute("aria-labelledby", "preview-error-title");
  panel.setAttribute("aria-describedby", "preview-error-message");
  element("h2", { id: "preview-error-title", textContent: "Could not save your GIF" }, panel);
  const message = element("p", { id: "preview-error-message" }, panel);
  const actions = element("div", { className: "preview-error-actions" }, panel);
  const retryButton = button("retry save", retry, actions);
  const resetButton = button("reset", reset, actions);
  return {
    show(
      code: UploadErrorCode,
      text: string = UPLOAD_ERRORS[code],
      title = code === "render" ? "Could not render your GIF" : "Could not save your GIF",
    ) {
      retryButton.hidden = !canRetryUpload(code);
      resetButton.hidden = canRetryUpload(code);
      message.textContent = text;
      panel.querySelector("h2")!.textContent = title;
      screens.classList.add("has-error");
      panel.hidden = false;
    },
    hide() {
      panel.hidden = true;
      screens.classList.remove("has-error");
    },
  };
}
