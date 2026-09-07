import { UPLOAD_LIMITS } from "../shared/upload-policy";

export function maximumCaptureFrames(width: number, height: number): number {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > UPLOAD_LIMITS.width || height > UPLOAD_LIMITS.height
  ) return 0;
  return Math.min(UPLOAD_LIMITS.frames, Math.floor(UPLOAD_LIMITS.pixels / (width * height)));
}

export function nextFrameExceedsSizeLimit(
  currentBytes: number,
  frameCount: number,
  maximumBytes: number = UPLOAD_LIMITS.bytes,
): boolean {
  if (frameCount <= 0) return false;
  return currentBytes + 3 * (currentBytes / frameCount) > maximumBytes;
}
