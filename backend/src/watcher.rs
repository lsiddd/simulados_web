// src/watcher.rs
use notify::{RecommendedWatcher, RecursiveMode, Watcher, Config, EventKind};
use crate::simulado_store::SimuladoStore;
use crate::cache::RedisCache;
use std::{path::Path, sync::Arc};
use tokio::sync::mpsc;
use log::info;

pub async fn start_watcher(store: Arc<SimuladoStore>, cache: Arc<RedisCache>) -> notify::Result<()> {
let (tx, mut rx) = mpsc::channel(1);
let mut watcher = RecommendedWatcher::new(
    move |res| {
        if let Ok(event) = res {
            let _ = tx.blocking_send(event);
        }
    },
    Config::default(),
)?;

watcher.watch(Path::new(&store.path), RecursiveMode::Recursive)?;

while let Some(event) = rx.recv().await {
    match event.kind {
        EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Create(_) => {
            info!("File system change detected: {:?}. Invalidating caches.", event.paths);
            // Invalidate the in-memory cache
            store.invalidate_cache();
            // Invalidate the Redis cache for the list
            cache.invalidate_simulados_list().await;
        }
        _ => {}
    }
}

Ok(())

}