# ---- Stage 1: Build ----
# Usa uma imagem slim para instalar dependências e criar um ambiente virtual.
FROM python:3.9-slim as builder

# Define o diretório de trabalho.
WORKDIR /app

# Cria um ambiente virtual para isolar as dependências.
RUN python -m venv /opt/venv

# Ativa o ambiente virtual para os comandos RUN subsequentes.
ENV PATH="/opt/venv/bin:$PATH"

# Copia e instala as dependências.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---- Stage 2: Final Image ----
# Usa uma nova imagem slim para um tamanho final menor.
FROM python:3.9-slim

# Cria um usuário e grupo não-root para segurança.
RUN addgroup --system app && adduser --system --group appuser

# Copia o ambiente virtual do estágio de build.
COPY --from=builder /opt/venv /opt/venv

# Define o diretório de trabalho.
WORKDIR /app

# Copia o código da aplicação.
COPY . .

# Altera a propriedade do diretório da aplicação.
RUN chown -R appuser:app /app

# Muda para o usuário não-root.
USER appuser

# Disponibiliza os executáveis do ambiente virtual no PATH.
ENV PATH="/opt/venv/bin:$PATH"

# Expõe a porta que o Gunicorn usará.
EXPOSE 5000

# Executa a aplicação com Gunicorn a partir do ambiente virtual.
# worker_processes está definido como 4 no arquivo original, mantendo-o.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "app:app"]