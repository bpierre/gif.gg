export const LEGACY_ID_CHARACTERS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";

export type InclusiveRandomInteger = (
  minimumInclusive: number,
  maximumInclusive: number,
) => number;

export interface LegacyIdOptions {
  randomInteger: InclusiveRandomInteger;
  length?: number;
  idExists?: (id: string) => boolean;
  reservedIds?: readonly string[];
}

export function generateLegacyId(options: LegacyIdOptions): string {
  const length = options.length ?? 7;
  const idExists = options.idExists ?? (() => false);
  const reservedIds = options.reservedIds ?? ["about"];
  let id = "";

  for (let index = 0; index < length; index += 1) {
    const characterIndex = options.randomInteger(
      0,
      LEGACY_ID_CHARACTERS.length,
    );

    // PHP's out-of-range string offset contributes an empty value during
    // concatenation. Keeping that behavior here is intentional for parity.
    id += LEGACY_ID_CHARACTERS[characterIndex] ?? "";
  }

  if (idExists(id) || reservedIds.includes(id)) {
    return generateLegacyId(options);
  }

  return id;
}
