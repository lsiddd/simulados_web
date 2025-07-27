// src/handlers.rs
use actix_web::{get, post, delete, web, HttpResponse, Responder};
use crate::{db, cache::{RedisCache}, simulado_store};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use log::{debug, error, warn};

// --- Struct Definitions (remain the same) ---
#[derive(Deserialize)]
struct BookmarkSaveRequest {
    simulado_id: String,
    question_hash: String,
    enunciado: String,
    category: String,
}

#[derive(Deserialize)]
struct BookmarkDeleteRequest {
    simulado_id: String,
    question_hash: String,
}

#[derive(Deserialize)]
struct ThemeRequest {
    theme: String,
}

#[derive(Serialize)]
struct ThemeResponse {
    theme: String,
}


// --- API Handlers (All Corrected) ---

#[get("/simulados")]
pub async fn get_simulados_list(
    store: web::Data<Arc<simulado_store::SimuladoStore>>,
    cache: web::Data<Arc<RedisCache>>,
) -> impl Responder {
    debug!("Handler invoked: get_simulados_list");

    match cache.get_simulados_list().await {
        Ok(Some(cached_list)) => {
            debug!("Returning simulados list from Redis cache.");
            return HttpResponse::Ok().json(cached_list);
        }
        Ok(None) => debug!("Cache MISS for simulados list. Fetching from SimuladoStore."),
        Err(e) => error!("Could not get list from Redis, falling back to disk. Error: {:?}", e),
    }

    let simulados = store.get_simulados_list();
    if simulados.is_empty() {
        warn!("SimuladoStore returned an empty list. Check 'simulados' directory and JSON file contents.");
    } else {
        debug!("Successfully fetched {} simulados from store.", simulados.len());
    }

    if let Err(e) = cache.set_simulados_list(&simulados).await {
        error!("Could not set simulados list in Redis cache. Error: {:?}", e);
    }
    
    HttpResponse::Ok().json(simulados)
}

#[get("/simulados/{simulado_id}")]
pub async fn get_simulado_data(
    path: web::Path<String>,
    store: web::Data<Arc<simulado_store::SimuladoStore>>,
    cache: web::Data<Arc<RedisCache>>,
) -> impl Responder {
    let simulado_id = path.into_inner();
    debug!("Handler invoked: get_simulado_data for id: {}", simulado_id);
    let cache_key = format!("simulado:{}", simulado_id);

    match cache.get_simulado(&cache_key).await {
        Ok(Some(mut cached_data)) => {
            debug!("Redis HIT for simulado '{}'.", simulado_id);
            for questao in cached_data.questoes.iter_mut() {
                questao.shuffle_alternatives();
            }
            return HttpResponse::Ok().json(cached_data);
        }
        Ok(None) => debug!("Redis MISS for simulado '{}'. Fetching from disk.", simulado_id),
        Err(e) => error!("Could not get simulado '{}' from Redis, falling back to disk. Error: {:?}", simulado_id, e),
    }

    match store.get_simulado(&simulado_id) {
        Some(mut disk_data) => {
            if let Err(e) = cache.set_simulado(&cache_key, &disk_data).await {
                error!("Could not set cache for simulado '{}' in Redis. Error: {:?}", simulado_id, e);
            }
            for questao in disk_data.questoes.iter_mut() {
                questao.shuffle_alternatives();
            }
            HttpResponse::Ok().json(disk_data)
        }
        None => {
            warn!("Simulado with id '{}' not found in store.", simulado_id);
            HttpResponse::NotFound().json(json!({"error": "Simulado não encontrado"}))
        }
    }
}

// FIX: Path is now relative to the "/user" scope defined in main.rs
#[post("/stats")]
pub async fn save_user_stats(
    db: web::Data<db::DbPool>,
    stats: web::Json<serde_json::Value>,
) -> impl Responder {
    if stats.is_null() || stats.as_object().map_or(true, |m| m.is_empty()) {
        return HttpResponse::BadRequest().json(json!({"error": "Nenhum dado fornecido."}));
    }
    match db::save_incorrect_answers(&db, &stats).await {
        Ok(_) => HttpResponse::Ok().json(json!({"message": "Estatísticas salvas com sucesso."})),
        Err(e) => {
            error!("Failed to save user stats: {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[post("/bookmark")]
pub async fn handle_bookmark_save(
    db: web::Data<db::DbPool>,
    req: web::Json<BookmarkSaveRequest>,
) -> impl Responder {
    match db::save_bookmark(&db, &req.simulado_id, &req.question_hash, &req.enunciado, &req.category).await {
        Ok(_) => HttpResponse::Created().json(json!({"message": "Favorito adicionado/atualizado."})),
        Err(e) => {
            error!("Failed to save bookmark: {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[delete("/bookmark")]
pub async fn handle_bookmark_delete(
    db: web::Data<db::DbPool>,
    req: web::Json<BookmarkDeleteRequest>,
) -> impl Responder {
    match db::delete_bookmark(&db, &req.simulado_id, &req.question_hash).await {
        Ok(_) => HttpResponse::Ok().json(json!({"message": "Favorito removido."})),
        Err(e) => {
            error!("Failed to delete bookmark: {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[post("/theme")]
pub async fn handle_theme_post(
    db: web::Data<db::DbPool>,
    req: web::Json<ThemeRequest>,
) -> impl Responder {
     if req.theme != "light" && req.theme != "dark" {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid theme"}));
    }
    match db::save_theme(&db, &req.theme).await {
        Ok(_) => HttpResponse::Ok().json(json!({"message": "Theme updated"})),
        Err(e) => {
            error!("Failed to save theme: {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[get("/theme")]
pub async fn handle_theme_get(db: web::Data<db::DbPool>) -> impl Responder {
    match db::get_theme(&db).await {
        Ok(theme) => HttpResponse::Ok().json(ThemeResponse { theme }),
        Err(e) => {
            error!("Failed to get theme: {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[post("/progress/{simulado_id}")]
pub async fn handle_progress_post(
    db: web::Data<db::DbPool>,
    path: web::Path<String>,
    progress: web::Json<serde_json::Value>,
) -> impl Responder {
    let simulado_id = path.into_inner();
    match db::save_progress(&db, &simulado_id, &progress).await {
        Ok(_) => HttpResponse::Ok().json(json!({"message": "Progress saved"})),
        Err(e) => {
            error!("Failed to save progress for {}: {:?}", simulado_id, e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[get("/progress/{simulado_id}")]
pub async fn handle_progress_get(
    db: web::Data<db::DbPool>,
    path: web::Path<String>,
) -> impl Responder {
    let simulado_id = path.into_inner();
    match db::get_progress(&db, &simulado_id).await {
        Ok(Some(progress)) => HttpResponse::Ok().json(progress),
        Ok(None) => HttpResponse::Ok().json(json!({})),
        Err(e) => {
            error!("Failed to get progress for {}: {:?}", simulado_id, e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[delete("/progress/{simulado_id}")]
pub async fn handle_progress_delete(
    db: web::Data<db::DbPool>,
    path: web::Path<String>,
) -> impl Responder {
    let simulado_id = path.into_inner();
    match db::delete_progress(&db, &simulado_id).await {
        Ok(_) => HttpResponse::Ok().json(json!({"message": "Progress deleted"})),
        Err(e) => {
            error!("Failed to delete progress for {}: {:?}", simulado_id, e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[get("/progress")]
pub async fn get_all_progress(
    db: web::Data<db::DbPool>,
    store: web::Data<Arc<simulado_store::SimuladoStore>>,
) -> impl Responder {
    match db::get_all_progress(&db, &store).await {
        Ok(progress) => HttpResponse::Ok().json(progress),
        Err(e) => {
            error!("Failed to get all user progress: {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[get("/bookmarks")]
pub async fn get_bookmarks(db: web::Data<db::DbPool>) -> impl Responder {
    match db::get_bookmarks(&db).await {
        Ok(bookmarks) => HttpResponse::Ok().json(bookmarks),
        Err(e) => {
            error!("Failed to get all bookmarks: {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}

// FIX: Path is now relative
#[get("/incorrect_answers")]
pub async fn get_incorrect_answers(db: web::Data<db::DbPool>) -> impl Responder {
    match db::get_incorrect_answers(&db).await {
        Ok(answers) => HttpResponse::Ok().json(answers),
        Err(e) => {
            error!("Failed to get incorrect answers: {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": format!("DB error: {}", e)}))
        }
    }
}