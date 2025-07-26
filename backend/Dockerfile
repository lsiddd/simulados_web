FROM python:3.11-slim as builder
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip wheel
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
FROM python:3.11-slim
RUN apt-get update && apt-get install -y \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean
RUN addgroup --system --gid 1001 app && \
    adduser --system --uid 1001 --ingroup app appuser
COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY . .
RUN mkdir -p user_data simulados && \
    chown -R appuser:app /app && \
    chown -R appuser:app /opt/venv
USER appuser
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONHASHSEED=random
EXPOSE 5000
CMD ["gunicorn", \
     "--bind", "0.0.0.0:5000", \
     "--workers", "4", \
     "--worker-class", "sync", \
     "--worker-connections", "1000", \
     "--max-requests", "1000", \
     "--max-requests-jitter", "100", \
     "--preload", \
     "--timeout", "30", \
     "--keep-alive", "5", \
     "--log-level", "info", \
     "app:app"]