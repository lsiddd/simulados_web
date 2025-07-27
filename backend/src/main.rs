// src/main.rs
mod db;
mod handlers;
mod simulado_store;
mod cache;
mod watcher;

use actix_web::{web, App, HttpServer, middleware::Logger};
use handlers::*;
use simulado_store::SimuladoStore;
use std::sync::Arc;
use watcher::start_watcher;
use crate::cache::RedisCache;
use std::env;
use log::{error, info};
use std::process;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info,simulados_backend=debug"));

    info!("🚀 Starting backend service initialization...");

    // --- Create all the shared state components ---
    let db_pool = match db::init_db() {
        Ok(pool) => { info!("✅ Database connection pool initialized successfully."); pool },
        Err(e) => { error!("❌ CRITICAL: Failed to initialize database: {:?}. Exiting.", e); process::exit(1); }
    };

    let cache = match RedisCache::new().await {
        Ok(cache_client) => { info!("✅ Redis cache client initialized successfully."); cache_client },
        Err(e) => { error!("❌ CRITICAL: Failed to initialize Redis cache: {:?}. Exiting.", e); process::exit(1); }
    };
    
    let simulado_store = Arc::new(SimuladoStore::new("simulados"));

    // THE FIX IS HERE:
    // 1. Clone the Arcs *before* the `tokio::spawn` block.
    //    These clones will be moved into the file watcher task.
    let watcher_store_clone = simulado_store.clone();
    let watcher_cache_clone = cache.clone();

    // 2. The `async move` block now takes ownership of the *clones*,
    //    leaving the original variables (`simulado_store`, `cache`) untouched.
    tokio::spawn(async move {
        info!("Starting filesystem watcher...");
        if let Err(e) = start_watcher(watcher_store_clone, watcher_cache_clone).await {
            error!("File watcher task failed: {}", e);
        }
    });
    
    let workers = env::var("NUM_WORKERS").ok().and_then(|s| s.parse().ok()).unwrap_or(6);

    info!("🔥 Starting Actix Web server with {} workers...", workers);

    // 3. Now we can safely move the *original* variables into the HttpServer.
    HttpServer::new(move || {
        App::new()
            .wrap(Logger::default())
            .app_data(web::Data::new(simulado_store.clone()))
            .app_data(web::Data::new(db_pool.clone()))
            .app_data(web::Data::new(cache.clone()))
            .service(
                web::scope("/api")
                    .service(get_simulados_list)
                    .service(get_simulado_data)
                    .service(
                        web::scope("/user")
                            .service(save_user_stats)
                            .service(handle_bookmark_save)
                            .service(handle_bookmark_delete)
                            .service(handle_theme_get)
                            .service(handle_theme_post)
                            .service(handle_progress_get)
                            .service(handle_progress_post)
                            .service(handle_progress_delete)
                            .service(get_all_progress)
                            .service(get_bookmarks)
                            .service(get_incorrect_answers)
                    )
            )
    })
    .bind("0.0.0.0:5000")?
    .workers(workers)
    .run()
    .await
}