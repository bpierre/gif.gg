import { Database } from "bun:sqlite";
import {
  existsSync,
  linkSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import { GIF_DATABASE_SCHEMA } from "../server/database";
import { type LegacyGifRecord, parseLegacyGifRecords } from "./mysql-dump";

export interface MigrationOptions {
  sourcePath: string;
  outputPath: string;
  databaseName?: string;
  mediaDirectory?: string;
}

export interface MediaReport {
  files: number;
  matched: number;
  missing: string[];
  orphaned: string[];
  duplicateFileIds: string[];
}

export interface MigrationReport {
  sourcePath: string;
  outputPath: string;
  databaseName: string;
  rows: number;
  firstId: number | null;
  lastId: number | null;
  media?: MediaReport;
}

export function migrateMysqlDump(options: MigrationOptions): MigrationReport {
  const sourcePath = resolve(options.sourcePath);
  const outputPath = resolve(options.outputPath);
  const databaseName = options.databaseName ?? "gifgg";

  assertRegularFile(sourcePath, "source SQL dump");
  if (sourcePath === outputPath) {
    throw new Error("source and output paths must differ");
  }
  if (existsSync(outputPath)) {
    throw new Error(`refusing to overwrite existing output ${JSON.stringify(outputPath)}`);
  }
  if (!statSync(dirname(outputPath)).isDirectory()) {
    throw new Error(`output directory does not exist: ${JSON.stringify(dirname(outputPath))}`);
  }

  const records = parseLegacyGifRecords(readFileSync(sourcePath, "utf8"), databaseName);
  const media = options.mediaDirectory
    ? inspectMedia(resolve(options.mediaDirectory), records)
    : undefined;
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    writeDatabase(temporaryPath, records);
    linkSync(temporaryPath, outputPath);
    unlinkSync(temporaryPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }

  const ids = records.map((record) => record.id);
  return {
    sourcePath,
    outputPath,
    databaseName,
    rows: records.length,
    firstId: ids.length === 0 ? null : Math.min(...ids),
    lastId: ids.length === 0 ? null : Math.max(...ids),
    ...(media ? { media } : {}),
  };
}

function writeDatabase(path: string, records: readonly LegacyGifRecord[]): void {
  const database = new Database(path, { create: true, strict: true });
  try {
    database.exec("PRAGMA journal_mode = DELETE;");
    database.exec("PRAGMA synchronous = FULL;");
    database.exec(GIF_DATABASE_SCHEMA);

    const insert = database.query<never, [number, string, number, string | null, string]>(
      `INSERT INTO gifs (id, url_id, private, ip, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertAll = database.transaction((rows: readonly LegacyGifRecord[]) => {
      for (const row of rows) {
        insert.run(row.id, row.urlId, row.private ? 1 : 0, row.ip, row.createdAt);
      }
    });
    insertAll(records);

    const integrity = database.query<{ integrity_check: string; }, []>("PRAGMA integrity_check")
      .get();
    if (integrity?.integrity_check !== "ok") {
      throw new Error(
        `SQLite integrity check failed: ${integrity?.integrity_check ?? "no result"}`,
      );
    }
  } finally {
    database.close();
  }
}

function inspectMedia(mediaDirectory: string, records: readonly LegacyGifRecord[]): MediaReport {
  if (!existsSync(mediaDirectory) || !statSync(mediaDirectory).isDirectory()) {
    throw new Error(`media directory does not exist: ${JSON.stringify(mediaDirectory)}`);
  }

  const fileIds: string[] = [];
  collectGifIds(mediaDirectory, fileIds);
  const fileIdCounts = new Map<string, number>();
  for (const id of fileIds) {
    fileIdCounts.set(id, (fileIdCounts.get(id) ?? 0) + 1);
  }

  const rowIds = new Set(records.map((record) => record.urlId));
  const uniqueFileIds = new Set(fileIds);
  const missing = [...rowIds].filter((id) => !uniqueFileIds.has(id)).sort();
  const orphaned = [...uniqueFileIds].filter((id) => !rowIds.has(id)).sort();
  const duplicateFileIds = [...fileIdCounts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();

  return {
    files: fileIds.length,
    matched: rowIds.size - missing.length,
    missing,
    orphaned,
    duplicateFileIds,
  };
}

function collectGifIds(directory: string, ids: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectGifIds(path, ids);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".gif") {
      ids.push(basename(entry.name, extname(entry.name)));
    }
  }
}

function assertRegularFile(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} does not exist: ${JSON.stringify(path)}`);
  }
}

interface CliOptions extends MigrationOptions {
  help: boolean;
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  const values: Partial<CliOptions> = { help: false };
  const names: Record<string, keyof MigrationOptions> = {
    "--source": "sourcePath",
    "--output": "outputPath",
    "--database": "databaseName",
    "--media-dir": "mediaDirectory",
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") {
      values.help = true;
      continue;
    }

    const name = argument ? names[argument] : undefined;
    const value = arguments_[index + 1];
    if (!name || !value) {
      throw new Error(`unknown or incomplete argument ${JSON.stringify(argument)}`);
    }
    values[name] = value;
    index += 1;
  }

  if (values.help) {
    return values as CliOptions;
  }
  if (!values.sourcePath || !values.outputPath) {
    throw new Error("--source and --output are required");
  }
  return values as CliOptions;
}

function usage(): string {
  return `Usage:
  bun run migrate:mysql-to-sqlite -- \\
    --source /path/to/gifgg.sql \\
    --output /path/to/new-gifgg.sqlite \\
    [--media-dir /path/to/gifs] \\
    [--database gifgg]`;
}

if (import.meta.main) {
  try {
    const options = parseArguments(Bun.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      console.log(JSON.stringify(migrateMysqlDump(options), null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}
