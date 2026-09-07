# Upgrading gif.gg

This migrates a legacy gif.gg MySQL dump to SQLite. It does not modify the SQL
dump or media directory.

## Execution environment

The application now uses:

- Bun 1.4 or newer instead of PHP and Composer;
- SQLite instead of MySQL;
- an external, writable `DATA_DIR` for the database and GIF files.

Install dependencies and build the browser assets before deploying:

```sh
bun install --frozen-lockfile
bun run build
```

## Migrate

Create a MySQL dump containing the legacy `gifgg` database and choose a new
SQLite output path. The output file must not already exist.

Missing or empty legacy IP addresses are stored as SQL `NULL`.
Existing SQLite databases with a required IP column are upgraded automatically
on startup in a transaction, preserving records and ID sequencing. Stop older
app processes before starting the updated server.

```sh
bun run migrate:mysql-to-sqlite -- \
  --source /path/to/databases.sql \
  --output /path/to/gifgg.sqlite \
  --media-dir /path/to/gifs
```

`--media-dir` is optional. When provided, the command reports missing,
orphaned, and duplicate media IDs.

Before using the new database, verify that the migrated row count matches the
legacy `gif` table and review every reported media difference.

## Run

The persistent directory must contain the migrated database and media:

```text
DATA_DIR/
├── gifgg.sqlite
└── gifs/
```

Start the Bun server with an explicit production data directory:

```sh
NODE_ENV=production DATA_DIR=/path/to/data bun run start
```

It listens on port `3000` by default; set `PORT` to change it. In production,
run it behind the reverse proxy that handles public TLS.

New uploads are validated against the [upload limits](README.md#uploads); existing
GIFs are unchanged. Allow at least 11 MiB request bodies at the proxy to accommodate
10 MiB GIFs plus multipart overhead. Upload failures now return non-2xx JSON errors;
successful uploads still return the GIF page path.
