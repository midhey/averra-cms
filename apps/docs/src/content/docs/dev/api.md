---
title: API
description: "Все маршруты API Averra: вход, права, форматы ошибок и что отвечает каждый маршрут."
sidebar:
  order: 7
---

Для разработчика админки, MCP или своей интеграции. После страницы вы найдёте нужный маршрут,
будете знать, кто его может вызвать и какие ошибки ждать.

API — Hono, все маршруты под `/api`. Типы API (`AppType`) читают админка и MCP: они ходят в него
типизированным клиентом Hono, и опечатка в пути не скомпилируется.

## Вход и права

- **Cookie сессии** Better Auth (httpOnly, `SameSite=Lax`, в проде `Secure`) — для людей из админки.
  Изменяющие запросы с cookie принимаются только с `Origin` админки (`ADMIN_URL`).
- **`Authorization: Bearer <токен>`** — токен API, редактор на одном сайте. Origin не проверяется:
  браузер сам токен не подставит.
- **Закрыто по умолчанию.** Без входа открыты только маршруты с пометкой «открыт» ниже и
  `/api/auth/*` — там решает Better Auth. Остальное без входа — 401.
- **Права сайта** решает одна таблица действий (`src/auth/access.ts`): маршрут объявляет действие
  (`requireSite(db, 'page.publish')`), а не проверяет роль сам. Кто что может —
  [Роли](/averra-cms/admin/).
- **Персональные данные** (заявки, полная выгрузка) токену запрещены всегда — 403.

## Ошибки

Один формат, по-русски, включая 404 неизвестного маршрута, 500 и ответы Better Auth:

```json
{ "error": { "code": "conflict", "message": "Такой адрес уже есть", "issues": [{ "path": "slug", "message": "…" }] } }
```

| Код | Когда |
|---|---|
| 400 `validation` | вход не прошёл схему; `issues` — путь до каждого кривого поля |
| 401 | не вошёл, сессия кончилась или токен недействителен |
| 403 | роль на сайте есть, но действие ей не разрешено |
| 404 | нет сайта или страницы — **или сайт чужой**: снаружи это неразличимо |
| 409 `conflict` | запрос верный, но спорит с базой (адрес занят, картинка используется) |
| 410 | ссылка из письма была, но больше не действует (приглашение принято, отозвано, истекло) |
| 413, 415 | файл или тело слишком большие; тип файла не тот |
| 429 `rate_limited` | лимит попыток |
| 503 `mail_disabled` | действию нужна почта, а её нет |

Создание отвечает 201 с созданным, удаление — 204 без тела.

## Служебные

| Запрос | Что делает |
|---|---|
| `GET /api/health` | API жив. **Открыт** |
| `GET /api/health/ready` | API и база готовы; база не отвечает — 503. **Открыт**, версии в ответе нет |
| `GET /api/status` | состояние установки — только владелец, `Cache-Control: no-store`. См. [Состояние](/averra-cms/install/status/) |

## Вход, пароль, кто я

| Запрос | Что делает |
|---|---|
| `POST /api/auth/sign-in/email` | вход `{ email, password }`, ставит cookie. Не больше 3 попыток за 10 секунд с IP |
| `/api/auth/*` | остальное Better Auth: `sign-out`, `get-session` и т. п. **Открыт** — решает Better Auth |
| `POST /api/auth/verify-password` | закрыт (404): через уведённую сессию по нему подбирали бы пароль мимо лимита |
| `POST /api/auth/change-password` | `{ currentPassword, newPassword }` → новая cookie, остальные входы завершаются. Неверный пароль — 403 `invalid_password`; не больше 5 неудач за 15 минут на пользователя (общий счётчик с паролем у настроек SMTP) |
| `GET /api/password-reset` | работает ли сброс по почте: `{ available }`. **Открыт** |
| `POST /api/auth/request-password-reset` | «Забыли пароль?»: `{ email }`. Ответ всегда `200 { status: "sent" }` и не раньше 300 мс. 5 запросов за 15 минут с IP, 3 — на адрес. Нет почты — 503 |
| `POST /api/auth/reset-password` | новый пароль по ссылке `{ token, newPassword }`; ссылка негодная — 400 `invalid_token`. Все сессии завершаются |
| `GET /api/auth/reset-password/:token` | закрыт (404): токен в пути попал бы в лог |
| `GET /api/me` | кто вошёл: `{ kind: "user", user }` или `{ kind: "token", token: { id, siteId } }` |

## Сайты и страницы

Одна установка — один сайт ([почему](/averra-cms/decisions/single-site/)). Его создаёт API при
первом запуске, создания сайтов в API нет. Маршруты с `:siteId` остаются: это задел под мультисайт,
и по ним ходят админка, MCP и сборщик, узнав id из `GET /api/site`.

| Запрос | Что делает |
|---|---|
| `GET /api/site` | сайт, с которым работает пришедший: человеку — сайт установки (нет доступа — 403), токену — его сайт. `{ id, name, url, otherSites }`: `url` — `SITE_URL` или `null`, `otherSites` — сколько ещё сайтов в базе (только владельцу, иначе `null`) |
| `GET /api/site/snapshot` | снимок сайта установки, как `…/:siteId/snapshot`: рендереру без `CMS_SITE_ID`. **Открыт** |
| `GET /api/site/fallback/<путь>` | адрес домена сайта, где нет файла (Caddy, `handle_errors 404`): редирект из настроек — 301 с `Location` (строка запроса исходного адреса переходит в «куда» без своей), иначе 404 со страницей `404.html` текущей версии сайта (без сборки — короткая страница API). `no-cache`. **Открыт** |
| `GET /api/sites` | для совместимости (`list_sites` в MCP): владельцу — все сайты базы, участнику — свои, токену — его сайт |
| `GET /api/sites/:siteId` | сайт: название, тема, роль вошедшего (`access`), `newLeads` (или `null`, если роли заявки не видны), `hiddenFromSearch`, `seo` — что нужно SEO страницы (`SiteSeo`: шаблон заголовка, описание и картинка по умолчанию, адрес сайта, скрыт ли). Всем, кто видит сайт, и токену |
| `GET /api/sites/:siteId/snapshot` | всё для рендерера: сайт (`name`, `theme`, `url` — адрес из настроек или `SITE_URL`, `settings` — настройки SEO; организация — только при опубликованной главной), опубликованные страницы с `publishedAt` и справочник `media` (картинки страниц и настроек). **Открыт** |
| `GET /api/sites/:siteId/pages` | страницы: заголовок, адрес, когда опубликована, есть ли неопубликованные правки |
| `POST /api/sites/:siteId/pages` | создать `{ slug, title, template: "empty" \| "hero" }`; адрес занят — 409 |
| `GET /api/sites/:siteId/pages/:slug` | страница с черновиком и опубликованной версией |
| `PUT /api/sites/:siteId/pages/:slug` | сохранить черновик `{ title, content: { blocks, seo? } }`; `seo` — `{ title?, description?, image?: { mediaId }, canonical?, noindex? }` (`PageSeo`). Нет страницы — создаёт (клиенту — 404). Картинка не из медиатеки сайта (в блоке или `seo.image`) — 409 с путём до поля |
| `POST /api/sites/:siteId/pages/:slug/publish` | опубликовать черновик с заголовком; пишет версию в историю и ставит сборку |
| `DELETE /api/sites/:siteId/pages/:slug` | удалить вместе с историей; главную — 409 |

## SEO и настройки сайта (только владелец)

| Запрос | Что делает |
|---|---|
| `GET /api/sites/:siteId/settings` | `{ settings, installationUrl, url }`: настройки (`SiteSettings`), адрес установки (`SITE_URL`) и адрес сайта, который из них выходит |
| `PATCH /api/sites/:siteId/settings` | сохранить присланные поля верхнего уровня (`SiteSettingsPatch`), остальные не меняются; группы (`verification`, `analytics`, `organization`, `redirects`) — целиком. Ставит сборку. Картинка не из медиатеки и редирект с адреса страницы — 409 с путём до поля |

Редактору, клиенту и токену API — 403. Подробно — [SEO](/averra-cms/admin/seo/) и
[решение](/averra-cms/decisions/seo-settings/).

## Иконки и карточки для соцсетей

Картинки, которые API рисует из настроек и страниц. Права у каждой — свои, в строке: собранный
сайт берёт иконки и карточки без входа, а предпросмотр черновика — только тем, кто видит сайт.

| Запрос | Что делает |
|---|---|
| `GET /api/sites/:siteId/icons/:file` | иконка сайта из картинки настроек: `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`; иконки нет — 404. Кеш в памяти, `no-cache`. **Открыт**: их берёт рендерер |
| `GET /api/sites/:siteId/og/:slug` | карточка опубликованной страницы для соцсетей: PNG 1200 × 630 из опубликованного заголовка ([решение](/averra-cms/decisions/og-card/)); страница не опубликована — 404. Кеш в памяти, `no-cache`. **Открыт**: её берёт рендерер |
| `GET /api/sites/:siteId/og-card?title=…` | та же карточка для заголовка черновика — предпросмотр в редакторе. `site.read`, `private, max-age=300`. Свой кеш, очередь не длиннее четырёх: сверх того — 429 |

## История

| Запрос | Что делает |
|---|---|
| `GET /api/sites/:siteId/pages/:slug/revisions` | публикации, новые сверху, последние 100: `id`, `version`, `title`, `publishedAt`, `author` |
| `GET /api/sites/:siteId/pages/:slug/revisions/:revisionId` | версия с `content` |
| `POST /api/sites/:siteId/pages/:slug/revisions/:revisionId/restore` | вернуть версию в черновик; отвечает страницей. Не проходит нынешние схемы или в ней удалённая картинка — 409 |

## Медиатека

| Запрос | Что делает |
|---|---|
| `GET /api/sites/:siteId/media` | `{ items, maxBytes }`: картинки с вариантами и предел размера файла |
| `POST /api/sites/:siteId/media` | загрузить: multipart, поле `file` → 201. Не тот тип — 415, слишком большой — 413 (тело сверх лимита обрывается, не дочитанным) |
| `DELETE /api/sites/:siteId/media/:mediaId` | удалить с файлами; стоит на странице или в настройках SEO (иконка, картинка для соцсетей, логотип) — 409 с тем, где стоит |
| `GET /api/media/:mediaId/:file` | файл варианта (`480.avif`, `960.webp`…), `immutable`, `nosniff`. **Открыт** |

## Участники

| Запрос | Что делает |
|---|---|
| `GET /api/sites/:siteId/invitations` | приглашения сайта (владелец), последние 100, без токенов |
| `POST /api/sites/:siteId/invitations` | пригласить `{ email, role: "editor" \| "client" }` → 201, письмо в очередь. Владелец или участник — 409; нет почты — 503; лимит — 429 |
| `DELETE /api/sites/:siteId/invitations/:invitationId` | отозвать: 204 (и повторно); принятое — 409 |
| `POST /api/invitations/lookup` | что за приглашение по токену: сайт, роль, кто пригласил, есть ли вход у адреса. **Открыт** |
| `POST /api/invitations/register` | принять новым пользователем `{ token, name, password }` → 201. **Открыт**. У адреса уже есть вход — 409 `user_exists` |
| `POST /api/invitations/accept` | принять под текущим входом `{ token }`; другой адрес или токен API — 403 |

Ошибки ссылки: 404 `invitation_not_found`, 410 `invitation_used` / `invitation_revoked` /
`invitation_expired`. Токен всегда в теле, не в пути: путь пишется в лог.

## Почта (только владелец)

| Запрос | Что делает |
|---|---|
| `GET /api/mail` | состояние почты (провайдер без пароля или причина), `maxAttempts`, `retentionDays`, `linkWarning`, список шаблонов |
| `GET /api/mail/smtp` | настройки SMTP без пароля: откуда (`env`, `database`, `none`), можно ли править и почему нет, состояние пароля |
| `POST /api/mail/smtp/check` | проверить ещё не сохранённые настройки по шагам → `{ ok, steps, checkToken }`. Только порты 465 и 587, 10 проверок за 15 минут |
| `PUT /api/mail/smtp` | сохранить: настройки, `currentPassword` и `checkToken` или `skipCheck: true`. Неверный пароль — 403, проверка устарела — 409 `check_stale`, правка недоступна — 409 `mail_settings_locked` |
| `DELETE /api/mail/smtp` | удалить настройки `{ currentPassword }` |
| `GET /api/mail/outbox` | последние 100 писем очереди со статусом и ошибкой, без данных писем |
| `POST /api/mail/outbox/:id/retry` | вернуть письмо в очередь; отправленное или с истёкшей ссылкой — 409 |
| `GET /api/mail/templates/:template/preview` | шаблон на примерных данных: `subject`, `html`, `text` |

## Заявки (владелец и клиент, токену — 403)

| Запрос | Что делает |
|---|---|
| `POST /api/forms/:siteId/:slug/:blockId` | приём заявки с формы сайта: `application/x-www-form-urlencoded`, до ~227 КБ. Успех — 303 на страницу с `?sent=<id блока>#<id блока>-sent` (адрес «спасибо» для целей аналитики); ошибки — HTML-страница (400, 404, 413, 415, 429, 500); с `Accept` без `text/html` — JSON. **Открыт** |
| `GET /api/sites/:siteId/leads` | заявки, новые сверху, до 500; `?status=new\|processed`; состояние уведомлений |
| `GET /api/sites/:siteId/leads/recent` | последние для обзора, `?limit=1…20` (по умолчанию 3), без согласия |
| `GET /api/sites/:siteId/leads/:leadId` | заявка целиком |
| `PATCH /api/sites/:siteId/leads/:leadId` | `{ status: "processed" \| "new" }` |
| `DELETE /api/sites/:siteId/leads/:leadId` | удалить: 204 |
| `GET /api/sites/:siteId/leads/export` | все заявки в CSV потоком: `;`, UTF-8 с BOM, формулы обезврежены |
| `GET /api/sites/:siteId/leads/settings` | адреса уведомлений, срок хранения, подтверждение посетителю |
| `PUT /api/sites/:siteId/leads/settings` | сохранить: до 10 адресов, срок 7–1825 дней; сменились адреса — письмо владельцам и прежним адресам |

## Сборка и выгрузка

| Запрос | Что делает |
|---|---|
| `GET /api/sites/:siteId/build` | сборка на сервере: `enabled`, последняя (`latest`) и та, что на сайте (`live`) |
| `POST /api/sites/:siteId/build` | «Собрать заново» (владелец, редактор, токен) → 202; без `PUBLISH_DIR` — 409 `publish_disabled` |
| `GET /api/sites/:siteId/export/static` | ZIP текущей версии сайта потоком; токену — 403. Без сборки — 409 `not_built`, больше 3,5 ГБ — 413 |
| `GET /api/sites/:siteId/export/data` | ZIP с `site.json`, оригиналами картинок и `README.txt` — владелец и клиент |

## Открытые маршруты

Ровно эти и `/api/auth/*`: `GET /api/health`, `GET /api/health/ready`,
`GET /api/sites/:siteId/snapshot`, `GET /api/site/snapshot`, `GET /api/site/fallback/*`,
`GET /api/sites/:siteId/icons/:file`, `GET /api/media/:mediaId/:file`, `GET /api/password-reset`,
`POST /api/invitations/lookup`, `POST /api/invitations/register`,
`POST /api/forms/:siteId/:slug/:blockId`. Список живёт в `src/auth/middleware.ts`: открыть новый
маршрут — значит осознанно вписать его туда ([Доступ и секреты](/averra-cms/dev/security/)).
