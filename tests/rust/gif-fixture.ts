// One black pixel: clear code, palette index 0, end code.
export function gifFixture(frames = 1, width = 1, height = 1): Uint8Array<ArrayBuffer> {
  const header = [
    71,
    73,
    70,
    56,
    57,
    97,
    width & 255,
    width >> 8,
    height & 255,
    height >> 8,
    128,
    0,
    0,
    0,
    0,
    0,
    255,
    255,
    255,
  ];
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0];
  return new Uint8Array([...header, ...Array.from({ length: frames }, () => frame).flat(), 0x3b]);
}
