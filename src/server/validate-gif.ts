import { UPLOAD_LIMITS, UploadError } from "../shared/upload-policy";

function invalid(): never {
  throw new UploadError("invalid");
}

// Validate LZW without allocating decoded images. Dictionary entries retain their
// expanded length and largest palette index, enough to check every output pixel.
function validateLzw(data: Uint8Array, minimum: number, pixels: number, colors: number): void {
  if (minimum < 2 || minimum > 8) invalid();
  const clear = 1 << minimum;
  const end = clear + 1;
  const lengths = new Uint32Array(4096);
  const maximums = new Uint16Array(4096);
  const firsts = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) {
    lengths[i] = 1;
    maximums[i] = firsts[i] = i;
  }
  let size = minimum + 1;
  let next = end + 1;
  let previous = -1;
  let bit = 0;
  let output = 0;
  let initial = true;
  while (bit + size <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) {
      code |= ((data[bit >>> 3]! >>> (bit & 7)) & 1) << i;
    }
    if (initial && code !== clear) invalid();
    initial = false;
    if (code === clear) {
      size = minimum + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) {
      if (output !== pixels || Math.ceil(bit / 8) !== data.length) invalid();
      return;
    }
    if (code > next || (code === next && previous < 0) || code >= 4096) invalid();
    const special = code === next;
    const length = special ? lengths[previous]! + 1 : lengths[code]!;
    const first = special ? firsts[previous]! : firsts[code]!;
    const maximum = special ? maximums[previous]! : maximums[code]!;
    if (!length || maximum >= colors) invalid();
    output += length;
    if (output > pixels) invalid();
    if (previous >= 0 && next < 4096) {
      lengths[next] = lengths[previous]! + 1;
      firsts[next] = firsts[previous]!;
      maximums[next] = Math.max(maximums[previous]!, first);
      next++;
      if (next === (1 << size) && size < 12) size++;
    }
    previous = code;
  }
  invalid();
}

export function validateGif(data: Uint8Array): { width: number; height: number; frames: number; } {
  if (data.length > UPLOAD_LIMITS.bytes) throw new UploadError("too_large");
  let position = 0;
  const take = (size: number): Uint8Array => {
    if (position + size > data.length) invalid();
    const result = data.subarray(position, position + size);
    position += size;
    return result;
  };
  const byte = (): number => take(1)[0]!;
  const word = (): number => byte() | (byte() << 8);
  const blocks = (): Uint8Array => {
    const start = position;
    let length = 0;
    for (let size = byte(); size; size = byte()) {
      take(size);
      length += size;
    }
    const result = new Uint8Array(length);
    let offset = 0;
    let cursor = start;
    for (let size = data[cursor++]!; size; size = data[cursor++]!) {
      result.set(data.subarray(cursor, cursor + size), offset);
      cursor += size;
      offset += size;
    }
    return result;
  };
  const palette = (flags: number): number => {
    if (!(flags & 128)) return 0;
    const colors = 1 << ((flags & 7) + 1);
    take(colors * 3);
    return colors;
  };
  const signature = new TextDecoder().decode(take(6));
  if (signature !== "GIF87a" && signature !== "GIF89a") invalid();
  const width = word();
  const height = word();
  if (!width || !height) invalid();
  if (width > UPLOAD_LIMITS.width || height > UPLOAD_LIMITS.height) {
    throw new UploadError("dimensions");
  }
  const flags = byte();
  const background = byte();
  byte(); // Pixel aspect ratio.
  const globalColors = palette(flags);
  if (globalColors && background >= globalColors) invalid();
  let frames = 0;
  let transparency = -1;
  let pendingControl = false;
  while (position < data.length) {
    const marker = byte();
    if (marker === 0x3b) {
      if (!frames || pendingControl || position !== data.length) invalid();
      return { width, height, frames };
    }
    if (marker === 0x21) {
      const type = byte();
      if (type === 0xf9) {
        if (pendingControl || byte() !== 4) invalid();
        const control = byte();
        if ((control & 0xe0) || ((control >>> 2) & 7) > 3) invalid();
        word(); // Delay is intentionally unrestricted.
        const index = byte();
        transparency = control & 1 ? index : -1;
        if (byte() !== 0) invalid();
        pendingControl = true;
      } else if (type === 0xff) {
        if (byte() !== 11) invalid();
        take(11);
        blocks();
      } else if (type === 0xfe) {
        blocks();
      } else {
        // Plain-text rendering and unknown extensions are not supported uploads.
        invalid();
      }
      continue;
    }
    if (marker !== 0x2c) invalid();
    const left = word();
    const top = word();
    const frameWidth = word();
    const frameHeight = word();
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) {
      invalid();
    }
    frames++;
    if (frames > UPLOAD_LIMITS.frames) throw new UploadError("frames");
    // Bound full composited frames, even when the encoded rectangles are tiny.
    if (width * height * frames > UPLOAD_LIMITS.pixels) throw new UploadError("pixels");
    const frameFlags = byte();
    if (frameFlags & 0x18) invalid();
    const colors = palette(frameFlags) || globalColors;
    if (!colors || transparency >= colors) invalid();
    const minimum = byte();
    validateLzw(blocks(), minimum, frameWidth * frameHeight, colors);
    transparency = -1;
    pendingControl = false;
  }
  return invalid();
}
