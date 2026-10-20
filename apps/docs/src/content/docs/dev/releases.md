---
title: Релизы
description: "Как выходит версия Averra: коммиты, release-please, теги, образы в GHCR."
sidebar:
  order: 13
---

Для разработчика и студии. После страницы вы будете знать, как писать коммиты, чтобы версия вышла
сама, откуда берутся образы для установок и как пересобрать уже выпущенную версию.

## Как выходит версия

Версия одна на весь продукт: API, админка, рендерер, MCP-сервер и установка выходят вместе. Её и
`CHANGELOG.md` ведёт **release-please** (`.github/workflows/release-please.yml`) по сообщениям
коммитов:

1. После каждого пуша в master он открывает или обновляет pull request «chore: release X.Y.Z» со
   списком изменений.
2. Влили этот pull request — release-please ставит тег `vX.Y.Z`, делает релиз на GitHub и в том же
   запуске вызывает `release.yml`.
3. `release.yml` гоняет `pnpm check` на коде тега и собирает образы
   `ghcr.io/midhey/averra-api:X.Y.Z` и `ghcr.io/midhey/averra-web:X.Y.Z` под amd64 и arm64.
4. Установки обновляются на неё — [Обновления](/averra-cms/install/updates/).

Версия без «v» попадает в образ API (`AVERRA_VERSION`). Её видно владельцу в «Состоянии
установки» и студии в `averra.sh status` и `pnpm fleet status`. Собранное без релиза (`pnpm dev`,
`docker build` без аргумента) показывает `dev`.

**Теги и версию руками не ставим.** Настройки — `release-please-config.json`, последняя выпущенная
версия — `.release-please-manifest.json` и `version` в корневом `package.json` (MCP-сервер берёт
её оттуда).

## Что писать в коммитах

[Conventional Commits](https://www.conventionalcommits.org/), по-английски. Тип решает,
попадёт ли изменение в список и какую часть версии поднимет:

| Коммит | Версия до 1.0 | В `CHANGELOG.md` |
|---|---|---|
| `fix: …`, `fix(api): …` | патч: 0.3.1 → 0.3.2 | да, «Bug Fixes» |
| `feat: …` | минорная: 0.3.1 → 0.4.0 | да, «Features» |
| `perf: …` | патч | да, «Performance Improvements» |
| `revert: …` | патч | да, «Reverts» |
| `feat!: …` или подвал `BREAKING CHANGE: …` | минорная (после 1.0 — мажорная) | да, «⚠ BREAKING CHANGES» |
| `docs`, `test`, `refactor`, `chore`, `ci`, `build`, `style` | не поднимает | нет |

- Пишите тип по тому, что заметит человек на установке. Новое в админке — `feat`, исправленное
  поведение — `fix`, всё внутреннее — `refactor` или `chore`.
- Ломающее изменение для установок (нужен ручной шаг на сервере, меняется `.env`) — `!` в
  заголовке и подвал `BREAKING CHANGE:` последней строкой сообщения. В «⚠ BREAKING CHANGES»
  попадает только текст подвала (без подвала — заголовок), обычный текст тела в заметки релиза не
  идёт. Студия читает эти заметки перед обновлением, поэтому в подвале — что сделать на сервере:

  ```text
  feat(api)!: send mail through the queue

  BREAKING CHANGE: add MAIL_FROM to /opt/averra/.env before updating
  ```

- Первая версия — 0.1.0. Выпустить другую можно строкой `Release-As: X.Y.Z` в теле коммита.
- Первый `CHANGELOG.md` (0.1.0) соберёт всю историю коммитов: прошлых релизов нет. Это осознанно —
  история уже в Conventional Commits и описывает, из чего состоит первая версия.

## Один раз в настройках GitHub

- Settings → Actions → General → «Allow GitHub Actions to create and approve pull requests» —
  иначе release-please не откроет pull request.
- Settings → Pages → Source — GitHub Actions — для сайта документации.
- **После первого релиза — сделать образы публичными.** Видимость пакета GHCR от репозитория не
  наследуется: первый пуш создаёт закрытый пакет. Профиль → Packages → `averra-api` → Package
  settings → Danger Zone → Change visibility → Public; то же для `averra-web`. Дальше серверы
  скачивают образы без входа и без токена, а новые версии попадают в тот же публичный пакет.
  **Обратно закрытым публичный пакет не сделать** — GitHub это не позволяет.

## Встроенный `GITHUB_TOKEN`

Release-please работает без личного токена, поэтому:

- на pull request релиза `ci.yml` сам не запускается (GitHub не запускает workflow на события от
  `GITHUB_TOKEN`). Проверки всё равно идут: `pnpm check` — в `release.yml` перед образами, и
  `ci.yml` — после вливания в master;
- `release.yml` не ждёт пуша тега — тег от `GITHUB_TOKEN` его бы и не запустил. Его вызывает
  `release-please.yml` напрямую (`workflow_call`), образы пишет тот же `GITHUB_TOKEN` с правом
  `packages: write`.

## Пересобрать образы

Если сборка образов упала или нужно собрать заново уже выпущенную версию: Actions → release → Run
workflow с её тегом (`v0.1.0`). Тег проверяется шаблоном `vX.Y.Z`, код берётся ровно с тега.

Руками, на своей машине:

```bash
docker build -f deploy/Dockerfile --target api --build-arg AVERRA_VERSION=0.1.0 \
  -t ghcr.io/midhey/averra-api:0.1.0 .
docker build -f deploy/Dockerfile --target web -t ghcr.io/midhey/averra-web:0.1.0 .
```

Почему образы из GHCR, а не сборка на месте, — [Образы в GHCR](/averra-cms/decisions/ghcr-images/).

## Все workflow

| Workflow | Когда | Что |
|---|---|---|
| `ci.yml` | push в master, pull request | `pnpm check` на Linux |
| `docs.yml` | push в master с изменениями документации, вручную | сборка и выкладка этого сайта на GitHub Pages |
| `release-please.yml` | push в master | pull request релиза, тег и вызов `release.yml` |
| `release.yml` | вызов из `release-please.yml`, вручную | проверки и образы |
