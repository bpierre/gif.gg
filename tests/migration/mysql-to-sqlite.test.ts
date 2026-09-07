import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateMysqlDump } from "../../src/migration/mysql-to-sqlite";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "gifgg-migration-test-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("MySQL to SQLite migration", () => {
  test("preserves legacy rows and reports missing and orphaned media", () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, "all-databases.sql");
    const outputPath = join(directory, "gifgg.sqlite");
    const mediaDirectory = join(directory, "gifs");
    mkdirSync(join(mediaDirectory, "nested"), { recursive: true });
    writeFileSync(join(mediaDirectory, "abc123.gif"), "GIF89a");
    writeFileSync(join(mediaDirectory, "orphan.gif"), "GIF89a");
    writeFileSync(join(mediaDirectory, "nested", "abc123.GIF"), "GIF89a");
    writeFileSync(
      sourcePath,
      `-- Current Database: \`other\`
INSERT INTO \`gif\` VALUES (99,'wrong',1,'127.0.0.1','2020-01-01 00:00:00');
-- Current Database: \`gifgg\`
INSERT INTO \`gif\` VALUES
(7,'abc123',1,'203.0.113.7','2015-02-03 04:05:06'),
(11,'def456',0,'2001:db8::1','2015-02-03 04:06:07');
-- Current Database: \`unrelated_database\`
INSERT INTO \`gif\` VALUES (100,'alsoWrong',1,'127.0.0.1','2020-01-01 00:00:00');
`,
    );

    const report = migrateMysqlDump({ sourcePath, outputPath, mediaDirectory });

    expect(report).toMatchObject({
      rows: 2,
      firstId: 7,
      lastId: 11,
      media: {
        files: 3,
        matched: 1,
        missing: ["def456"],
        orphaned: ["orphan"],
        duplicateFileIds: ["abc123"],
      },
    });

    const database = new Database(outputPath, { readonly: true, strict: true });
    expect(database.query("SELECT * FROM gifs ORDER BY id").all()).toEqual([
      {
        id: 7,
        url_id: "abc123",
        private: 1,
        ip: "203.0.113.7",
        created_at: "2015-02-03 04:05:06",
      },
      {
        id: 11,
        url_id: "def456",
        private: 0,
        ip: "2001:db8::1",
        created_at: "2015-02-03 04:06:07",
      },
    ]);
    database.close();
  });

  test("supports column lists and decodes MySQL string escaping", () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, "gifgg.sql");
    const outputPath = join(directory, "gifgg.sqlite");
    writeFileSync(
      sourcePath,
      "INSERT INTO `gif` (`created`, `ip`, `private`, `url_id`, `id`) "
        + "VALUES ('2015-01-02 03:04:05','Alex\\'s\\\\host',1,'abcDEF0',42);",
    );

    migrateMysqlDump({ sourcePath, outputPath });

    const database = new Database(outputPath, { readonly: true, strict: true });
    expect(database.query("SELECT ip FROM gifs").get()).toEqual({ ip: "Alex's\\host" });
    database.close();
  });

  test("rejects malformed legacy rows without leaving an output database", () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, "gifgg.sql");
    const outputPath = join(directory, "gifgg.sqlite");
    writeFileSync(
      sourcePath,
      "INSERT INTO `gif` VALUES (1,'../unsafe',1,'127.0.0.1','2015-01-01 00:00:00');",
    );

    expect(() => migrateMysqlDump({ sourcePath, outputPath })).toThrow("invalid legacy gif url_id");
    expect(Bun.file(outputPath).size).toBe(0);
  });

  test("refuses to overwrite an existing SQLite file", () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, "gifgg.sql");
    const outputPath = join(directory, "gifgg.sqlite");
    writeFileSync(sourcePath, "");
    writeFileSync(outputPath, "keep me");

    expect(() => migrateMysqlDump({ sourcePath, outputPath })).toThrow("refusing to overwrite");
    expect(Bun.file(outputPath).text()).resolves.toBe("keep me");
  });

  test("rejects a dump that does not contain the legacy gif table", () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, "wrong.sql");
    const outputPath = join(directory, "gifgg.sqlite");
    writeFileSync(sourcePath, "CREATE TABLE `unrelated` (`id` int);\n");

    expect(() => migrateMysqlDump({ sourcePath, outputPath })).toThrow(
      "table \"gifgg.gif\" was not found",
    );
    expect(Bun.file(outputPath).size).toBe(0);
  });

  test("accepts an empty legacy gif table", () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, "empty.sql");
    const outputPath = join(directory, "gifgg.sqlite");
    writeFileSync(sourcePath, "CREATE TABLE `gif` (`id` int);\n");

    expect(migrateMysqlDump({ sourcePath, outputPath }).rows).toBe(0);
    const database = new Database(outputPath, { readonly: true, strict: true });
    expect(database.query<{ count: number; }, []>("SELECT count(*) AS count FROM gifs").get())
      .toEqual({ count: 0 });
    database.close();
  });

  test("does not create output when the media directory is invalid", () => {
    const directory = temporaryDirectory();
    const sourcePath = join(directory, "gifgg.sql");
    const outputPath = join(directory, "gifgg.sqlite");
    writeFileSync(
      sourcePath,
      "INSERT INTO `gif` VALUES (1,'abcdefg',1,'127.0.0.1','2015-01-01 00:00:00');",
    );

    expect(() =>
      migrateMysqlDump({
        sourcePath,
        outputPath,
        mediaDirectory: join(directory, "missing"),
      })
    ).toThrow("media directory does not exist");
    expect(Bun.file(outputPath).size).toBe(0);
  });
});
