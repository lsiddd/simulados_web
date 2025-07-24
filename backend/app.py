import json
import logging
import os
import random
import sqlite3
import hashlib
import gzip
from functools import lru_cache
from threading import RLock
from datetime import datetime, timedelta

from flask import Flask, jsonify, request, g
from werkzeug.utils import secure_filename

# Configuração do logging
logging.basicConfig(level=logging.INFO)

app = Flask(__name__)

SIMULADOS_DIR = "simulados"
DB_PATH = os.path.join("user_data", "app.db")

# Ensure user_data directory exists
os.makedirs("user_data", exist_ok=True)

# OPTIMIZATION 1: In-memory caching with thread safety
_cache_lock = RLock()
_simulados_cache = {}
_simulados_list_cache = None
_cache_timestamps = {}
CACHE_TTL = 300  # 5 minutes cache TTL

# OPTIMIZATION 2: Database connection pooling simulation
_db_connections = []
_max_connections = 10

def get_db_connection():
    """Optimized database connection with basic pooling"""
    if _db_connections:
        conn = _db_connections.pop()
        try:
            # Test if connection is still valid
            conn.execute("SELECT 1")
            return conn
        except:
            conn.close()
    
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    # OPTIMIZATION: Enable WAL mode for better concurrent access
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=10000")
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn

def return_db_connection(conn):
    """Return connection to pool"""
    if len(_db_connections) < _max_connections:
        _db_connections.append(conn)
    else:
        conn.close()

def init_db():
    conn = get_db_connection()
    c = conn.cursor()
    
    # OPTIMIZATION 3: Improved database schema with indexes
    c.execute('''CREATE TABLE IF NOT EXISTS theme (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value TEXT
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS progress (
        simulado_id TEXT PRIMARY KEY,
        data TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_progress_updated ON progress(updated_at)')
    
    c.execute('''CREATE TABLE IF NOT EXISTS incorrect_answers (
        question_hash TEXT PRIMARY KEY,
        count INTEGER,
        enunciado TEXT,
        simulado_id TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_incorrect_simulado ON incorrect_answers(simulado_id)')
    
    c.execute('''CREATE TABLE IF NOT EXISTS bookmarks (
        simulado_id TEXT,
        question_hash TEXT,
        enunciado TEXT,
        category TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (simulado_id, question_hash)
    )''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_bookmarks_simulado ON bookmarks(simulado_id)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category)')
    
    conn.commit()
    return_db_connection(conn)

init_db()

def get_file_hash(filepath):
    """Generate hash of file for cache invalidation"""
    try:
        with open(filepath, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()
    except:
        return None

@lru_cache(maxsize=128)
def load_simulado_file(filepath, file_hash):
    """Cached file loading with hash-based invalidation"""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        app.logger.error(f"Error loading file {filepath}: {e}")
        return None

def is_cache_valid(cache_key):
    """Check if cache entry is still valid"""
    if cache_key not in _cache_timestamps:
        return False
    return datetime.now() - _cache_timestamps[cache_key] < timedelta(seconds=CACHE_TTL)

@app.route("/api/user/progress", methods=["GET"])
def get_all_progress():
    """
    CORREÇÃO: Novo endpoint para buscar todos os progressos salvos
    e mesclá-los com os metadados dos simulados.
    """
    conn = get_db_connection()
    try:
        # Primeiro, obtemos a lista de todos os simulados disponíveis (usando o cache existente)
        simulados_response = get_simulados_list()
        simulados_list = simulados_response.get_json()
        simulados_map = {s['id']: s for s in simulados_list}

        # Em seguida, buscamos todos os registros de progresso do banco de dados
        c = conn.cursor()
        c.execute("SELECT simulado_id, data FROM progress WHERE data IS NOT NULL AND data != '{}'")
        rows = c.fetchall()
        
        progress_list = []
        for row in rows:
            simulado_id = row['simulado_id']
            # Verificamos se o simulado para o progresso salvo ainda existe
            if simulado_id in simulados_map:
                try:
                    progress_data = json.loads(row['data'])
                    simulado_info = simulados_map[simulado_id]
                    
                    # Montamos um objeto completo para o frontend
                    progress_list.append({
                        "simulado_id": simulado_id,
                        "titulo": simulado_info.get('titulo', 'Título Indisponível'),
                        "descricao": simulado_info.get('descricao', ''),
                        "questoes_count": simulado_info.get('questoes_count', 0),
                        "progress": progress_data
                    })
                except json.JSONDecodeError:
                    app.logger.error(f"Erro ao decodificar o progresso JSON para o simulado {simulado_id}")
        
        return jsonify(progress_list)
    except Exception as e:
        app.logger.error(f"Erro ao buscar todos os progressos: {e}")
        return jsonify({"error": "Erro interno ao buscar progressos."}), 500
    finally:
        return_db_connection(conn)

@app.route("/api/simulados", methods=["GET"])
def get_simulados_list():
    """OPTIMIZED: API endpoint para listar os simulados disponíveis com caching."""
    global _simulados_list_cache
    
    with _cache_lock:
        # Check if we have a valid cache
        if _simulados_list_cache and is_cache_valid('simulados_list'):
            return jsonify(_simulados_list_cache)
    
    simulados = []
    if not os.path.exists(SIMULADOS_DIR):
        app.logger.error("Diretório de simulados não encontrado.")
        return jsonify({"error": "Erro interno ao carregar simulados."}), 500

    # OPTIMIZATION 4: Batch process files and use metadata when possible
    files_to_process = []
    for filename in sorted(os.listdir(SIMULADOS_DIR)):
        if filename.endswith(".json"):
            filepath = os.path.join(SIMULADOS_DIR, filename)
            files_to_process.append((filename, filepath))
    
    # Process files in batch
    for filename, filepath in files_to_process:
        try:
            file_hash = get_file_hash(filepath)
            data = load_simulado_file(filepath, file_hash)
            
            if data:
                simulado_entry = {
                    "id": os.path.splitext(filename)[0],
                    "titulo": data.get("titulo", "Simulado sem Título"),
                    "descricao": data.get("descricao", ""),
                    "questoes_count": len(data.get("questoes", [])),
                }
                simulados.append(simulado_entry)
        except Exception as e:
            app.logger.error(f"Erro ao carregar o arquivo {filename}: {e}")
    
    # Update cache
    with _cache_lock:
        _simulados_list_cache = simulados
        _cache_timestamps['simulados_list'] = datetime.now()
    
    return jsonify(simulados)

@app.route("/api/simulados/<simulado_id>", methods=["GET"])
def get_simulado_data(simulado_id):
    """OPTIMIZED: API endpoint para obter os dados de um simulado específico com caching."""
    secure_id = secure_filename(simulado_id)
    filepath = os.path.join(SIMULADOS_DIR, f"{secure_id}.json")

    if not os.path.exists(filepath):
        return jsonify({"error": "Simulado não encontrado"}), 404

    # Check cache first
    with _cache_lock:
        if secure_id in _simulados_cache and is_cache_valid(f'simulado_{secure_id}'):
            cached_data = _simulados_cache[secure_id].copy()
            # Apply randomization to cached data
            if "questoes" in cached_data:
                for questao in cached_data["questoes"]:
                    if "alternativas" in questao:
                        random.shuffle(questao["alternativas"])
            return jsonify(cached_data)

    try:
        file_hash = get_file_hash(filepath)
        data = load_simulado_file(filepath, file_hash)
        
        if not data:
            return jsonify({"error": "Não foi possível processar os dados do simulado."}), 500
        
        # Cache the original data (before randomization)
        with _cache_lock:
            _simulados_cache[secure_id] = data.copy()
            _cache_timestamps[f'simulado_{secure_id}'] = datetime.now()
        
        # Apply randomization to response data
        if "questoes" in data and isinstance(data["questoes"], list):
            for questao in data["questoes"]:
                if "alternativas" in questao:
                    random.shuffle(questao["alternativas"])
        
        return jsonify(data)
        
    except Exception as e:
        app.logger.error(f"Erro ao processar o arquivo {secure_id}.json: {e}")
        return jsonify({"error": "Não foi possível processar os dados do simulado."}), 500

@app.route("/api/user/stats", methods=["POST"])
def save_user_stats():
    """OPTIMIZED: API endpoint para salvar as estatísticas de respostas incorretas do usuário."""
    stats_data = request.json
    if not stats_data:
        return jsonify({"error": "Nenhum dado fornecido."}), 400

    # OPTIMIZATION 5: Use database instead of file for better performance
    conn = get_db_connection()
    try:
        c = conn.cursor()
        for question_hash, value in stats_data.items():
            c.execute('''INSERT OR REPLACE INTO incorrect_answers 
                        (question_hash, count, enunciado, simulado_id, updated_at) 
                        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)''',
                     (question_hash, value.get("count", 0), 
                      value.get("enunciado", ""), value.get("simulado_id", "")))
        conn.commit()
        return jsonify({"message": "Estatísticas salvas com sucesso."}), 200
    except Exception as e:
        app.logger.error(f"Erro ao salvar as estatísticas do usuário: {e}")
        return jsonify({"error": "Erro interno ao salvar estatísticas."}), 500
    finally:
        return_db_connection(conn)

@app.route("/api/user/theme", methods=["GET"])
def get_theme():
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("SELECT value FROM theme WHERE id=1")
        row = c.fetchone()
        if row:
            return jsonify({"theme": row[0]})
        else:
            return jsonify({"theme": "light"})
    finally:
        return_db_connection(conn)

@app.route("/api/user/theme", methods=["POST"])
def set_theme():
    data = request.json
    theme = data.get("theme")
    if theme not in ("light", "dark"):
        return jsonify({"error": "Invalid theme"}), 400
    
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("INSERT OR REPLACE INTO theme (id, value) VALUES (1, ?)", (theme,))
        conn.commit()
        return jsonify({"message": "Theme updated"})
    finally:
        return_db_connection(conn)

@app.route("/api/user/progress/<simulado_id>", methods=["GET"])
def get_progress(simulado_id):
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("SELECT data FROM progress WHERE simulado_id=?", (simulado_id,))
        row = c.fetchone()
        if row:
            return jsonify(json.loads(row[0]))
        else:
            return jsonify({}), 404
    finally:
        return_db_connection(conn)

@app.route("/api/user/progress/<simulado_id>", methods=["POST"])
def set_progress(simulado_id):
    data = request.json
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute('''INSERT OR REPLACE INTO progress 
                    (simulado_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)''',
                 (simulado_id, json.dumps(data)))
        conn.commit()
        return jsonify({"message": "Progress saved"})
    finally:
        return_db_connection(conn)

@app.route("/api/user/incorrect_answers", methods=["GET"])
def get_incorrect_answers():
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute('''SELECT question_hash, count, enunciado, simulado_id 
                    FROM incorrect_answers ORDER BY updated_at DESC''')
        rows = c.fetchall()
        return jsonify([{k: row[k] for k in row.keys()} for row in rows])
    finally:
        return_db_connection(conn)

@app.route("/api/user/incorrect_answers", methods=["POST"])
def set_incorrect_answers():
    data = request.json
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid data"}), 400
    
    conn = get_db_connection()
    try:
        c = conn.cursor()
        # OPTIMIZATION 6: Batch insert with executemany
        batch_data = []
        for qh, v in data.items():
            batch_data.append((qh, v.get("count", 0), v.get("enunciado", ""), v.get("simulado_id", "")))
        
        c.executemany('''INSERT OR REPLACE INTO incorrect_answers 
                        (question_hash, count, enunciado, simulado_id, updated_at) 
                        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)''', batch_data)
        conn.commit()
        return jsonify({"message": "Incorrect answers log updated"})
    finally:
        return_db_connection(conn)

@app.route("/api/user/bookmarks", methods=["GET"])
def get_bookmarks():
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute('''SELECT simulado_id, question_hash, enunciado, category 
                    FROM bookmarks ORDER BY created_at DESC''')
        rows = c.fetchall()
        return jsonify([{k: row[k] for k in row.keys()} for row in rows])
    finally:
        return_db_connection(conn)

@app.route("/api/user/bookmarks", methods=["POST"])
def set_bookmarks():
    data = request.json
    if not isinstance(data, list):
        return jsonify({"error": "Invalid data"}), 400
    
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("DELETE FROM bookmarks")  # Replace all bookmarks for single user
        
        # OPTIMIZATION 6: Batch insert
        if data:
            batch_data = []
            for b in data:
                batch_data.append((b.get("simulado_id", ""), b.get("question_hash", ""), 
                                 b.get("enunciado", ""), b.get("category", "")))
            
            c.executemany('''INSERT INTO bookmarks 
                           (simulado_id, question_hash, enunciado, category, created_at) 
                           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)''', batch_data)
        
        conn.commit()
        return jsonify({"message": "Bookmarks updated"})
    finally:
        return_db_connection(conn)

# OPTIMIZATION 7: Cache cleanup endpoint (for development/maintenance)
@app.route("/api/admin/clear-cache", methods=["POST"])
def clear_cache():
    global _simulados_cache, _simulados_list_cache, _cache_timestamps
    with _cache_lock:
        _simulados_cache.clear()
        _simulados_list_cache = None
        _cache_timestamps.clear()
        # Clear LRU cache
        load_simulado_file.cache_clear()
    return jsonify({"message": "Cache cleared"})

# OPTIMIZATION 8: Graceful shutdown for connection cleanup
import atexit

def cleanup_connections():
    """Clean up database connections on shutdown"""
    while _db_connections:
        conn = _db_connections.pop()
        try:
            conn.close()
        except:
            pass

atexit.register(cleanup_connections)

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5000)