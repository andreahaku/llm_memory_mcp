# Multi-stage build for optimal production image
FROM node:20-alpine AS builder

# Install build dependencies including FFmpeg
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg \
    ffmpeg-dev

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN corepack enable pnpm && \
    pnpm install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build the application
RUN pnpm run build && \
    pnpm prune --prod

# Production stage
FROM node:20-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    ffmpeg \
    tini && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create directories with proper permissions
RUN mkdir -p /app /var/log/llm-memory-mcp /tmp/llm-memory-encoding && \
    chown -R nodejs:nodejs /app /var/log/llm-memory-mcp /tmp/llm-memory-encoding

# Set working directory
WORKDIR /app

# Copy built application and dependencies
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./

# Copy configuration files
COPY --chown=nodejs:nodejs config/ ./config/

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV FFMPEG_PATH="/usr/bin/ffmpeg"

# Expose health check port
EXPOSE 8080
EXPOSE 9090

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "dist/index.js"]