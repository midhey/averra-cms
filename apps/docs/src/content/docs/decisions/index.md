---
title: Решения
description: "Почему Averra устроена так, а не иначе: короткие записи о принятых решениях."
sidebar:
  label: Как читать
  order: 0
---

Для разработчика, студии и всех, кто спрашивает «почему так». После раздела вы сможете спорить с
решением по существу: знать, что выбрали, почему и чем за это платим, — и не наступить на то, от
чего решение защищает.

У каждой записи три части: **решение**, **почему** и **чем платим**. Решение меняем осознанно —
и тогда переписываем запись.

## Продукт

- [Своя установка у каждого клиента](/averra-cms/decisions/own-install/)
- [Одна установка — один сайт](/averra-cms/decisions/single-site/)
- [Секции, а не свободный холст](/averra-cms/decisions/sections/)
- [Статический сайт, собранный на сервере](/averra-cms/decisions/static-output/)
- [Посетители сайта — потом](/averra-cms/decisions/visitors-later/)
- [Заявки видит клиент, а не редактор и не нейронка](/averra-cms/decisions/leads-access/)
- [SEO и настройки сайта](/averra-cms/decisions/seo-settings/)
- [Cookie-уведомление](/averra-cms/decisions/cookie-consent/)
- [Карточка из заголовка для соцсетей](/averra-cms/decisions/og-card/)
- [SVG-логотипы и блок видео](/averra-cms/decisions/svg-and-video/)
- [Тема сайта и контраст](/averra-cms/decisions/theme-contrast/)
- [Шапка сайта и меню](/averra-cms/decisions/site-header/)

## Стек

- [TypeScript, Hono и проверенные библиотеки](/averra-cms/decisions/stack/)
- [`site_id` с первого дня](/averra-cms/decisions/site-id/)
- [Node 24 LTS закреплена в проекте](/averra-cms/decisions/node-version/)
- [node-postgres в проде, PGlite в разработке](/averra-cms/decisions/node-postgres/)
- [Админка на frontend-kit](/averra-cms/decisions/admin-ui-kit/)

## Безопасность

- [Учебный режим только явно](/averra-cms/decisions/dev-mode/)
- [Токены и ссылки только хешем](/averra-cms/decisions/hashed-tokens/)
- [Пароль SMTP в базе и повторный пароль владельца](/averra-cms/decisions/smtp-password/)

## Почта и формы

- [Письма через очередь (outbox)](/averra-cms/decisions/outbox/)
- [Уведомления: каналы и очередь](/averra-cms/decisions/notifications/)
- [Форма без JavaScript](/averra-cms/decisions/no-js-form/)
- [Антиспам без капчи](/averra-cms/decisions/antispam/)

## Установка и сопровождение

- [Образы в GHCR, а не сборка на месте](/averra-cms/decisions/ghcr-images/)
- [Бэкап проверяется восстановлением](/averra-cms/decisions/verified-backups/)
- [Миграции только совместимые вперёд](/averra-cms/decisions/forward-migrations/)
- [Обновление отвязано от SSH](/averra-cms/decisions/detached-update/)
- [Состояние для студии — по SSH](/averra-cms/decisions/status-over-ssh/)
