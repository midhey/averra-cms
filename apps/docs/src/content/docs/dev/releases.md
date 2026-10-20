---
title: Релизы
description: "Как выходит версия Averra: release-please, теги, проверки и образы в GHCR."
sidebar:
  order: 13
---

Для разработчика и студии. После страницы вы выпустите новую версию, будете знать, откуда берутся
образы для установок и как пересобрать уже выпущенную.

## Как выходит версия

Версию и `CHANGELOG.md` ведёт **release-please** (`.github/workflows/release-please.yml`) по
сообщениям коммитов:

1. После каждого пуша в master он открывает или обновляет pull request «chore: release X.Y.Z» со
   списком изменений.
2. Влили этот pull request — release-please ставит тег `vX.Y.Z`, делает релиз на GitHub и в том же
   запуске вызывает `release.yml`.
3. `release.yml` гоняет `pnpm check` на коде тега и собирает образы
   `ghcr.io/midhey/averra-api:X.Y.Z` и `ghcr.io/midhey/averra-web:X.Y.Z` под amd64 и arm64.
4. Установки обновляются на неё — [Обновления](/averra-cms/install/updates/).

Пока версия ниже 1.0: `fix` — патч, `feat` и ломающие изменения (`feat!`, `BREAKING CHANGE`) —
минорная. `docs`, `test`, `chore` и `refactor` версию не поднимают и в список не попадают. Первая
версия — 0.1.0; другую задаёт строка `Release-As: X.Y.Z` в теле коммита. **Теги и версию руками не
ставим.**

Настройки — `release-please-config.json`, текущая версия — `.release-please-manifest.json` и
`version` в корневом `package.json`.

## Встроенный `GITHUB_TOKEN`

Release-please работает без личного токена, поэтому:

- один раз в настройках репозитория: Settings → Actions → General → «Allow GitHub Actions to create
  and approve pull requests»;
- на pull request релиза `ci.yml` сам не запускается (GitHub не запускает workflow на события от
  `GITHUB_TOKEN`). Проверки всё равно идут: `pnpm check` — в `release.yml` перед образами, и `ci.yml` —
  после вливания в master;
- `release.yml` не ждёт пуша тега — тег от `GITHUB_TOKEN` его бы и не запустил. Его вызывает
  `release-please.yml` напрямую (`workflow_call`).

## Пересобрать образы

Если сборка образов упала или нужно собрать заново уже выпущенную версию: Actions → release → Run
workflow с её тегом (`v0.7.0`). Тег проверяется шаблоном `vX.Y.Z`, код берётся ровно с тега.

Руками, на своей машине:

```bash
docker build -f deploy/Dockerfile --target api --build-arg AVERRA_VERSION=0.7.0 \
  -t ghcr.io/midhey/averra-api:0.7.0 .
docker build -f deploy/Dockerfile --target web -t ghcr.io/midhey/averra-web:0.7.0 .
```

Версия установки берётся из образа API (`AVERRA_VERSION`, её передаёт `release.yml` из тега): её
видно владельцу и в `averra.sh status`. В открытых маршрутах версии нет.

## Доступ к образам

Пакет GHCR закрыт по умолчанию, даже у открытого репозитория. Серверу нужен токен GitHub только с
`read:packages`. Почему образы из GHCR, а не сборка на месте — [Образы в
GHCR](/averra-cms/decisions/ghcr-images/).

## Другие workflow

| Workflow | Когда | Что |
|---|---|---|
| `ci.yml` | push в master, pull request | `pnpm check` на Linux |
| `docs.yml` | push в master с изменениями документации, вручную | сборка и выкладка этого сайта на GitHub Pages |
| `release-please.yml` | push в master | pull request релиза, тег и вызов `release.yml` |
| `release.yml` | вызов из `release-please.yml`, вручную | проверки и образы |

Для `docs.yml` — один раз Settings → Pages → Source — GitHub Actions.
