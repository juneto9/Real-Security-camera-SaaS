# ============================================================================
# Multi-stage build for Security Camera SaaS
# ============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

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
FROM node:20-alpine

WORKDIR /app

# Install only runtime dependencies
RUN apk add --no-cache ffmpeg dumb-init

# Copy from builder
COPY --from=builder /app .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["node", "src/server.js"]