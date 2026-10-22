import { CookieNotice, cookieNoticeView, LegalFooter } from '@averra/blocks'
import {
  COOKIE_TEXT_MAX,
  CookieLook,
  CookieMode,
  type CookieSettings,
  cookieLookTitles,
  cookieModeTitles,
  cookieNoticeShown,
  defaultCookieText,
  type LegalDocument,
  legalPages,
  PageContent,
} from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { api } from '../api'
import { type Device, DeviceSwitch, Preview } from '../editor/Preview'
import { apiRequestError, messageOf } from '../errors'
import { pagesQuery, queryKeys, siteQuery, siteSettingsQuery } from '../queries'
import { CookieLookSketch } from '../seo/CookieLookSketch'
import { legalPageOf, policyOptions, policyProblem, previewAnalytics } from '../seo/cookies-format'
import { SettingsCardActions } from '../seo/SettingsCard'
import { UnsavedChangesGuard } from '../seo/unsaved'
import { useSettingsForm } from '../seo/use-settings-form'
import { Button, buttonClassName, iconButtonClassName } from '../ui/Button'
import { cx } from '../ui/cx'
import { Select, TextArea } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { formClassName, Screen, Section } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'
import styles from './CookiesScreen.module.scss'

const modeDescriptions: Record<CookieMode, string> = {
  consent:
    'Метрика и GA подключаются только после «Принять все» или включённой аналитики в настройках. Строже по 152-ФЗ; часть посетителей не попадёт в статистику.',
  notice:
    'Аналитика работает сразу, посетитель видит «Мы используем cookie» и кнопку «Понятно». Проще, но согласием это считать трудно.',
}

const legalTitles: Record<LegalDocument, string> = {
  privacy: 'Политика конфиденциальности',
  consent: 'Согласие на обработку персональных данных — для форм заявок',
}

/**
 * «SEO и аналитика» → «Cookie и согласие»: как сайт говорит о cookie и когда подключает счётчики.
 * Режим, вид, текст и страница политики; справа — предпросмотр в цветах сайта теми же
 * компонентами, что собирают сайт. Шаблоны политики и согласия создают черновики страниц
 */
export function CookiesScreen() {
  const siteId = useSiteId()
  const { data: view } = useSuspenseQuery(siteSettingsQuery(siteId))
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  usePageTitle('Cookie и согласие', view.settings.name)

  const [values, setValues] = useState<CookieSettings>(view.settings.cookies)
  const form = useSettingsForm({
    siteId,
    patch: { cookies: values },
    done: 'Настройки cookie сохранены. Сайт пересобирается',
    onSaved: (settings) => setValues(settings.cookies),
  })
  const set = <K extends keyof CookieSettings>(key: K, value: CookieSettings[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    form.clear(`cookies.${key}`)
  }

  const analytics = view.settings.analytics
  const shown = cookieNoticeShown(analytics)
  const problem = policyProblem(pages, values.policyPage)

  return (
    <Screen>
      <PageHeader
        back={
          <Link to="/seo" className={iconButtonClassName()} aria-label="Назад к SEO">
            <Icon name="chevron-left" />
          </Link>
        }
        eyebrow={view.settings.name}
        title="Cookie и согласие"
        meta="Как сайт предупреждает посетителей о cookie и когда подключает аналитику"
      />
      <UnsavedChangesGuard>
        <div className={styles.layout}>
          <form
            ref={form.formRef}
            aria-label="Cookie и согласие"
            className={cx(formClassName, styles.form)}
            onSubmit={form.submit}
            noValidate
          >
            {!shown && (
              <InlineAlert
                tone="info"
                title="На сайте нет счётчиков — уведомления нет"
                action={
                  <Link to="/seo" hash="analytics" className={buttonClassName({ size: 'small' })}>
                    Аналитика
                  </Link>
                }
              >
                Без Метрики и GA4 сайт не ставит cookie, и предупреждать не о чем. Настройки ниже
                заработают, когда вы добавите счётчик. Ссылка на политику внизу страниц есть и
                сейчас.
              </InlineAlert>
            )}
            <Section title="Режим" card>
              <SegmentedControl
                legend="Режим"
                hideLegend
                appearance="list"
                name="cookies.mode"
                options={CookieMode.options.map((mode) => ({
                  value: mode,
                  label:
                    mode === 'consent'
                      ? `${cookieModeTitles[mode]} · рекомендуем`
                      : cookieModeTitles[mode],
                  description: modeDescriptions[mode],
                }))}
                value={values.mode}
                onChange={(mode) => set('mode', mode)}
              />
            </Section>
            <Section title="Вид" card>
              <SegmentedControl
                legend="Вид уведомления"
                hideLegend
                appearance="cards"
                fill
                name="cookies.look"
                options={CookieLook.options.map((look) => ({
                  value: look,
                  label: cookieLookTitles[look],
                  thumbnail: <CookieLookSketch look={look} />,
                }))}
                value={values.look}
                onChange={(look) => set('look', look)}
              />
            </Section>
            <Section title="Тексты и политика" card>
              <TextArea
                label="Текст уведомления"
                name="cookies.text"
                rows={3}
                maxChars={COOKIE_TEXT_MAX}
                value={values.text}
                placeholder={defaultCookieText(values.mode, previewAnalytics(analytics))}
                onChange={(event) => set('text', event.target.value)}
                error={form.error('cookies.text')}
                hint="Пусто — текст по умолчанию: он называет счётчики сайта. Ссылка на политику добавляется сама"
              />
              <div className={styles.policyRow}>
                <Select
                  label="Страница политики конфиденциальности"
                  name="cookies.policyPage"
                  value={values.policyPage}
                  onChange={(event) => set('policyPage', event.target.value)}
                  error={form.error('cookies.policyPage')}
                >
                  {policyOptions(pages, values.policyPage).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              {problem && <InlineAlert tone="warning">{problem}</InlineAlert>}
              <LegalTemplates
                siteId={siteId}
                onCreated={(document) => {
                  if (document === 'privacy' && values.policyPage === '') {
                    set('policyPage', legalPages.privacy.slug)
                  }
                }}
              />
            </Section>
            {form.notice?.kind === 'error' && (
              <InlineAlert tone="danger">{form.notice.text}</InlineAlert>
            )}
            <SettingsCardActions
              saveLabel="Сохранить"
              pending={form.pending}
              unsaved={form.unsaved}
            />
            {form.notice?.kind === 'done' && (
              <InlineAlert tone="success" live>
                {form.notice.text}
              </InlineAlert>
            )}
          </form>
          <CookiePreview
            cookies={values}
            analytics={analytics}
            published={pages.flatMap((page) => (page.publishedAt === null ? [] : [page.slug]))}
            theme={site.theme}
            siteName={view.settings.name}
            shown={shown}
          />
        </div>
      </UnsavedChangesGuard>
    </Screen>
  )
}

type PreviewProps = {
  cookies: CookieSettings
  analytics: { metrika: string; ga4: string }
  published: string[]
  theme: Parameters<typeof Preview>[0]['theme']
  siteName: string
  /** На сайте есть счётчик: иначе уведомления на сайте нет, предпросмотр — на будущее */
  shown: boolean
}

/**
 * Предпросмотр: первый экран сайта в его теме и уведомление поверх — те же компоненты, что на
 * сайте. Без счётчиков уведомления нет, виден только подвал со ссылкой на политику
 */
function CookiePreview(props: PreviewProps) {
  const { cookies, analytics, published, theme, siteName, shown } = props
  const [device, setDevice] = useState<Device>('phone')
  // Предпросмотр показывает уведомление и без счётчиков: видно, как оно встанет, когда их добавят
  const { notice, footer } = cookieNoticeView(
    { cookies, analytics: previewAnalytics(analytics) },
    published,
  )
  const content = useMemo(
    () =>
      PageContent.parse({
        blocks: [
          {
            id: 'preview',
            type: 'hero',
            props: {
              variant: 'left',
              title: siteName,
              subtitle: 'Так посетитель увидит уведомление о cookie на любой странице сайта.',
            },
          },
        ],
      }),
    [siteName],
  )
  return (
    <div className={styles.aside}>
      <Section title="Как увидят посетители" card>
        <div className={styles.preview}>
          <Preview
            title="Предпросмотр уведомления о cookie"
            content={content}
            theme={theme}
            media={{}}
            device={device}
            selectedId={null}
            toolbar={<DeviceSwitch value={device} onChange={setDevice} />}
            extra={
              <>
                <LegalFooter {...footer} />
                {notice && <CookieNotice {...notice} preview />}
              </>
            }
          />
        </div>
        <p className={styles.note}>
          {!shown && 'Счётчиков нет — так уведомление будет выглядеть, когда вы их добавите. '}
          Цвета и шрифт берутся из темы сайта. Выбор посетителя хранится год; ссылка «Настройки
          cookie» внизу страницы снова откроет окно.
        </p>
      </Section>
    </div>
  )
}

/**
 * Документы из шаблона: черновик страницы с реквизитами из «SEO» → «Организация» и сервисами,
 * которые на сайте включены. Страница уже есть — ссылка в редактор вместо кнопки
 */
function LegalTemplates({
  siteId,
  onCreated,
}: {
  siteId: string
  onCreated: (document: LegalDocument) => void
}) {
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const queryClient = useQueryClient()
  const [created, setCreated] = useState<LegalDocument>()
  const create = useMutation({
    mutationFn: async (document: LegalDocument) => {
      const res = await api.sites[':siteId'].settings['legal-pages'].$post({
        param: { siteId },
        json: { document },
      })
      if (res.status !== 201) throw await apiRequestError(res)
      return document
    },
    onSuccess: async (document) => {
      setCreated(document)
      onCreated(document)
      await queryClient.invalidateQueries({ queryKey: queryKeys.pages(siteId), exact: true })
    },
  })

  return (
    <div className={styles.templates}>
      {(['privacy', 'consent'] as const).map((document) => {
        const page = legalPageOf(pages, document)
        return (
          <div key={document} className={styles.template}>
            <span className={styles.templateTitle}>{legalTitles[document]}</span>
            {page ? (
              <Link
                to="/pages/$slug"
                params={{ slug: page.slug }}
                className={buttonClassName({ size: 'small' })}
              >
                Открыть /{page.slug} в редакторе
              </Link>
            ) : (
              <Button
                size="small"
                loading={create.isPending && create.variables === document}
                onClick={() => create.mutate(document)}
              >
                Создать из шаблона
              </Button>
            )}
          </div>
        )
      })}
      <p className={styles.note}>
        Шаблон подставит название, ИНН, ОГРН, адрес и почту из «SEO» → «Организация» и упомянет
        включённые сервисы: счётчики, формы заявок, уведомления в Telegram. Это черновик, а не
        юридическая гарантия: проверьте текст с юристом перед публикацией. Форма заявки ссылается на
        /privacy и /consent.
      </p>
      {created && !create.isPending && (
        <InlineAlert tone="success" live>
          Черновик «{legalPages[created].title}» создан. Проверьте его с юристом, поправьте и
          опубликуйте.
        </InlineAlert>
      )}
      {create.isError && (
        <InlineAlert tone="danger">Не удалось создать: {messageOf(create.error)}</InlineAlert>
      )}
    </div>
  )
}
