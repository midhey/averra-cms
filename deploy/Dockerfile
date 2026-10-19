# syntax=docker/dockerfile:1.7
#
# Образы установки Averra на VPS клиента (модуль 9). Контекст сборки — корень репозитория:
#   docker build -f deploy/Dockerfile --target api -t averra-api .
#   docker build -f deploy/Dockerfile --target web -t averra-web .
#
# api — API (с обработчиком очереди писем и сборкой сайтов) и рендерер Astro, которым API
#       собирает сайт при публикации. Только prod-зависимости, API — собранный JS (не через tsx),
#       пользователь node.
# web — Caddy со статикой админки и Caddyfile: SSL, домен сайта и поддомен админки. Не от root.
#
# Секретов в образах нет: .env, базы и медиатеки в контекст не попадают (.dockerignore),
# а секреты приходят переменными окружения из .env папки установки на сервере (install.sh).

# Та же Node, что закреплена в проекте (devEngines.runtime, pnpm-lock.yaml): pnpm не станет
# скачивать свою. Debian (glibc), а не Alpine: под него есть готовые сборки sharp и rolldown
ARG NODE_IMAGE=node:24.22.0-bookworm-slim
ARG CADDY_IMAGE=caddy:2.11.7-alpine

# ── pnpm ────────────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS pnpm
ENV PNPM_HOME=/pnpm CI=true ASTRO_TELEMETRY_DISABLED=1
# Версия — как в packageManager корневого package.json
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate

# ── Сборка: все зависимости, API в JavaScript, админка в статику ────────────────────────────
# Результат (JS API с внешними зависимостями и статика админки) от платформы не зависит, поэтому
# стадия идёт на платформе сборщика: образ arm64 не гоняет pnpm install, esbuild и vite под QEMU
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm CI=true ASTRO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate
WORKDIR /repo
# Сначала только манифесты: слой с зависимостями пересобирается, когда меняется lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/renderer/package.json apps/renderer/
COPY apps/mcp/package.json apps/mcp/
COPY packages/schema/package.json packages/schema/
COPY packages/blocks/package.json packages/blocks/
COPY packages/tokens/package.json packages/tokens/
COPY e2e/package.json e2e/
COPY deploy/package.json deploy/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter "@averra/api..." --filter "@averra/admin..."
COPY . .
RUN pnpm --filter @averra/api build && pnpm --filter @averra/admin build

# ── Prod-зависимости API и рендерера, раскладка как в репозитории ───────────────────────────
FROM pnpm AS runtime-tree
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/renderer/package.json apps/renderer/
COPY apps/mcp/package.json apps/mcp/
COPY packages/schema/package.json packages/schema/
COPY packages/blocks/package.json packages/blocks/
COPY packages/tokens/package.json packages/tokens/
COPY e2e/package.json e2e/
COPY deploy/package.json deploy/
# Только то, что нужно API и рендереру: без dev-зависимостей (vitest, drizzle-kit, typescript,
# Biome). esbuild (зависимость astro) и tsx (необязательный peer vite) приезжают транзитивно для
# сборщика сайта — API ими не пользуется и запускается собранным JavaScript
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile --filter "@averra/api..." --filter "@averra/renderer..."
# Исходники пакетов рабочей области: рендерер собирает блоки из них при каждой публикации
COPY packages/schema/src packages/schema/src
COPY packages/blocks/src packages/blocks/src
COPY packages/tokens/src packages/tokens/src
COPY apps/renderer/astro.config.mjs apps/renderer/tsconfig.json apps/renderer/
COPY apps/renderer/src apps/renderer/src
COPY apps/renderer/scripts apps/renderer/scripts
COPY apps/api/drizzle apps/api/drizzle
COPY --from=build /repo/apps/api/dist apps/api/dist
# Манифесты, которые нужны только сборке, в итоговом образе не нужны
RUN rm -rf apps/admin apps/mcp e2e deploy
# Конфигурация установки этой версии: averra.sh update берёт compose.yaml и сам averra.sh отсюда,
# поэтому они меняются вместе с версией, а не отдельной ручной правкой на сервере
COPY deploy/compose.yaml deploy/averra.sh deploy/

# ── API ─────────────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS api
# Версия установки (тег релиза без «v»): её показывают «Состояние» в админке и averra.sh status.
# Передаёт release.yml (build-args); образ, собранный руками без неё, — dev
ARG AVERRA_VERSION=dev
# TRUST_PROXY здесь нет: по умолчанию API не верит X-Forwarded-For (иначе «docker run -p 4000:4000»
# без прокси дал бы обходить лимиты входа и заявок). Включает его compose.yaml: перед API там Caddy
ENV NODE_ENV=production \
  AVERRA_VERSION=${AVERRA_VERSION} \
  PORT=4000 \
  PUBLISH_DIR=/data/sites \
  MEDIA_DIR=/data/media \
  RENDERER_DIR=/app/apps/renderer \
  ASTRO_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=runtime-tree /app /app
# Тома монтируются поверх этих папок и при первом подключении берут их владельца — node.
# Весь код, и рендерер тоже, остаётся за root, только для чтения: API работает не от root и не
# может поменять ни свой код, ни код сборщика, который запускает при каждой публикации.
# Сборщик пишет кеши Astro и Vite в PUBLISH_DIR/.cache (scripts/build-release.mjs), а папку .astro
# Astro берёт всегда из корня проекта — она ссылка в тот же кеш. Папку, куда ведёт ссылка, API
# создаёт перед каждой сборкой (DOT_ASTRO_CACHE в apps/api/src/publish/renderer.ts)
RUN mkdir -p /data/sites /data/media \
  && chown -R node:node /data \
  && rm -rf /app/apps/renderer/.astro \
  && ln -s /data/sites/.cache/dot-astro /app/apps/renderer/.astro
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/server/index.js"]

# ── Caddy: SSL, статика админки, сайт из тома сборок ────────────────────────────────────────
FROM ${CADDY_IMAGE} AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/admin/dist /srv/admin
# Caddy — единственный контейнер, открытый в интернет, поэтому не от root. Порты 80 и 443 ему
# открывает file capability cap_net_bind_service у бинарника (она есть в официальном образе)
# и net.ipv4.ip_unprivileged_port_start=0 в compose.yaml. Сертификаты и настройки — в /data и
# /config: томам при первом подключении достаются их владелец и права отсюда
RUN addgroup -S -g 1000 caddy \
  && adduser -S -D -H -u 1000 -G caddy -h /data caddy \
  && chown -R caddy:caddy /data /config
USER caddy
