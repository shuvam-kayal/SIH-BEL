# infra/docker/backend.Dockerfile
# Build context is the monorepo root:
#   docker build -f infra/docker/backend.Dockerfile -t bel-backend .
FROM node:20-alpine

WORKDIR /app

# Workspace manifests first so the dependency layer caches independently
# of source changes.
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY contracts/package.json ./contracts/
COPY mocks/mock-api/package.json ./mocks/mock-api/
COPY mocks/mock-blockchain/package.json ./mocks/mock-blockchain/
RUN npm install --omit=optional

COPY tsconfig.base.json ./
COPY shared ./shared
COPY mocks ./mocks
COPY backend ./backend

EXPOSE 4000
CMD ["npm", "run", "start", "--workspace=bel-backend"]
