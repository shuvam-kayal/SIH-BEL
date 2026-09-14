# infra/docker/frontend.Dockerfile
# Build context is the monorepo root:
#   docker build -f infra/docker/frontend.Dockerfile -t bel-frontend .
FROM node:20-alpine

WORKDIR /app

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
COPY frontend ./frontend

EXPOSE 3000
# Dev server: the frontend still renders from mocks/mock-api, so this
# container is useful before the backend does anything. Switch to
# `npm run build` + a static server once Phase 12 integration lands.
CMD ["npm", "run", "dev", "--workspace=bel-frontend"]
