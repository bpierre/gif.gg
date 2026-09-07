import { expect, test } from "bun:test";
import { maximumCaptureFrames, nextFrameExceedsSizeLimit } from "../../src/client/capture-limits";
import { UPLOAD_LIMITS } from "../../src/shared/upload-policy";

test("capture cap accounts for both frames and decoded pixels", () => {
  expect(maximumCaptureFrames(320, 240)).toBe(500);
  expect(maximumCaptureFrames(1920, 1920)).toBe(27);
  expect(maximumCaptureFrames(1, 1)).toBe(500);
  for (const width of [0, -1, 1921, NaN, 1.5]) {
    expect(maximumCaptureFrames(width, 240)).toBe(0);
  }
});

test("reserves three average frames before allowing another capture", () => {
  expect(nextFrameExceedsSizeLimit(0, 0)).toBe(false);
  expect(nextFrameExceedsSizeLimit(1000, 10, 1300)).toBe(false);
  expect(nextFrameExceedsSizeLimit(1000, 10, 1299)).toBe(true);
  expect(nextFrameExceedsSizeLimit(1000, 1, 3999)).toBe(true);
  expect(nextFrameExceedsSizeLimit(1000, 1, 4000)).toBe(false);
  expect(nextFrameExceedsSizeLimit(UPLOAD_LIMITS.bytes, 500)).toBe(true);
  expect(nextFrameExceedsSizeLimit(900, 9, 1299)).toBe(false);
});
