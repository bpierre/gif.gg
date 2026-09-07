import { Database } from "bun:sqlite";

export interface GifRecord {
  id: number;
  urlId: string;
  private: boolean;
  ip: string;
  createdAt: string;
}

interface GifRow {
  id: number;
  url_id: string;
  private: number;
  ip: string;
  created_at: string;
}

export const GIF_DATABASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS gifs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id TEXT NOT NULL UNIQUE,
    private INTEGER NOT NULL DEFAULT 1 CHECK (private IN (0, 1)),
    ip TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS gifs_created_at_idx ON gifs (created_at);
`;

export class GifDatabase {
  readonly #database: Database;

  constructor(path: string) {
    this.#database = new Database(path, { create: true });
    this.#database.exec("PRAGMA journal_mode = WAL;");
    this.#database.exec("PRAGMA synchronous = NORMAL;");
    this.#database.exec("PRAGMA busy_timeout = 5000;");
    this.#database.exec(GIF_DATABASE_SCHEMA);
  }

  close(): void {
    this.#database.close();
  }

  hasGif(urlId: string): boolean {
    const row = this.#database
      .query<{ found: number; }, [string]>(
        "SELECT 1 AS found FROM gifs WHERE url_id = ? LIMIT 1",
      )
      .get(urlId);

    return row !== null;
  }

  findGif(urlId: string): GifRecord | null {
    const row = this.#database
      .query<GifRow, [string]>(
        `SELECT id, url_id, private, ip, created_at
         FROM gifs
         WHERE url_id = ?
         LIMIT 1`,
      )
      .get(urlId);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      urlId: row.url_id,
      private: row.private === 1,
      ip: row.ip,
      createdAt: row.created_at,
    };
  }

  insertGif(record: Omit<GifRecord, "id">): GifRecord {
    const result = this.#database
      .query<never, [string, number, string, string]>(
        `INSERT INTO gifs (url_id, private, ip, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        record.urlId,
        record.private ? 1 : 0,
        record.ip,
        record.createdAt,
      );

    return {
      id: Number(result.lastInsertRowid),
      ...record,
    };
  }

  deleteGif(urlId: string): void {
    this.#database.query("DELETE FROM gifs WHERE url_id = ?").run(urlId);
  }
}
