import { type InclusiveRandomInteger, LEGACY_ID_CHARACTERS } from "./legacy-id";

export interface IdOptions {
  randomInteger: InclusiveRandomInteger;
  idExists: (id: string) => boolean;
}

// Keep the alphabet and seven-character format; never draw its out-of-range index.
export function generateId({ randomInteger, idExists }: IdOptions): string {
  for (;;) {
    let id = "";
    for (let index = 0; index < 7; index++) {
      const characterIndex = randomInteger(0, LEGACY_ID_CHARACTERS.length - 1);
      if (
        !Number.isInteger(characterIndex) || characterIndex < 0
        || characterIndex >= LEGACY_ID_CHARACTERS.length
      ) {
        throw new Error("ID random source returned an out-of-range index");
      }
      id += LEGACY_ID_CHARACTERS[characterIndex];
    }
    if (!idExists(id)) return id;
  }
}
