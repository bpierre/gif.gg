import { describe, expect, test } from "bun:test";

import {
  generateLegacyId,
  type InclusiveRandomInteger,
  LEGACY_ID_CHARACTERS,
} from "../../src/id/legacy-id";

function sequenceRandom(
  values: readonly number[],
  bounds: Array<readonly [number, number]> = [],
): InclusiveRandomInteger {
  let position = 0;

  return (minimumInclusive, maximumInclusive) => {
    bounds.push([minimumInclusive, maximumInclusive]);

    const value = values[position];
    if (value === undefined) {
      throw new Error("random sequence exhausted");
    }

    position += 1;
    return value;
  };
}

describe("legacy ID generation", () => {
  test("preserves the legacy alphabet and ordering", () => {
    expect(LEGACY_ID_CHARACTERS).toHaveLength(62);

    const id = generateLegacyId({
      length: 7,
      randomInteger: sequenceRandom([0, 25, 26, 51, 52, 60, 61]),
    });

    expect(id).toBe("azAZ190");
  });

  test("draws through the inclusive out-of-range upper bound", () => {
    const bounds: Array<readonly [number, number]> = [];
    const id = generateLegacyId({
      length: 4,
      randomInteger: sequenceRandom([62, 0, 62, 61], bounds),
    });

    expect(id).toBe("a0");
    expect(bounds).toEqual([
      [0, 62],
      [0, 62],
      [0, 62],
      [0, 62],
    ]);
  });

  test("retries reserved IDs with the same legacy algorithm", () => {
    const checkedIds: string[] = [];
    const id = generateLegacyId({
      length: 5,
      randomInteger: sequenceRandom([0, 1, 14, 20, 19, 25, 24, 23, 22, 21]),
      idExists(candidate) {
        checkedIds.push(candidate);
        return false;
      },
    });

    expect(id).toBe("zyxwv");
    expect(checkedIds).toEqual(["about", "zyxwv"]);
  });

  test("retries IDs that already exist", () => {
    const id = generateLegacyId({
      length: 2,
      randomInteger: sequenceRandom([0, 0, 1, 1]),
      idExists: (candidate) => candidate === "aa",
    });

    expect(id).toBe("bb");
  });
});
