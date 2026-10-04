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
# ‏הקליינט של Prisma נוצר כאן, בתוך העץ הפרוס של כל שירות (node_modules
# ‏חדש — הקליינט של סביבת הבנייה אינו עובר), ולא בתמונה הסופית: שם הוא
# ‏היה מוסיף שכבה עם מטמון הורדות של המנוע, וה-Workers היו נושאים את
# ‏כלי ה-CLI של Prisma (והתלויות שלו) רק בשביל הצעד הזה. ה-API נושא את
# ‏ה-CLI ממילא — הוא מריץ איתו את המיגרציות בעלייה.
RUN cd /prod/api && node node_modules/prisma/build/index.js generate --schema=prisma/schema.prisma \
 && mkdir -p /prod/workers/prisma && cp prisma/schema.prisma /prod/workers/prisma/ \
 && cd /prod/workers && node /prod/api/node_modules/prisma/build/index.js generate --schema=prisma/schema.prisma

# ---------- API ----------
FROM base AS api
ENV NODE_ENV=production
# ffmpeg ממיר הקלטות ל-ogg/opus לפני שליחתן בוואטסאפ — wav ו-webm,
# שני הפורמטים שאנחנו שומרים בהם, נדחים בנתיב המדיה של Meta.
# אותו כלי שכבר משמש את שירותי התמלול והזיהוי (infra/stt, infra/diarize).
# su-exec — העלייה יורדת מ-root ל-node (ראו api-entrypoint.sh)
RUN apk add --no-cache ffmpeg su-exec
COPY --from=build /prod/api /app
WORKDIR /app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
EXPOSE 3001
# ‏בלי root: העלייה מעבירה את תיקיית הגיבויים לקבוצה של node ויורדת
# ‏אליו. הקבצים נשארים של root — לקריאה בלבד עבורו.
COPY --chmod=755 infra/docker/api-entrypoint.sh /usr/local/bin/api-entrypoint
ENTRYPOINT ["/usr/local/bin/api-entrypoint"]
# מיגרציות רצות לפני עליית השרת — פריסה אטומית של סכימה+קוד
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema=prisma/schema.prisma && exec node dist/main.js"]

# ---------- Workers ----------
FROM base AS workers
ENV NODE_ENV=production
# ‏הקליינט כבר נוצר בשלב הבנייה (מהסכימה של ה-API) — ראו שם
COPY --from=build /prod/workers /app
WORKDIR /app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
# ‏בלי root: ה-Workers אינו כותב לדיסק, וקוד שנפרץ כאן לא יקבל
# ‏את הקונטיינר כולו. הקבצים נשארים של root — לקריאה בלבד עבורו.
USER node
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
# ‏בלי root, מאותה סיבה כמו ב-Workers. אין כאן מה שנכתב לדיסק:
# ‏`images.unoptimized` ואין ISR, ולכן `.next/cache` אינו נוצר.
USER node
CMD ["node", "apps/web/server.js"]

# ---------- Updater (סוכן העדכון — ראו infra/updater) ----------
# ‏נשאר root בכוונה: הוא מדבר עם ה-Docker של המארח דרך
# ‏`/var/run/docker.sock`, וגישה לשקע הזה שקולה ממילא ל-root במארח.
FROM node:22-alpine AS updater
RUN apk add --no-cache docker-cli docker-cli-compose
COPY infra/updater/server.mjs /srv/server.mjs
EXPOSE 9944
CMD ["node", "/srv/server.mjs"]
