import type { LeadStatus } from '@averra/schema'
import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { api } from './api'
import { apiRequestError } from './errors'

// Ключи идут от общего к частному: сброс ['sites', id, 'pages'] после мутации
// заодно сбрасывает и каждую страницу этого сайта
export const queryKeys = {
  me: ['me'] as const,
  currentSite: ['current-site'] as const,
  site: (siteId: string) => ['sites', siteId] as const,
  pages: (siteId: string) => ['sites', siteId, 'pages'] as const,
  page: (siteId: string, slug: string) => ['sites', siteId, 'pages', slug] as const,
  revisions: (siteId: string, slug: string) =>
    ['sites', siteId, 'pages', slug, 'revisions'] as const,
  revision: (siteId: string, slug: string, revisionId: string) =>
    ['sites', siteId, 'pages', slug, 'revisions', revisionId] as const,
  media: (siteId: string) => ['sites', siteId, 'media'] as const,
  build: (siteId: string) => ['sites', siteId, 'build'] as const,
  invitations: (siteId: string) => ['sites', siteId, 'invitations'] as const,
  leads: (siteId: string) => ['sites', siteId, 'leads'] as const,
  leadList: (siteId: string, status: LeadStatus | undefined) =>
    ['sites', siteId, 'leads', 'list', status ?? 'all'] as const,
  recentLeads: (siteId: string) => ['sites', siteId, 'leads', 'recent'] as const,
  lead: (siteId: string, leadId: string) => ['sites', siteId, 'leads', 'item', leadId] as const,
  leadSettings: (siteId: string) => ['sites', siteId, 'leads', 'settings'] as const,
  siteSettings: (siteId: string) => ['sites', siteId, 'settings'] as const,
  theme: (siteId: string) => ['sites', siteId, 'theme'] as const,
  header: (siteId: string) => ['sites', siteId, 'header'] as const,
  passwordReset: ['password-reset'] as const,
  invitation: (token: string) => ['invitation', token] as const,
  notifications: ['notifications'] as const,
  notificationOutbox: ['notifications', 'outbox'] as const,
  siteNotifications: (siteId: string) => ['sites', siteId, 'notifications'] as const,
  linkState: (siteId: string | null, id: string) =>
    ['notifications', 'link', siteId ?? 'service', id] as const,
  mail: ['mail'] as const,
  mailOutbox: ['mail', 'outbox'] as const,
  mailSmtp: ['mail', 'smtp'] as const,
  mailPreview: (template: string) => ['mail', 'templates', template] as const,
  status: ['status'] as const,
}

/**
 * Сайт установки: одна установка — один сайт, и в адресах админки id сайта нет. Отсюда админка
 * узнаёт id, а дальше ходит в /api/sites/:siteId/… как раньше. Ещё здесь название и адрес
 * сайта для боковой панели. Не устаревает сам: сайт у установки не меняется, а при смене
 * пользователя кеш сбрасывает switchUser
 */
export const currentSiteQuery = () =>
  queryOptions({
    queryKey: queryKeys.currentSite,
    queryFn: async () => {
      const res = await api.site.$get()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

/** Id сайта установки для загрузчиков маршрутов: из кеша или одним запросом */
export const siteIdOf = async (queryClient: QueryClient) =>
  (await queryClient.ensureQueryData(currentSiteQuery())).id

export const siteQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.site(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Тема сайта: черновик с экрана «Тема», опубликованная и есть ли разница между ними */
export const themeQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.theme(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].theme.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * Шапка сайта и меню: черновик, что на сайте, цели меню (страницы с блоками) и телефон с адресом
 * организации для предпросмотра
 */
export const headerQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.header(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].header.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

export const pagesQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.pages(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].pages.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

export const pageQuery = (siteId: string, slug: string) =>
  queryOptions({
    queryKey: queryKeys.page(siteId, slug),
    queryFn: async () => {
      const res = await api.sites[':siteId'].pages[':slug'].$get({ param: { siteId, slug } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** История публикаций страницы, новые сверху. Публикация сбрасывает её вместе со списком страниц */
export const revisionsQuery = (siteId: string, slug: string) =>
  queryOptions({
    queryKey: queryKeys.revisions(siteId, slug),
    queryFn: async () => {
      const res = await api.sites[':siteId'].pages[':slug'].revisions.$get({
        param: { siteId, slug },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Версия с содержимым. Снимок в истории не меняется никогда, поэтому и не устаревает */
export const revisionQuery = (siteId: string, slug: string, revisionId: string) =>
  queryOptions({
    queryKey: queryKeys.revision(siteId, slug, revisionId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].pages[':slug'].revisions[':revisionId'].$get({
        param: { siteId, slug, revisionId },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

/** Медиатека сайта, новые сверху. Её же берёт предпросмотр редактора, чтобы показать картинки */
export const mediaQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.media(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].media.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * Сборка сайта на сервере после публикации: последняя сборка и версия на сайте. Без PUBLISH_DIR
 * (разработка) — enabled: false, и ни обзор, ни «Настройки сайта» сборку не показывают
 */
export const buildQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.build(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].build.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Приглашения на сайт, новые сверху. Только у владельца: остальным API ответит 403 */
export const invitationsQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.invitations(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].invitations.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * Заявки сайта, новые сверху (только новые или только обработанные — status), и уходят ли
 * уведомления о них. Видят владелец и клиент сайта, редактору API ответит 403
 */
export const leadsQuery = (siteId: string, status?: LeadStatus) =>
  queryOptions({
    queryKey: queryKeys.leadList(siteId, status),
    queryFn: async () => {
      const res = await api.sites[':siteId'].leads.$get({
        param: { siteId },
        query: status ? { status } : {},
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * Последние заявки для обзора сайта: три штуки и только поля карточки (откуда, кто, что, когда).
 * Полный список с персональными данными обзору не нужен. Ключ — под queryKeys.leads: обработка
 * заявки и настройки обновляют и его
 */
export const recentLeadsQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.recentLeads(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].leads.recent.$get({ param: { siteId }, query: {} })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Заявка целиком: поля, согласие, статус */
export const leadQuery = (siteId: string, leadId: string) =>
  queryOptions({
    queryKey: queryKeys.lead(siteId, leadId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].leads[':leadId'].$get({ param: { siteId, leadId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Настройки заявок сайта: адреса уведомлений, срок хранения, подтверждение посетителю */
export const leadSettingsQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.leadSettings(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].leads.settings.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * SEO и настройки сайта (раздел «SEO»): настройки, адрес установки и адрес сайта, который из них
 * выходит. Только владельцу: остальным API ответит 403
 */
export const siteSettingsQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.siteSettings(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].settings.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Работает ли сброс пароля по почте. Открыт без входа: его спрашивает «Забыли пароль?» */
export const passwordResetQuery = () =>
  queryOptions({
    queryKey: queryKeys.passwordReset,
    queryFn: async () => {
      const res = await api['password-reset'].$get()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * Приглашение по токену из ссылки: сайт, роль, кто пригласил и есть ли уже вход у адреса.
 * Не кешируется надолго: после принятия та же ссылка уже не работает
 */
export const invitationQuery = (token: string) =>
  queryOptions({
    queryKey: queryKeys.invitation(token),
    queryFn: async () => {
      const res = await api.invitations.lookup.$post({ json: { token } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    gcTime: 0,
  })

/** Почта: включена ли, провайдер без секретов, настройки очереди и список шаблонов */
export const mailQuery = () =>
  queryOptions({
    queryKey: queryKeys.mail,
    queryFn: async () => {
      const res = await api.mail.$get()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * Настройки SMTP: откуда они (окружение, админка или нигде), можно ли менять и почему нет.
 * Пароля в ответе нет — только «задан» или «не читается»
 */
export const mailSmtpQuery = () =>
  queryOptions({
    queryKey: queryKeys.mailSmtp,
    queryFn: async () => {
      const res = await api.mail.smtp.$get()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * Состояние установки: версия, бэкапы, обновление, сборки, почта, диск и список проблем.
 * Только владельцу: остальным API ответит 403
 */
export const statusQuery = () =>
  queryOptions({
    queryKey: queryKeys.status,
    queryFn: async () => {
      const res = await api.status.$get()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * Уведомления установки: каналы (без секретов — у Telegram только «токен задан»), служебные
 * события и их получатели. Только владельцу: остальным API ответит 403
 */
export const notificationsQuery = () =>
  queryOptions({
    queryKey: queryKeys.notifications,
    queryFn: async () => {
      const res = await api.notifications.$get()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Последние сообщения очереди уведомлений (Telegram), новые сверху. Только владельцу */
export const notificationOutboxQuery = () =>
  queryOptions({
    queryKey: queryKeys.notificationOutbox,
    queryFn: async () => {
      const res = await api.notifications.outbox.$get()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/**
 * Получатели уведомлений о заявках сайта, готовность каналов (имя бота для привязки) и куда
 * уведомления уходят сейчас. Владельцу и клиенту, редактору API ответит 403
 */
export const siteNotificationsQuery = (siteId: string) =>
  queryOptions({
    queryKey: queryKeys.siteNotifications(siteId),
    queryFn: async () => {
      const res = await api.sites[':siteId'].notifications.$get({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Последние письма очереди, новые сверху */
export const mailOutboxQuery = () =>
  queryOptions({
    queryKey: queryKeys.mailOutbox,
    queryFn: async () => {
      const res = await api.mail.outbox.$get()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

/** Id шаблона письма — тот же список, что у API */
export type MailTemplateId = Parameters<
  (typeof api.mail.templates)[':template']['preview']['$get']
>[0]['param']['template']

/** Шаблон письма на примерных данных. Шаблоны живут в коде и между выкладками не меняются */
export const mailPreviewQuery = (template: MailTemplateId) =>
  queryOptions({
    queryKey: queryKeys.mailPreview(template),
    queryFn: async () => {
      const res = await api.mail.templates[':template'].preview.$get({
        param: { template },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

/**
 * Кто вошёл. null — сессии нет (ответ 401): это не ошибка, а повод показать вход.
 * Не устаревает сам: сбрасывается при входе, выходе и любом 401
 */
export const meQuery = () =>
  queryOptions({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const res = await api.me.$get()
      if (res.status === 401) return null
      if (res.status !== 200) throw await apiRequestError(res)
      const me = await res.json()
      return me.kind === 'user' ? me.user : null
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

/**
 * Сменился пользователь (вход или выход): всё, что загружено до этого, — уже не про него.
 * Запрос «кто вошёл» не удаляем, а обновляем на месте: боковая панель подписана на него,
 * и удалённый запрос она бы так и показывала (clear() оставил бы в панели прошлого пользователя)
 */
export async function switchUser(queryClient: QueryClient, signedIn: boolean) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] })
  if (signedIn) await queryClient.resetQueries({ queryKey: queryKeys.me })
  else queryClient.setQueryData(queryKeys.me, null)
}
