# Stage 1: Install dependencies and build TypeScript
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files for dependency install
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source and build
COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# Stage 2: Production image
FROM node:22-alpine AS production

ARG APP_VERSION=1.0.0
ENV APP_VERSION=$APP_VERSION

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci --omit=dev

# Generate Prisma client in production image
RUN npx prisma generate

# Copy built JavaScript from builder
COPY --from=builder /app/dist ./dist/

# Copy static data files used at runtime
COPY src/data ./src/data/

# Copy entrypoint script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

EXPOSE 3000

CMD ["./entrypoint.sh"]
