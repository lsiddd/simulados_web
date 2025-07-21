import os
import json
import random
import logging
from flask import Flask, jsonify
from werkzeug.utils import secure_filename

# Configuração do logging
logging.basicConfig(level=logging.INFO)

app = Flask(__name__)
# O CORS foi removido, pois o Nginx agora gerencia o proxy reverso.

SIMULADOS_DIR = 'simulados'

@app.route('/api/simulados', methods=['GET'])
def get_simulados_list():
    """API endpoint para listar os simulados disponíveis."""
    simulados = []
    if not os.path.exists(SIMULADOS_DIR):
        app.logger.error("Diretório de simulados não encontrado.")
        return jsonify({"error": "Erro interno ao carregar simulados."}), 500
        
    for filename in sorted(os.listdir(SIMULADOS_DIR)):
        if filename.endswith('.json'):
            filepath = os.path.join(SIMULADOS_DIR, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    simulados.append({
                        'id': os.path.splitext(filename)[0],
                        'titulo': data.get('titulo', 'Simulado sem Título'),
                        'descricao': data.get('descricao', ''),
                        'questoes_count': len(data.get('questoes', []))
                    })
            except Exception as e:
                app.logger.error(f"Erro ao carregar o arquivo {filename}: {e}")
                
    return jsonify(simulados)

@app.route('/api/simulados/<simulado_id>', methods=['GET'])
def get_simulado_data(simulado_id):
    """API endpoint para obter os dados de um simulado específico."""
    # PREVENÇÃO DE PATH TRAVERSAL: Garante que o ID seja apenas um nome de arquivo.
    secure_id = secure_filename(simulado_id)
    filepath = os.path.join(SIMULADOS_DIR, f"{secure_id}.json")
    
    if not os.path.exists(filepath):
        return jsonify({"error": "Simulado não encontrado"}), 404
        
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if 'questoes' in data and isinstance(data['questoes'], list):
                random.shuffle(data['questoes'])
                for questao in data['questoes']:
                    if 'alternativas' in questao:
                        random.shuffle(questao['alternativas'])
            return jsonify(data)
    except Exception as e:
        # Tratamento de erro genérico para não expor detalhes.
        app.logger.error(f"Erro ao processar o arquivo {secure_id}.json: {e}")
        return jsonify({"error": "Não foi possível processar os dados do simulado."}), 500

# O servidor de desenvolvimento do Flask (`app.run`) foi removido.
# A aplicação será iniciada usando um servidor WSGI de produção (Gunicorn).