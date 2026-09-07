import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GifDatabase } from "../../src/server/database";

const directories: string[] = [];

function oldDatabase(): { path: string; database: Database; } {
  const directory = mkdtempSync(join(tmpdir(), "gifgg-schema-test-"));
  directories.push(directory);
  const path = join(directory, "gifgg.sqlite");
  const database = new Database(path);
  database.exec(`
    CREATE TABLE gifs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_id TEXT NOT NULL UNIQUE,
      private INTEGER NOT NULL DEFAULT 1 CHECK (private IN (0, 1)),
      ip TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX gifs_created_at_idx ON gifs (created_at);
  `);
  return { path, database };
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("upgrades required IPs while preserving records, indexes, triggers and ID sequencing", () => {
  const { path, database } = oldDatabase();
  database.exec(`
    INSERT INTO gifs VALUES (7, 'knownIp', 0, '203.0.113.7', '2020-01-01');
    INSERT INTO gifs VALUES (8, 'emptyIp', 1, '', '2020-01-02');
    INSERT INTO gifs VALUES (99, 'deleted', 1, '', '2020-01-03');
    DELETE FROM gifs WHERE id = 99;
    CREATE INDEX custom_ip_idx ON gifs (ip);
    CREATE TABLE audit (url_id TEXT);
    CREATE TRIGGER audit_gifs AFTER INSERT ON gifs BEGIN
      INSERT INTO audit VALUES (new.url_id);
    END;
  `);
  database.close();

  const appDatabase = new GifDatabase(path);
  try {
    expect(appDatabase.findGif("knownIp")).toEqual({
      id: 7,
      urlId: "knownIp",
      private: false,
      ip: "203.0.113.7",
      createdAt: "2020-01-01",
    });
    expect(appDatabase.findGif("emptyIp")).toEqual({
      id: 8,
      urlId: "emptyIp",
      private: true,
      ip: null,
      createdAt: "2020-01-02",
    });
    expect(
      appDatabase.insertGif({
        urlId: "newNull",
        private: true,
        ip: null,
        createdAt: "2020-01-04",
      }).id,
    ).toBe(100);
  } finally {
    appDatabase.close();
  }

  const reopened = new GifDatabase(path);
  try {
    expect(reopened.findGif("newNull")?.ip).toBeNull();
    expect(
      reopened.insertGif({
        urlId: "next",
        private: true,
        ip: "203.0.113.8",
        createdAt: "2020-01-05",
      }).id,
    ).toBe(101);
  } finally {
    reopened.close();
  }

  const inspection = new Database(path, { readonly: true });
  try {
    expect(inspection.query("SELECT * FROM audit ORDER BY rowid").all()).toEqual([
      { url_id: "newNull" },
      { url_id: "next" },
    ]);
    const indexes = inspection.query<{ name: string; }, []>("PRAGMA index_list(gifs)").all();
    expect(indexes.map((index) => index.name)).toContain("gifs_created_at_idx");
    expect(indexes.map((index) => index.name)).toContain("custom_ip_idx");
    expect(inspection.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    inspection.close();
  }
});

test("preserves the sequence when all old rows have been deleted", () => {
  const { path, database } = oldDatabase();
  database.exec(`
    INSERT INTO gifs VALUES (42, 'deleted', 1, '', '2020-01-01');
    DELETE FROM gifs;
  `);
  database.close();
  const upgraded = new GifDatabase(path);
  try {
    expect(
      upgraded.insertGif({
        urlId: "next",
        private: true,
        ip: null,
        createdAt: "2020-01-02",
      }).id,
    ).toBe(43);
  } finally {
    upgraded.close();
  }
});

test("rolls back a failed upgrade without changing the old data or schema", () => {
  const { path, database } = oldDatabase();
  database.exec(`
    INSERT INTO gifs VALUES (7, 'existing', 1, '', '2020-01-01');
    CREATE VIEW gif_view AS SELECT * FROM gifs;
  `);
  database.close();

  // SQLite rejects the rename while this custom view references the dropped table.
  expect(() => new GifDatabase(path)).toThrow();
  const inspection = new Database(path);
  try {
    expect(inspection.query("SELECT ip FROM gifs").get()).toEqual({ ip: "" });
    expect(
      inspection.query(
        "SELECT [notnull] FROM pragma_table_info('gifs') WHERE name = 'ip'",
      ).get(),
    ).toEqual({ notnull: 1 });
    expect(
      inspection.query(
        "SELECT name FROM sqlite_schema WHERE name = 'gifs_nullable_ip'",
      ).get(),
    ).toBeNull();
    expect(inspection.query("SELECT seq FROM sqlite_sequence WHERE name = 'gifs'").get())
      .toEqual({ seq: 7 });
    expect(inspection.query("SELECT ip FROM gif_view").get()).toEqual({ ip: "" });
  } finally {
    inspection.close();
  }
});
