FROM node:22-alpine

WORKDIR /app

# Copy package (dist/ + data/) and bridge
COPY dist/ ./dist/
COPY package.json ./
COPY bin/bridge.js ./bridge.js

# Install the MCP SDK (only production dep)
RUN npm install --omit=dev 2>/dev/null || true

EXPOSE 8080

CMD ["node", "bridge.js", "--port", "8080", "--", "node", "dist/index.js"]
