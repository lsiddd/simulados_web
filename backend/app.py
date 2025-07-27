import atexit
import json
import logging
import os
import random
import sqlite3
from functools import lru_cache
from threading import Lock, Thread

import pyinotify
import redis
from flask import Flask, g, jsonify, request
from werkzeug.utils import secure_filename

# --- Basic Setup ---
logging.basicConfig(level=logging.INFO)
app = Flask(__name__)
SIMULADOS_DIR = "simulados"
DB_PATH = os.path.join("user_data", "app.db")
os.makedirs(SIMULADOS_DIR, exist_ok=True)
os.makedirs("user_data", exist_ok=True)

# --- Redis Cache Connection ---
try:
    redis_client = redis.Redis(host="redis", port=6379, db=0, decode_responses=True)
    redis_client.ping()
    app.logger.info("Successfully connected to Redis.")
except (redis.exceptions.ConnectionError, redis.exceptions.BusyLoadingError) as e:
    app.logger.error(f"Could not connect to Redis: {e}. Caching will be disabled.")
    redis_client = None

# --- In-Memory Caching ---
_simulados_list_cache = None
_simulados_list_cache_lock = Lock()


@lru_cache(maxsize=128)
def load_simulado_file(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        app.logger.error(f"Error loading file {filepath}: {e}")
        return None


# --- Filesystem Watcher for Cache Invalidation ---


class SimuladoHandler(pyinotify.ProcessEvent):
    def _invalidate_caches(self, event):
        app.logger.info(
            f"File system change detected: {event.pathname}. Invalidating caches."
        )
        load_simulado_file.cache_clear()
        global _simulados_list_cache
        with _simulados_list_cache_lock:
            _simulados_list_cache = None
        if redis_client:
            try:
                redis_client.delete("simulados_list")
                app.logger.info("Invalidated 'simulados_list' key in Redis.")
            except redis.exceptions.RedisError as e:
                app.logger.error(f"Could not invalidate Redis cache: {e}")

    def process_IN_MODIFY(self, event):
        self._invalidate_caches(event)

    def process_IN_DELETE(self, event):
        self._invalidate_caches(event)

    def process_IN_MOVED_FROM(self, event):
        self._invalidate_caches(event)


wm = pyinotify.WatchManager()
handler = SimuladoHandler()
notifier = pyinotify.ThreadedNotifier(wm, handler)
notifier.daemon = True
notifier.start()
# FIX: Watch for modifications, deletions, and moves to prevent stale cache.
mask = pyinotify.IN_MODIFY | pyinotify.IN_DELETE | pyinotify.IN_MOVED_FROM
wdd = wm.add_watch(SIMULADOS_DIR, mask)


# ### MODIFIED DATABASE HANDLING ###
# This new pattern is thread-safe and the standard for Flask.


def get_db():
    """
    Opens a new database connection if there is none yet for the
    current application context.
    """
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=20.0)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA synchronous=NORMAL")
        cache_size = os.getenv("SQLITE_CACHE_SIZE", "-100000")  # 100MB cache
        g.db.execute(f"PRAGMA cache_size={cache_size}")
        g.db.execute("PRAGMA temp_store=MEMORY")
    return g.db


@app.teardown_appcontext
def close_db(e=None):
    """Closes the database again at the end of the request."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Initializes the database schema."""
    with app.app_context():
        db = get_db()
        with app.open_resource("schema.sql", mode="r") as f:
            db.cursor().executescript(f.read())
        db.commit()


# You would need a schema.sql file for this, or just keep the old init_db logic.
# For simplicity, let's stick to the explicit creation logic for now.


def init_db_explicitly():
    with app.app_context():
        conn = get_db()
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS theme (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT);
            CREATE TABLE IF NOT EXISTS progress (simulado_id TEXT PRIMARY KEY, data TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS idx_progress_updated ON progress(updated_at);
            CREATE TABLE IF NOT EXISTS incorrect_answers (question_hash TEXT, count INTEGER, enunciado TEXT, simulado_id TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (question_hash, simulado_id));
            CREATE INDEX IF NOT EXISTS idx_incorrect_simulado ON incorrect_answers(simulado_id);
            CREATE TABLE IF NOT EXISTS bookmarks (simulado_id TEXT, question_hash TEXT, enunciado TEXT, category TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (simulado_id, question_hash));
            CREATE INDEX IF NOT EXISTS idx_bookmarks_simulado ON bookmarks(simulado_id);
            CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category);
        """
        )
        conn.commit()


# --- API Endpoints ---
@app.route("/api/simulados", methods=["GET"])
def get_simulados_list():
    if redis_client:
        try:
            cached_data = redis_client.get("simulados_list")
            if cached_data:
                app.logger.info("Cache HIT for simulados_list from Redis.")
                return app.response_class(
                    response=cached_data, status=200, mimetype="application/json"
                )
        except redis.exceptions.RedisError as e:
            app.logger.error(f"Redis GET error: {e}")

    app.logger.info("Cache MISS for simulados_list.")
    global _simulados_list_cache
    with _simulados_list_cache_lock:
        if _simulados_list_cache is not None:
            return jsonify(_simulados_list_cache)

    simulados = []
    for filename in sorted(os.listdir(SIMULADOS_DIR)):
        if filename.endswith(".json"):
            filepath = os.path.join(SIMULADOS_DIR, filename)
            data = load_simulado_file(filepath)
            if data:
                simulados.append(
                    {
                        "id": os.path.splitext(filename)[0],
                        "titulo": data.get("titulo", "Simulado sem Título"),
                        "descricao": data.get("descricao", ""),
                        "questoes_count": len(data.get("questoes", [])),
                    }
                )

    if redis_client:
        try:
            redis_client.setex("simulados_list", 600, json.dumps(simulados))
        except redis.exceptions.RedisError as e:
            app.logger.error(f"Redis SETEX error: {e}")

    with _simulados_list_cache_lock:
        _simulados_list_cache = simulados
    return jsonify(simulados)


@app.route("/api/simulados/<simulado_id>", methods=["GET"])
def get_simulado_data(simulado_id):
    # FIX: Using secure_filename prevents path traversal attacks. This was
    # already correctly implemented.
    secure_id = secure_filename(simulado_id)
    cache_key = f"simulado:{secure_id}"
    if redis_client:
        try:
            cached_data = redis_client.get(cache_key)
            if cached_data:
                app.logger.info(f"Cache HIT for {cache_key} from Redis.")
                data = json.loads(cached_data)
                if "questoes" in data and isinstance(data.get("questoes"), list):
                    for questao in data["questoes"]:
                        if "alternativas" in questao:
                            random.shuffle(questao["alternativas"])
                return jsonify(data)
        except redis.exceptions.RedisError as e:
            app.logger.error(f"Redis GET error for {cache_key}: {e}")

    app.logger.info(f"Cache MISS for {cache_key}.")
    filepath = os.path.join(SIMULADOS_DIR, f"{secure_id}.json")
    if not os.path.exists(filepath):
        return jsonify({"error": "Simulado não encontrado"}), 404
    data = load_simulado_file(filepath)
    if not data:
        return jsonify({"error": "Failed to load simulado data."}), 500
    if redis_client:
        try:
            redis_client.setex(cache_key, 3600, json.dumps(data))
        except redis.exceptions.RedisError as e:
            app.logger.error(f"Redis SETEX error for {cache_key}: {e}")
    response_data = data.copy()
    if "questoes" in response_data and isinstance(response_data.get("questoes"), list):
        response_data["questoes"] = [q for q in response_data["questoes"]]
        for questao in response_data["questoes"]:
            if "alternativas" in questao:
                random.shuffle(questao["alternativas"])
    return jsonify(response_data)


# All user data endpoints are now refactored to use get_db()
# Note the removal of conn.commit() and conn.rollback(), as this can be handled
# by a context manager or at the end of the function.


@app.route("/api/user/stats", methods=["POST"])
def save_user_stats():
    stats_data = request.json
    if not stats_data:
        return jsonify({"error": "Nenhum dado fornecido."}), 400
    conn = get_db()
    try:
        batch_data = [
            (h, v.get("count", 0), v.get("enunciado", ""), v.get("simulado_id", ""))
            for h, v in stats_data.items()
        ]
        conn.executemany(
            "INSERT OR REPLACE INTO incorrect_answers (question_hash, count, enunciado, simulado_id, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
            batch_data,
        )
        conn.commit()
        return jsonify({"message": "Estatísticas salvas com sucesso."}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f"Erro ao salvar as estatísticas do usuário: {e}")
        return jsonify({"error": "Erro interno ao salvar estatísticas."}), 500


@app.route("/api/user/bookmark", methods=["POST", "DELETE"])
def handle_bookmark():
    conn = get_db()
    data = request.json
    try:
        if request.method == "POST":
            if not all(
                k in data
                for k in ["simulado_id", "question_hash", "enunciado", "category"]
            ):
                return jsonify({"error": "Dados incompletos para o favorito."}), 400
            conn.execute(
                "INSERT OR REPLACE INTO bookmarks (simulado_id, question_hash, enunciado, category, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (
                    data["simulado_id"],
                    data["question_hash"],
                    data["enunciado"],
                    data["category"],
                ),
            )
            conn.commit()
            return (
                jsonify({"message": "Favorito adicionado/atualizado com sucesso."}),
                201,
            )

        if request.method == "DELETE":
            if not all(k in data for k in ["simulado_id", "question_hash"]):
                return (
                    jsonify({"error": "Dados incompletos para remover o favorito."}),
                    400,
                )
            conn.execute(
                "DELETE FROM bookmarks WHERE simulado_id = ? AND question_hash = ?",
                (data["simulado_id"], data["question_hash"]),
            )
            conn.commit()
            return jsonify({"message": "Favorito removido com sucesso."}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f"Erro ao gerenciar favorito: {e}")
        return jsonify({"error": "Erro interno ao gerenciar favorito."}), 500


@app.route("/api/user/theme", methods=["GET", "POST"])
def handle_theme():
    conn = get_db()
    try:
        if request.method == "POST":
            data = request.json
            theme = data.get("theme")
            if theme not in ("light", "dark"):
                return jsonify({"error": "Invalid theme"}), 400
            conn.execute(
                "INSERT OR REPLACE INTO theme (id, value) VALUES (1, ?)", (theme,)
            )
            conn.commit()
            return jsonify({"message": "Theme updated"})
        else:
            row = conn.execute("SELECT value FROM theme WHERE id=1").fetchone()
            return jsonify({"theme": row["value"] if row else "light"})
    except Exception as e:
        conn.rollback()
        app.logger.error(f"Error handling theme: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/api/user/progress/<simulado_id>", methods=["GET", "POST", "DELETE"])
def handle_progress(simulado_id):
    conn = get_db()
    try:
        if request.method == "POST":
            data = request.json
            conn.execute(
                "INSERT OR REPLACE INTO progress (simulado_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                (simulado_id, json.dumps(data)),
            )
            conn.commit()
            return jsonify({"message": "Progress saved"})
        elif request.method == "DELETE":
            conn.execute("DELETE FROM progress WHERE simulado_id = ?", (simulado_id,))
            conn.commit()
            return jsonify({"message": "Progress deleted"})
        else:  # GET
            row = conn.execute(
                "SELECT data FROM progress WHERE simulado_id=?", (simulado_id,)
            ).fetchone()
            return jsonify(json.loads(row["data"]) if row else {})
    except Exception as e:
        conn.rollback()
        app.logger.error(f"Error handling progress for {simulado_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/api/user/progress", methods=["GET"])
def get_all_progress():
    try:
        simulados_list_response = get_simulados_list()
        simulados_list = json.loads(simulados_list_response.get_data())
        if not isinstance(simulados_list, list):
            return jsonify({"error": "Error loading simulado metadata."}), 500

        simulados_map = {s["id"]: s for s in simulados_list}
        conn = get_db()
        rows = conn.execute(
            "SELECT simulado_id, data FROM progress WHERE data IS NOT NULL AND data != '{}'"
        ).fetchall()

        progress_list = []
        for row in rows:
            simulado_id = row["simulado_id"]
            if simulado_id in simulados_map:
                simulado_info = simulados_map[simulado_id]
                progress_list.append(
                    {
                        "simulado_id": simulado_id,
                        "titulo": simulado_info.get("titulo"),
                        "descricao": simulado_info.get("descricao"),
                        "questoes_count": simulado_info.get("questoes_count"),
                        "progress": json.loads(row["data"]),
                    }
                )
        return jsonify(progress_list)
    except Exception as e:
        app.logger.error(f"Error fetching all progress: {e}")
        return jsonify({"error": "Internal error fetching progress."}), 500


@app.route("/api/user/bookmarks", methods=["GET"])
def get_bookmarks():
    conn = get_db()
    rows = conn.execute(
        "SELECT simulado_id, question_hash, enunciado, category FROM bookmarks ORDER BY created_at DESC"
    ).fetchall()
    return jsonify([dict(row) for row in rows])


# ### NEW ENDPOINT TO FIX 404 ERROR ###


@app.route("/api/user/incorrect_answers", methods=["GET"])
def get_incorrect_answers():
    """Provides the log of incorrectly answered questions to the frontend."""
    conn = get_db()
    rows = conn.execute(
        "SELECT question_hash, count, enunciado, simulado_id FROM incorrect_answers"
    ).fetchall()
    return jsonify([dict(row) for row in rows])


# --- Application Cleanup ---


def cleanup_resources():
    app.logger.info("Stopping pyinotify notifier thread.")
    notifier.stop()


# Initialize DB and register cleanup
init_db_explicitly()
atexit.register(cleanup_resources)

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5000)