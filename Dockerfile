# syntax=docker/dockerfile:1.7

# ---------- Build stage ----------
FROM node:26-alpine AS builder

WORKDIR /app

# Use lockfile-deterministic install for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---------- Production stage ----------
FROM node:26-alpine

WORKDIR /app

# wget is present in the base image; we use it for HEALTHCHECK below.

# Non-root user.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nodejs

# Production dependency tree only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
RUN chown -R nodejs:nodejs /app

USER nodejs

ENV NODE_ENV=production \
    MCP_TRANSPORT=streamable \
    MCP_PORT=3113 \
    # The container's network interface is the boundary — bind to 0.0.0.0
    # inside; the host port mapping (or reverse proxy) controls exposure.
    MCP_BIND_HOST=0.0.0.0

EXPOSE 3113

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3113/health || exit 1

CMD ["node", "dist/index.js"]
