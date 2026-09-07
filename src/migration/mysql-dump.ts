export interface LegacyGifRecord {
  id: number;
  urlId: string;
  private: boolean;
  ip: string;
  createdAt: string;
}

type SqlValue = string | null;

const LEGACY_COLUMNS = ["id", "url_id", "private", "ip", "created"] as const;

export function parseLegacyGifRecords(sql: string, databaseName = "gifgg"): LegacyGifRecord[] {
  const databaseSql = selectDatabaseSection(sql, databaseName);
  const insertPattern =
    /INSERT\s+INTO\s+(?:(?:`([^`]+)`\.)?`([^`]+)`)\s*(?:\(([^)]*)\))?\s*VALUES\s*/gi;
  const records: LegacyGifRecord[] = [];
  const ids = new Set<number>();
  const urlIds = new Set<string>();
  let foundGifInsert = false;

  for (const match of databaseSql.matchAll(insertPattern)) {
    const [, qualifiedDatabase, tableName, rawColumns] = match;
    if (tableName !== "gif" || (qualifiedDatabase && qualifiedDatabase !== databaseName)) {
      continue;
    }
    foundGifInsert = true;

    const columns = rawColumns ? parseColumns(rawColumns) : [...LEGACY_COLUMNS];
    const valuesStart = (match.index ?? 0) + match[0].length;
    const rows = parseValueRows(databaseSql, valuesStart);

    for (const values of rows) {
      if (values.length !== columns.length) {
        throw new Error(
          `gif INSERT has ${values.length} values for ${columns.length} columns`,
        );
      }

      const row = new Map(columns.map((column, index) => [column, values[index] ?? null]));
      const record = toLegacyGifRecord(row);

      if (ids.has(record.id)) {
        throw new Error(`duplicate legacy gif id ${record.id}`);
      }
      if (urlIds.has(record.urlId)) {
        throw new Error(`duplicate legacy gif url_id ${JSON.stringify(record.urlId)}`);
      }

      ids.add(record.id);
      urlIds.add(record.urlId);
      records.push(record);
    }
  }

  const createsGifTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`gif`\s*\(/i.test(
    databaseSql,
  );
  if (!foundGifInsert && !createsGifTable) {
    throw new Error(`table "${databaseName}.gif" was not found in the dump`);
  }

  return records;
}

function selectDatabaseSection(sql: string, databaseName: string): string {
  const markerPattern = /^-- Current Database: `([^`]+)`\r?$/gm;
  const markers = [...sql.matchAll(markerPattern)];
  if (markers.length === 0) {
    return sql;
  }

  const markerIndex = markers.findIndex((marker) => marker[1] === databaseName);
  if (markerIndex === -1) {
    throw new Error(`database ${JSON.stringify(databaseName)} was not found in the dump`);
  }

  const start = markers[markerIndex]?.index ?? 0;
  const end = markers[markerIndex + 1]?.index ?? sql.length;
  return sql.slice(start, end);
}

function parseColumns(rawColumns: string): string[] {
  const columns = rawColumns.split(",").map((column) => column.trim().replace(/^`|`$/g, ""));
  for (const required of LEGACY_COLUMNS) {
    if (!columns.includes(required)) {
      throw new Error(`gif INSERT is missing required column ${JSON.stringify(required)}`);
    }
  }
  return columns;
}

function parseValueRows(sql: string, start: number): SqlValue[][] {
  const rows: SqlValue[][] = [];
  let position = start;

  while (position < sql.length) {
    position = skipWhitespace(sql, position);
    if (sql[position] === ";") {
      return rows;
    }
    if (sql[position] !== "(") {
      throw new Error(`expected a gif value tuple at SQL offset ${position}`);
    }

    const parsed = parseTuple(sql, position + 1);
    rows.push(parsed.values);
    position = skipWhitespace(sql, parsed.position);

    if (sql[position] === ",") {
      position += 1;
      continue;
    }
    if (sql[position] === ";") {
      return rows;
    }
    throw new Error(`expected a comma or semicolon at SQL offset ${position}`);
  }

  throw new Error("unterminated gif INSERT statement");
}

function parseTuple(sql: string, start: number): { values: SqlValue[]; position: number; } {
  const values: SqlValue[] = [];
  let position = start;

  while (position < sql.length) {
    position = skipWhitespace(sql, position);
    const parsed = sql[position] === "'"
      ? parseQuotedString(sql, position + 1)
      : parseUnquotedValue(sql, position);
    values.push(parsed.value);
    position = skipWhitespace(sql, parsed.position);

    if (sql[position] === ",") {
      position += 1;
      continue;
    }
    if (sql[position] === ")") {
      return { values, position: position + 1 };
    }
    throw new Error(`expected a comma or closing parenthesis at SQL offset ${position}`);
  }

  throw new Error("unterminated gif value tuple");
}

function parseQuotedString(sql: string, start: number): { value: string; position: number; } {
  let value = "";
  let position = start;

  while (position < sql.length) {
    const character = sql[position];
    if (character === "'") {
      if (sql[position + 1] === "'") {
        value += "'";
        position += 2;
        continue;
      }
      return { value, position: position + 1 };
    }

    if (character === "\\") {
      const escaped = sql[position + 1];
      if (escaped === undefined) {
        throw new Error("unterminated MySQL string escape");
      }
      value += decodeMysqlEscape(escaped);
      position += 2;
      continue;
    }

    value += character;
    position += 1;
  }

  throw new Error("unterminated MySQL string literal");
}

function decodeMysqlEscape(character: string): string {
  const escapes: Record<string, string> = {
    "0": "\0",
    b: "\b",
    n: "\n",
    r: "\r",
    t: "\t",
    Z: "\x1a",
  };
  return escapes[character] ?? character;
}

function parseUnquotedValue(sql: string, start: number): { value: SqlValue; position: number; } {
  let position = start;
  while (position < sql.length && sql[position] !== "," && sql[position] !== ")") {
    position += 1;
  }

  const token = sql.slice(start, position).trim();
  if (!token) {
    throw new Error(`empty SQL value at offset ${start}`);
  }
  return { value: token.toUpperCase() === "NULL" ? null : token, position };
}

function skipWhitespace(sql: string, start: number): number {
  let position = start;
  while (position < sql.length && /\s/.test(sql[position] ?? "")) {
    position += 1;
  }
  return position;
}

function toLegacyGifRecord(row: ReadonlyMap<string, SqlValue>): LegacyGifRecord {
  const rawId = requiredValue(row, "id");
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1 || String(id) !== rawId) {
    throw new Error(`invalid legacy gif id ${JSON.stringify(rawId)}`);
  }

  const urlId = requiredValue(row, "url_id");
  if (!/^[a-zA-Z0-9]+$/.test(urlId)) {
    throw new Error(`invalid legacy gif url_id ${JSON.stringify(urlId)}`);
  }

  const rawPrivate = requiredValue(row, "private");
  if (rawPrivate !== "0" && rawPrivate !== "1") {
    throw new Error(`invalid legacy gif private value ${JSON.stringify(rawPrivate)}`);
  }

  return {
    id,
    urlId,
    private: rawPrivate === "1",
    ip: requiredValue(row, "ip"),
    createdAt: requiredValue(row, "created"),
  };
}

function requiredValue(row: ReadonlyMap<string, SqlValue>, column: string): string {
  const value = row.get(column);
  if (value === null || value === undefined) {
    throw new Error(`legacy gif column ${JSON.stringify(column)} cannot be NULL`);
  }
  return value;
}
