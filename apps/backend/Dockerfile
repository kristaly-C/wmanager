FROM node:22-bookworm-slim AS builder

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace csomagfájlok másolása a cache-elhető npm ci érdekében
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

RUN npm ci

# Forráskódok másolása
COPY packages/shared-types ./packages/shared-types
COPY apps/backend ./apps/backend

# Shared types buildelése
RUN npm run build --workspace=@wmanager/shared-types

# Prisma kliens generálása és backend buildelése
WORKDIR /app/apps/backend
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
RUN npx prisma generate
RUN npm run build
RUN rm -rf src

FROM node:22-bookworm-slim AS runner

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types ./packages/shared-types
COPY --from=builder /app/apps/backend ./apps/backend

WORKDIR /app/apps/backend
EXPOSE 4001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/main.js"]
