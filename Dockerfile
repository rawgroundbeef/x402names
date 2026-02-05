# Multi-stage Docker build for x402names API

# Stage 1: Base image
FROM oven/bun:1 AS base
WORKDIR /app

# Stage 2: Install dependencies
FROM base AS install

# Copy workspace configuration
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN bun install --frozen-lockfile

# Install production dependencies separately for smaller final image
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
COPY apps/api/package.json /temp/prod/apps/api/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Stage 3: Copy source code (optional test stage)
FROM base AS prerelease
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/apps/api/node_modules ./apps/api/node_modules

# Copy application source
COPY apps/api ./apps/api
COPY package.json ./

# Stage 4: Release - production image
FROM base AS release

# Create non-root user and data directory
RUN mkdir -p /app/data && chown -R bun:bun /app/data

# Copy production dependencies
COPY --from=install /temp/prod/node_modules ./node_modules
COPY --from=install /temp/prod/apps/api/node_modules ./apps/api/node_modules

# Copy application source
COPY --from=prerelease /app/apps/api ./apps/api
COPY --from=prerelease /app/package.json ./

# Run as non-root user
USER bun

# Expose port
EXPOSE 3000

# Run migrations and start server
CMD ["sh", "-c", "DATABASE_URL=/app/data/app.db cd apps/api && bun run src/db/migrate.ts && cd /app && bun run apps/api/src/index.ts"]
