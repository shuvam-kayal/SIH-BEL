# infra/docker/frontend.Dockerfile
# Build context is the monorepo root:
#   docker build -f infra/docker/frontend.Dockerfile -t bel-frontend .

FROM node:20-bookworm-slim

WORKDIR /app

# Workspace manifests first so the dependency layer caches independently
# of source changes.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY backend/prisma ./backend/prisma
COPY frontend/package.json ./frontend/
COPY contracts/package.json ./contracts/
COPY mocks/mock-api/package.json ./mocks/mock-api/
COPY mocks/mock-blockchain/package.json ./mocks/mock-blockchain/

RUN npm ci

COPY tsconfig.base.json ./
COPY shared ./shared
COPY mocks ./mocks
COPY frontend ./frontend

EXPOSE 3000

CMD ["npm", "run", "dev", "--workspace=bel-frontend"]