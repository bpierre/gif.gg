export type EncoderRequest =
  | { type: "start"; width: number; height: number; count: number; delay: number; }
  | { type: "frame"; pixels: Uint8ClampedArray<ArrayBuffer>; };

export type EncoderResponse =
  | { type: "ready"; }
  | { type: "progress"; value: number; }
  | { type: "finished"; bytes: Uint8Array<ArrayBuffer>; }
  | { type: "error"; message: string; };
