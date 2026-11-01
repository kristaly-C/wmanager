FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Workspace csomagfájlok másolása
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

RUN npm ci

# Forráskódok másolása
COPY packages/shared-types ./packages/shared-types
COPY apps/frontend ./apps/frontend

# Shared types és Vue frontend buildelése
RUN npm run build --workspace=@wmanager/shared-types

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build --workspace=frontend

FROM nginx:1.27-alpine AS runner

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
