import { Database } from "bun:sqlite";

export interface GifRecord {
  id: number;
  urlId: string;
  private: boolean;
  ip: string | null;
  createdAt: string;
}

interface GifRow {
  id: number;
  url_id: string;
  private: number;
  ip: string | null;
  created_at: string;
}

const GIF_COLUMNS = `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id TEXT NOT NULL UNIQUE,
    private INTEGER NOT NULL DEFAULT 1 CHECK (private IN (0, 1)),
    ip TEXT,
    created_at TEXT NOT NULL
`;

export const GIF_DATABASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS gifs (${GIF_COLUMNS});

  CREATE INDEX IF NOT EXISTS gifs_created_at_idx ON gifs (created_at);
`;

export class GifDatabase {
  readonly #database: Database;

  constructor(path: string) {
    this.#database = new Database(path, { create: true });
    try {
      this.#database.exec("PRAGMA busy_timeout = 5000;");
      this.#database.exec("PRAGMA journal_mode = WAL;");
      this.#database.exec("PRAGMA synchronous = NORMAL;");
      this.#database.transaction(() => {
        this.#database.exec(GIF_DATABASE_SCHEMA);
        this.#upgradeNullableIp();
      }).immediate();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  #upgradeNullableIp(): void {
    const ip = this.#database.query<{ notnull: number; }, []>(
      "SELECT [notnull] FROM pragma_table_info('gifs') WHERE name = 'ip'",
    ).get();
    if (ip?.notnull !== 1) return;

    // Rebuild only the old schema, atomically. Preserve deleted IDs as well as rows.
    const sequence = this.#database.query<{ seq: number; }, []>(
      "SELECT seq FROM sqlite_sequence WHERE name = 'gifs'",
    ).get()?.seq ?? 0;
    const schemaObjects = this.#database.query<{ sql: string; }, []>(
      "SELECT sql FROM sqlite_schema WHERE tbl_name = 'gifs' "
        + "AND type IN ('index', 'trigger') AND sql IS NOT NULL",
    ).all();

    this.#database.exec(`
      CREATE TABLE gifs_nullable_ip (${GIF_COLUMNS});
      INSERT INTO gifs_nullable_ip (id, url_id, private, ip, created_at)
        SELECT id, url_id, private, NULLIF(ip, ''), created_at FROM gifs;
      DROP TABLE gifs;
      ALTER TABLE gifs_nullable_ip RENAME TO gifs;
    `);
    for (const object of schemaObjects) this.#database.exec(object.sql);
    this.#database.exec("DELETE FROM sqlite_sequence WHERE name = 'gifs'");
    this.#database.query("INSERT INTO sqlite_sequence (name, seq) VALUES ('gifs', ?)")
      .run(sequence);
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
      .query<never, [string, number, string | null, string]>(
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
