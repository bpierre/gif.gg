import { expect, test } from "bun:test";
import {
  canRetryUpload,
  UPLOAD_ERRORS,
  type UploadErrorCode,
} from "../../src/shared/upload-policy";

test("only temporary upload failures offer retry", () => {
  for (const code of Object.keys(UPLOAD_ERRORS) as UploadErrorCode[]) {
    expect(canRetryUpload(code)).toBe(["busy", "internal", "network", "timeout"].includes(code));
  }
});

test("error copy uses GIF terminology and plain punctuation", () => {
  for (const message of Object.values(UPLOAD_ERRORS)) {
    expect(message).not.toMatch(/[—–×]|photos/i);
  }
});

test("unexpected validation failures share a generic user-facing message", () => {
  for (const code of ["invalid", "dimensions", "frames", "pixels"] as const) {
    expect(UPLOAD_ERRORS[code]).toBe("Something went wrong. Please reset and try again.");
  }
  expect(UPLOAD_ERRORS.too_large).toContain("10 MiB");
});
