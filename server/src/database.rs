use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::path::Path;

const COLUMNS: &str = include_str!("../gif-columns.sql");

pub struct GifDatabase(Connection);

impl GifDatabase {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
        )?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(&format!("CREATE TABLE IF NOT EXISTS gifs ({COLUMNS}); CREATE INDEX IF NOT EXISTS gifs_created_at_idx ON gifs (created_at);"))?;
        let required: Option<i64> = transaction
            .query_row(
                "SELECT [notnull] FROM pragma_table_info('gifs') WHERE name = 'ip'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if required == Some(1) {
            let sequence: i64 = transaction
                .query_row(
                    "SELECT seq FROM sqlite_sequence WHERE name = 'gifs'",
                    [],
                    |row| row.get(0),
                )
                .optional()?
                .unwrap_or(0);
            let objects = {
                let mut statement = transaction.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name = 'gifs' AND type IN ('index', 'trigger') AND sql IS NOT NULL")?;
                let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            transaction.execute_batch(&format!(
                "
                CREATE TABLE gifs_nullable_ip ({COLUMNS});
                INSERT INTO gifs_nullable_ip (id, url_id, private, ip, created_at)
                  SELECT id, url_id, private, NULLIF(ip, ''), created_at FROM gifs;
                DROP TABLE gifs;
                ALTER TABLE gifs_nullable_ip RENAME TO gifs;
            "
            ))?;
            for sql in objects {
                transaction.execute_batch(&sql)?;
            }
            transaction.execute("DELETE FROM sqlite_sequence WHERE name = 'gifs'", [])?;
            transaction.execute(
                "INSERT INTO sqlite_sequence (name, seq) VALUES ('gifs', ?)",
                [sequence],
            )?;
        }
        transaction.commit()?;
        Ok(Self(connection))
    }

    pub fn has_gif(&self, id: &str) -> rusqlite::Result<bool> {
        Ok(self
            .0
            .query_row("SELECT 1 FROM gifs WHERE url_id = ? LIMIT 1", [id], |_| {
                Ok(())
            })
            .optional()?
            .is_some())
    }

    pub fn insert(&self, id: &str, ip: Option<&str>, created_at: &str) -> rusqlite::Result<()> {
        self.0.execute(
            "INSERT INTO gifs (url_id, private, ip, created_at) VALUES (?, 1, ?, ?)",
            params![id, ip, created_at],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> rusqlite::Result<()> {
        self.0.execute("DELETE FROM gifs WHERE url_id = ?", [id])?;
        Ok(())
    }
}
