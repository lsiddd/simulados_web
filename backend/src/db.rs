// src/db.rs
use rusqlite::{params, Connection, Row};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;
use anyhow::{Result, Context};

pub type DbPool = Arc<Mutex<Connection>>;

pub fn init_db() -> Result<DbPool> {
    let conn = Connection::open("user_data/app.db")?;

    conn.execute_batch(
        r#"
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA temp_store=MEMORY;
        PRAGMA cache_size=-100000;

        CREATE TABLE IF NOT EXISTS theme (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT);
        CREATE TABLE IF NOT EXISTS progress (
            simulado_id TEXT PRIMARY KEY,
            data TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_progress_updated ON progress(updated_at);

        CREATE TABLE IF NOT EXISTS incorrect_answers (
            question_hash TEXT,
            count INTEGER,
            enunciado TEXT,
            simulado_id TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (question_hash, simulado_id)
        );
        CREATE INDEX IF NOT EXISTS idx_incorrect_simulado ON incorrect_answers(simulado_id);

        CREATE TABLE IF NOT EXISTS bookmarks (
            simulado_id TEXT,
            question_hash TEXT,
            enunciado TEXT,
            category TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (simulado_id, question_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_bookmarks_simulado ON bookmarks(simulado_id);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category);
        "#,
    )?;

    Ok(Arc::new(Mutex::new(conn)))
}

pub async fn save_incorrect_answers(db: &DbPool, stats: &Value) -> Result<()> {
    let mut conn = db.lock().await;
    let tx = conn.transaction()?;

    for (hash, data) in stats.as_object().context("Invalid stats format")? {
        let count = data["count"].as_i64().context("Missing count")?;
        let enunciado = data["enunciado"].as_str().context("Missing enunciado")?;
        let simulado_id = data["simulado_id"].as_str().context("Missing simulado_id")?;

        tx.execute(
            r#"
            INSERT OR REPLACE INTO incorrect_answers
            (question_hash, count, enunciado, simulado_id, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            "#,
            params![hash, count, enunciado, simulado_id],
        )?;
    }

    tx.commit()?;
    Ok(())
}

pub async fn save_bookmark(
    db: &DbPool,
    simulado_id: &str,
    question_hash: &str,
    enunciado: &str,
    category: &str,
) -> Result<()> {
    let conn = db.lock().await;
    conn.execute(
        r#"
        INSERT OR REPLACE INTO bookmarks
        (simulado_id, question_hash, enunciado, category, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        "#,
        params![simulado_id, question_hash, enunciado, category],
    )?;
    Ok(())
}

pub async fn delete_bookmark(db: &DbPool, simulado_id: &str, question_hash: &str) -> Result<()> {
    let conn = db.lock().await;
    conn.execute(
        "DELETE FROM bookmarks WHERE simulado_id = ? AND question_hash = ?",
        params![simulado_id, question_hash],
    )?;
    Ok(())
}

pub async fn save_theme(db: &DbPool, theme: &str) -> Result<()> {
    let conn = db.lock().await;
    conn.execute(
        "INSERT OR REPLACE INTO theme (id, value) VALUES (1, ?)",
        params![theme],
    )?;
    Ok(())
}

pub async fn get_theme(db: &DbPool) -> Result<String> {
    let conn = db.lock().await;
    let theme = conn.query_row("SELECT value FROM theme WHERE id=1", [], |row| row.get(0))
        .unwrap_or_else(|_| "light".to_string());
    Ok(theme)
}

pub async fn save_progress(db: &DbPool, simulado_id: &str, data: &Value) -> Result<()> {
    let conn = db.lock().await;
    let data_str = serde_json::to_string(data)?;
    conn.execute(
        "INSERT OR REPLACE INTO progress (simulado_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        params![simulado_id, data_str],
    )?;
    Ok(())
}

pub async fn get_progress(db: &DbPool, simulado_id: &str) -> Result<Option<Value>> {
    let conn = db.lock().await;
    let result: rusqlite::Result<String> = conn.query_row(
        "SELECT data FROM progress WHERE simulado_id=?",
        params![simulado_id],
        |row| row.get(0),
    );

    match result {
        Ok(data_str) => Ok(Some(serde_json::from_str(&data_str)?)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub async fn delete_progress(db: &DbPool, simulado_id: &str) -> Result<()> {
    let conn = db.lock().await;
    conn.execute(
        "DELETE FROM progress WHERE simulado_id = ?",
        params![simulado_id],
    )?;
    Ok(())
}

pub async fn get_all_progress(
    db: &DbPool,
    store: &crate::simulado_store::SimuladoStore,
) -> Result<Vec<Value>> {
    let conn = db.lock().await;
    let mut stmt = conn.prepare("SELECT simulado_id, data FROM progress WHERE data IS NOT NULL AND data != '{}'")?;
    let rows = stmt.query_map([], |row| {
        let simulado_id: String = row.get(0)?;
        let data: String = row.get(1)?;
        Ok((simulado_id, data))
    })?;

    let mut results = Vec::new();
    // Pre-fetch simulados list to avoid multiple lookups inside loop
    let simulados_map: std::collections::HashMap<String, _> = store.get_simulados_list()
        .into_iter()
        .map(|s| (s.id.clone(), s))
        .collect();

    for row in rows {
        let (simulado_id, data_str) = row?;
        if let Some(simulado_info) = simulados_map.get(&simulado_id) {
            let progress_data: Value = serde_json::from_str(&data_str)?;
            results.push(serde_json::json!({
                "simulado_id": simulado_id,
                "titulo": simulado_info.titulo,
                "descricao": simulado_info.descricao,
                "questoes_count": simulado_info.questoes_count,
                "progress": progress_data
            }));
        }
    }

    Ok(results)
}

pub async fn get_bookmarks(db: &DbPool) -> Result<Vec<Value>> {
    let conn = db.lock().await;
    let mut stmt = conn.prepare(
        "SELECT simulado_id, question_hash, enunciado, category FROM bookmarks ORDER BY created_at DESC"
    )?;

    fn map_row(row: &Row) -> rusqlite::Result<Value> {
        Ok(serde_json::json!({
            "simulado_id": row.get::<_, String>(0)?,
            "question_hash": row.get::<_, String>(1)?,
            "enunciado": row.get::<_, String>(2)?,
            "category": row.get::<_, String>(3)?,
        }))
    }

    let rows = stmt.query_and_then([], map_row)?;
    let bookmarks: Result<Vec<Value>, _> = rows.map(|r| r.map_err(Into::into)).collect();
    bookmarks
}


pub async fn get_incorrect_answers(db: &DbPool) -> Result<Vec<Value>> {
    let conn = db.lock().await;
    let mut stmt = conn.prepare(
        "SELECT question_hash, count, enunciado, simulado_id FROM incorrect_answers"
    )?;

     fn map_row(row: &Row) -> rusqlite::Result<Value> {
        Ok(serde_json::json!({
            "question_hash": row.get::<_, String>(0)?,
            "count": row.get::<_, i64>(1)?,
            "enunciado": row.get::<_, String>(2)?,
            "simulado_id": row.get::<_, String>(3)?,
        }))
    }

    let rows = stmt.query_and_then([], map_row)?;
    let answers: Result<Vec<Value>, _> = rows.map(|r| r.map_err(Into::into)).collect();
    answers
}