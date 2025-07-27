# backend/Dockerfile

# --- Builder Stage ---
# This stage compiles the application and its dependencies.
FROM rust:1.82-slim-bullseye as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# 1. Copy only dependency manifests
# Docker will cache this layer. It will only be invalidated if these two files change.
COPY Cargo.toml Cargo.lock ./

# 2. Build a dummy project to compile and cache all dependencies.
# This is the longest step and the most important one to cache.
RUN mkdir src && \
    echo "fn main() {println!(\"Dummy build for caching dependencies\")}" > src/main.rs && \
    cargo build --release

# Clean up the dummy source file and artifacts
RUN rm -rf src && \
    rm -f target/release/deps/simulados_backend*

# 3. Copy the actual source code.
# This layer will be invalidated if any file in `src` changes, but the
# expensive dependency build from the layer above will still be cached.
COPY ./src ./src

# 4. Build the actual application code.
# This will be much faster as all dependencies are already compiled.
RUN cargo build --release

# --- Final Stage ---
# This stage creates the small, final production image.
FROM debian:bullseye-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libssl1.1 \
    ca-certificates \
    sqlite3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary from the builder stage
COPY --from=builder /app/target/release/simulados-backend /app/simulados-backend

# Copy the application data. Changes to simulados will NOT invalidate the build stages.
COPY ./simulados /app/simulados

# Create the directory for user data
RUN mkdir -p /app/user_data

WORKDIR /app

# Set the log level. Use "debug" for development to see the new logs.
# For production, you can switch this back to "info".
ENV RUST_LOG="simulados_backend=debug,actix_web=info"
EXPOSE 5000

CMD ["/app/simulados-backend"]