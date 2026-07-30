# syntax=docker/dockerfile:1
# ============================================================
# תמונות הפרודקשן — Dockerfile אחד, ארבעה יעדים (build targets):
#   api, web, workers, updater
# נבנה מ-Context של שורש הריפו:
#   docker build -f infra/docker/Dockerfile --target api .
# CI בונה ודוחף את הארבעה ל-GHCR על כל מיזוג ל-main (ראו ci.yml).
# ============================================================

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# ---------- שלב הבנייה: התקנה + build של כל ה-Monorepo ----------
FROM base AS build
# כלי קומפילציה למודולים נייטיביים (argon2) אם אין prebuild תואם musl
RUN apk add --no-cache python3 make g++
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @metavchim/api exec prisma generate
# כתובת ה-API בפרודקשן ריקה בכוונה — same-origin דרך ה-Proxy (Caddy)
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm build
# חבילות פרודקשן עצמאיות (כולל תלויות workspace) לכל שירות
RUN pnpm --filter @metavchim/api deploy --prod --legacy /prod/api \
 && pnpm --filter @metavchim/workers deploy --prod --legacy /prod/workers

# ---------- API ----------
FROM base AS api
ENV NODE_ENV=production
COPY --from=build /prod/api /app
WORKDIR /app
# הקליינט של Prisma חייב להיווצר מחדש בתוך העץ הפרוס (node_modules חדש)
RUN node node_modules/prisma/build/index.js generate --schema=prisma/schema.prisma
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
EXPOSE 3001
# מיגרציות רצות לפני עליית השרת — פריסה אטומית של סכימה+קוד
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema=prisma/schema.prisma && exec node dist/main.js"]

# ---------- Workers ----------
FROM base AS workers
ENV NODE_ENV=production
COPY --from=build /prod/workers /app
# הסכימה חיה באפליקציית ה-API — ה-Workers רק צורך את הקליינט שנוצר ממנה
COPY --from=build /repo/apps/api/prisma/schema.prisma /app/prisma/schema.prisma
WORKDIR /app
RUN node node_modules/prisma/build/index.js generate --schema=prisma/schema.prisma
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
CMD ["node", "dist/main.js"]

# ---------- Web ----------
FROM base AS web
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone /app
COPY --from=build /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build /repo/apps/web/public /app/apps/web/public
WORKDIR /app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ---------- Updater (סוכן העדכון — ראו infra/updater) ----------
FROM node:22-alpine AS updater
RUN apk add --no-cache docker-cli docker-cli-compose
COPY infra/updater/server.mjs /srv/server.mjs
EXPOSE 9944
CMD ["node", "/srv/server.mjs"]
