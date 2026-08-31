# Build stage
FROM node:24-bookworm-slim AS builder

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install production dependencies, including the platform's Sharp binaries
RUN npm ci --omit=dev --include=optional

# Copy source files
COPY . .

# Production stage
FROM node:24-bookworm-slim

# Install native video and document converters and Unicode fonts
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates libreoffice-writer fonts-noto-core fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/*

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV LIBREOFFICE_PATH=/usr/bin/libreoffice

WORKDIR /usr/src/app

# Copy built app and node_modules from builder stage
COPY --from=builder /usr/src/app ./

# Create temp downloads directory with proper permissions
RUN mkdir -p temp_downloads && chown -R node:node /usr/src/app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
