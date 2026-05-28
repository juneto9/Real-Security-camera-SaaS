# ============================================================================
# Multi-stage build for Security Camera SaaS
# ============================================================================

# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (including wrtc)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    ffmpeg

# Copy package files
COPY package*.json ./

# Install dependencies (including wrtc)
RUN npm ci --only=production

# Copy application code
COPY . .

# ============================================================================
# Stage 2: Runtime
FROM node:18-alpine

WORKDIR /app

# Install only runtime dependencies (not build tools)
RUN apk add --no-cache ffmpeg dumb-init

# Create app user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app . 

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "src/server.js"]