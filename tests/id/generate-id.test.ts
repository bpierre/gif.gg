import { expect, test } from "bun:test";
import { generateId } from "../../src/id/generate-id";

test("excludes the legacy out-of-range draw and retains all seven characters", () => {
  const bounds: number[][] = [];
  expect(generateId({
    randomInteger(min, max) {
      bounds.push([min, max]);
      return max;
    },
    idExists: () => false,
  })).toBe("0000000");
  expect(bounds).toEqual(Array.from({ length: 7 }, () => [0, 61]));
});

test("retains the legacy alphabet order", () => {
  const draws = [0, 25, 26, 51, 52, 60, 61];
  expect(generateId({ randomInteger: () => draws.shift()!, idExists: () => false })).toBe(
    "azAZ190",
  );
});

test("retries colliding IDs", () => {
  let draw = 0;
  const checked: string[] = [];
  const id = generateId({
    randomInteger: () => Math.floor(draw++ / 7),
    idExists(candidate) {
      checked.push(candidate);
      return candidate === "aaaaaaa";
    },
  });
  expect(id).toBe("bbbbbbb");
  expect(checked).toEqual(["aaaaaaa", "bbbbbbb"]);
});

test("fails instead of shortening IDs when an injected random source is invalid", () => {
  for (const value of [-1, 62, 0.5, NaN]) {
    expect(() => generateId({ randomInteger: () => value, idExists: () => false })).toThrow(
      "out-of-range",
    );
  }
});
