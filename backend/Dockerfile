# ---- Stage 1: Build ----
FROM python:3.11-slim as builder

# OPTIMIZATION: Install system dependencies for better performance
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Define o diretório de trabalho
WORKDIR /app

# Create virtual environment
RUN python -m venv /opt/venv

# Activate virtual environment
ENV PATH="/opt/venv/bin:$PATH"

# OPTIMIZATION: Install wheel first for faster builds
RUN pip install --no-cache-dir --upgrade pip wheel

# Copy and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---- Stage 2: Final Image ----
FROM python:3.11-slim

# OPTIMIZATION: Install runtime dependencies including curl for health checks
RUN apt-get update && apt-get install -y \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
# Create non-root user for security
RUN addgroup --system --gid 1001 app && \
    adduser --system --uid 1001 --ingroup app appuser

# Copy virtual environment from builder stage
COPY --from=builder /opt/venv /opt/venv

# Set working directory
WORKDIR /app

# Copy application code
COPY . .

# OPTIMIZATION: Create necessary directories and set permissions
RUN mkdir -p user_data simulados && \
    chown -R appuser:app /app && \
    chown -R appuser:app /opt/venv

# Switch to non-root user
USER appuser

# Make virtual environment available
ENV PATH="/opt/venv/bin:$PATH"

# OPTIMIZATION: Set Python environment variables for better performance
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONHASHSEED=random

# Expose port
EXPOSE 5000

# OPTIMIZATION: Use gunicorn with optimized settings
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