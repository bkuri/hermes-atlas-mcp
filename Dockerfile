FROM node:22-alpine AS builder

WORKDIR /build

# Copy source and build
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm install --omit=dev 2>/dev/null || npm install

# We need tsc for build only
RUN npm install typescript@5 --no-save && npx tsc

FROM node:22-alpine

WORKDIR /app

# Copy built output from builder
COPY --from=builder /build/dist/ ./dist/
COPY --from=builder /build/package.json ./
COPY --from=builder /build/node_modules/ ./node_modules/
COPY bin/bridge.cjs ./bridge.cjs

EXPOSE 8080
ENV PORT=8080
ENV HOST=0.0.0.0

CMD ["node", "bridge.cjs", "--", "node", "dist/index.js"]
