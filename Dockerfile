FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN AUTH_DATABASE_URL=postgresql://build:build@localhost:5432/build CATALOG_DATABASE_URL=postgresql://build:build@localhost:5432/build ORDER_DATABASE_URL=postgresql://build:build@localhost:5432/build SHIPPING_DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build
EXPOSE 3000
USER node
CMD ["node", "dist/services/api-gateway/src/server.js"]
