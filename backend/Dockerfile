# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# Install nmap + dependencies required by @supabase/supabase-js (native WebSocket)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      nmap \
      libuv1 \
      ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY package.json ./
COPY src/ ./src/

# Railway injects PORT automatically — default to 3001 for local Docker use
ENV PORT=3001

EXPOSE 3001

CMD ["node", "src/server.js"]
