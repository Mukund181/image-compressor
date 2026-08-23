# Build stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (including sharp native binaries for alpine)
RUN npm ci --only=production

# Copy source files
COPY . .

# Production stage
FROM node:20-alpine

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /usr/src/app

# Copy built app and node_modules from builder stage
COPY --from=builder /usr/src/app ./

# Create temp downloads directory with proper permissions
RUN mkdir -p temp_downloads && chown -R node:node /usr/src/app

USER node

EXPOSE 3000

CMD ["node", "server.js"]
