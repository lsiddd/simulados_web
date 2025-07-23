import json
import logging
import os
import random
import sqlite3

from flask import Flask, jsonify, request
from werkzeug.utils import secure_filename

# Configuração do logging
logging.basicConfig(level=logging.INFO)

app = Flask(__name__)
# O CORS foi removido, pois o Nginx agora gerencia o proxy reverso.

SIMULADOS_DIR = "simulados"

DB_PATH = os.path.join("user_data", "app.db")

# Ensure user_data directory exists
os.makedirs("user_data", exist_ok=True)

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()
    # Table for theme (single user)
    c.execute('''CREATE TABLE IF NOT EXISTS theme (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value TEXT
    )''')
    # Table for simulado progress
    c.execute('''CREATE TABLE IF NOT EXISTS progress (
        simulado_id TEXT PRIMARY KEY,
        data TEXT
    )''')
    # Table for incorrect answers log
    c.execute('''CREATE TABLE IF NOT EXISTS incorrect_answers (
        question_hash TEXT PRIMARY KEY,
        count INTEGER,
        enunciado TEXT,
        simulado_id TEXT
    )''')
    # Table for bookmarks
    c.execute('''CREATE TABLE IF NOT EXISTS bookmarks (
        simulado_id TEXT,
        question_hash TEXT,
        enunciado TEXT,
        category TEXT,
        PRIMARY KEY (simulado_id, question_hash)
    )''')
    conn.commit()
    conn.close()

init_db()


@app.route("/api/simulados", methods=["GET"])
def get_simulados_list():
    """API endpoint para listar os simulados disponíveis."""
    simulados = []
    if not os.path.exists(SIMULADOS_DIR):
        app.logger.error("Diretório de simulados não encontrado.")
        return jsonify({"error": "Erro interno ao carregar simulados."}), 500

    for filename in sorted(os.listdir(SIMULADOS_DIR)):
        if filename.endswith(".json"):
            filepath = os.path.join(SIMULADOS_DIR, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    simulados.append(
                        {
                            "id": os.path.splitext(filename)[0],
                            "titulo": data.get("titulo", "Simulado sem Título"),
                            "descricao": data.get("descricao", ""),
                            "questoes_count": len(data.get("questoes", [])),
                        }
                    )
            except Exception as e:
                app.logger.error(f"Erro ao carregar o arquivo {filename}: {e}")

    return jsonify(simulados)


@app.route("/api/simulados/<simulado_id>", methods=["GET"])
def get_simulado_data(simulado_id):
    """API endpoint para obter os dados de um simulado específico."""
    # PREVENÇÃO DE PATH TRAVERSAL: Garante que o ID seja apenas um nome de arquivo.
    secure_id = secure_filename(simulado_id)
    filepath = os.path.join(SIMULADOS_DIR, f"{secure_id}.json")

    if not os.path.exists(filepath):
        return jsonify({"error": "Simulado não encontrado"}), 404

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            if "questoes" in data and isinstance(data["questoes"], list):
                # random.shuffle(data["questoes"])
                for questao in data["questoes"]:
                    if "alternativas" in questao:
                        random.shuffle(questao["alternativas"])
            return jsonify(data)
    except Exception as e:
        # Tratamento de erro genérico para não expor detalhes.
        app.logger.error(f"Erro ao processar o arquivo {secure_id}.json: {e}")
        return (
            jsonify({"error": "Não foi possível processar os dados do simulado."}),
            500,
        )


@app.route("/api/user/stats", methods=["POST"])
def save_user_stats():
    """API endpoint para salvar as estatísticas de respostas incorretas do usuário."""
    stats_data = request.json
    if not stats_data:
        return jsonify({"error": "Nenhum dado fornecido."}), 400

    # Define o caminho para o arquivo de estatísticas
    stats_dir = "user_data"
    os.makedirs(stats_dir, exist_ok=True)
    stats_file = os.path.join(stats_dir, "user_stats.json")

    try:
        # Tenta carregar dados existentes
        if os.path.exists(stats_file):
            with open(stats_file, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
        else:
            existing_data = {}

        # Atualiza os dados existentes com os novos dados
        for key, value in stats_data.items():
            if key in existing_data:
                existing_data[key]["count"] += value.get("count", 0)
            else:
                existing_data[key] = value

        # Salva os dados atualizados
        with open(stats_file, "w", encoding="utf-8") as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=4)

        return jsonify({"message": "Estatísticas salvas com sucesso."}), 200

    except Exception as e:
        app.logger.error(f"Erro ao salvar as estatísticas do usuário: {e}")
        return jsonify({"error": "Erro interno ao salvar estatísticas."}), 500

@app.route("/api/user/theme", methods=["GET"])
def get_theme():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT value FROM theme WHERE id=1")
    row = c.fetchone()
    conn.close()
    if row:
        return jsonify({"theme": row[0]})
    else:
        return jsonify({"theme": "light"})

@app.route("/api/user/theme", methods=["POST"])
def set_theme():
    data = request.json
    theme = data.get("theme")
    if theme not in ("light", "dark"):
        return jsonify({"error": "Invalid theme"}), 400
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO theme (id, value) VALUES (1, ?)", (theme,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Theme updated"})

@app.route("/api/user/progress/<simulado_id>", methods=["GET"])
def get_progress(simulado_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT data FROM progress WHERE simulado_id=?", (simulado_id,))
    row = c.fetchone()
    conn.close()
    if row:
        return jsonify(json.loads(row[0]))
    else:
        return jsonify({}), 404

@app.route("/api/user/progress/<simulado_id>", methods=["POST"])
def set_progress(simulado_id):
    data = request.json
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO progress (simulado_id, data) VALUES (?, ?)", (simulado_id, json.dumps(data)))
    conn.commit()
    conn.close()
    return jsonify({"message": "Progress saved"})

@app.route("/api/user/incorrect_answers", methods=["GET"])
def get_incorrect_answers():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT question_hash, count, enunciado, simulado_id FROM incorrect_answers")
    rows = c.fetchall()
    conn.close()
    return jsonify([{k: row[k] for k in row.keys()} for row in rows])

@app.route("/api/user/incorrect_answers", methods=["POST"])
def set_incorrect_answers():
    data = request.json  # Should be a dict of {question_hash: {count, enunciado, simulado_id}}
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid data"}), 400
    conn = get_db_connection()
    c = conn.cursor()
    for qh, v in data.items():
        c.execute("INSERT OR REPLACE INTO incorrect_answers (question_hash, count, enunciado, simulado_id) VALUES (?, ?, ?, ?)", (qh, v.get("count", 0), v.get("enunciado", ""), v.get("simulado_id", "")))
    conn.commit()
    conn.close()
    return jsonify({"message": "Incorrect answers log updated"})

@app.route("/api/user/bookmarks", methods=["GET"])
def get_bookmarks():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT simulado_id, question_hash, enunciado, category FROM bookmarks")
    rows = c.fetchall()
    conn.close()
    return jsonify([{k: row[k] for k in row.keys()} for row in rows])

@app.route("/api/user/bookmarks", methods=["POST"])
def set_bookmarks():
    data = request.json  # Should be a list of {simulado_id, question_hash, enunciado, category}
    if not isinstance(data, list):
        return jsonify({"error": "Invalid data"}), 400
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM bookmarks")  # Replace all bookmarks for single user
    for b in data:
        c.execute("INSERT OR REPLACE INTO bookmarks (simulado_id, question_hash, enunciado, category) VALUES (?, ?, ?, ?)", (b.get("simulado_id", ""), b.get("question_hash", ""), b.get("enunciado", ""), b.get("category", "")))
    conn.commit()
    conn.close()
    return jsonify({"message": "Bookmarks updated"})