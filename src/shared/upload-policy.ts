export const UPLOAD_LIMITS = {
  bytes: 10 * 1024 * 1024,
  width: 1920,
  height: 1920,
  frames: 500,
  pixels: 100_000_000,
} as const;

// Allow multipart headers in addition to the file, but bound the entire request.
export const MAX_UPLOAD_BODY_BYTES = UPLOAD_LIMITS.bytes + 64 * 1024;

const UNEXPECTED_GIF_ERROR = "Something went wrong. Please reset and try again.";

export const UPLOAD_ERRORS = {
  invalid: UNEXPECTED_GIF_ERROR,
  too_large: "This GIF is larger than 10 MiB. Reset to make a smaller one.",
  dimensions: UNEXPECTED_GIF_ERROR,
  frames: UNEXPECTED_GIF_ERROR,
  pixels: UNEXPECTED_GIF_ERROR,
  busy: "The server is busy. Try again shortly.",
  internal: "We could not save your GIF. Try again.",
  network: "The connection was interrupted. Check your connection and try again.",
  timeout: "Saving took too long. Try again.",
  render: "Your GIF could not be rendered. Reset to make a new one.",
} as const;

export type UploadErrorCode = keyof typeof UPLOAD_ERRORS;

export function canRetryUpload(code: UploadErrorCode): boolean {
  return code === "busy" || code === "internal" || code === "network" || code === "timeout";
}

export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode) {
    super(UPLOAD_ERRORS[code]);
  }
}

export function uploadErrorCode(value: unknown): UploadErrorCode {
  return typeof value === "string" && Object.hasOwn(UPLOAD_ERRORS, value)
    ? value as UploadErrorCode
    : "internal";
}
