import {
  FOOTER_ABOUT_MAX,
  FOOTER_TEXT_MAX,
  type FooterContacts,
  FooterLayout,
  FooterTextFont,
  FooterTone,
  footerLayoutHints,
  footerLayoutTitles,
  footerTextFontTitles,
  footerToneTitles,
} from '@averra/schema'
import { Link } from '@tanstack/react-router'
import { Checkbox, TextArea, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { Section } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import styles from './FooterFields.module.scss'
import { consentNote, organizationNote, policyNote, sectionsNote } from './footer-format'
import type { FooterEditor } from './use-footer-editor'

type FooterFieldsProps = {
  editor: FooterEditor
  /** Контакты «Организации»; null — главная не опубликована, на сайте их ещё нет */
  contacts: FooterContacts | null
  policy: { slug: string; published: boolean }
  /** Страница согласия на обработку данных: ссылка на неё — только на опубликованную */
  consent: { slug: string; published: boolean }
  /**
   * Пунктов в меню опубликованной шапки (null — шапки на сайте нет): разделы на сайте — из неё,
   * а не из черновика меню
   */
  menuOnSite: number | null
  /** Меню в черновике шапки не такое, как на сайте */
  menuEdited: boolean
  /** Страницы, где подвал скрыт: «Подвал скрыт на страницах: «Промо»» */
  hiddenOn: string | undefined
  /** Экраны «SEO» — только владельцу: ссылки на них только ему */
  seoLinks: boolean
  readOnly: boolean
  /** Вид подвала (раскладка, фон, линия, шрифт текста) — только владелец (header.look) */
  lookReadOnly: boolean
}

const toneHints: Record<FooterTone, string> = {
  background: 'Фон страницы: подвал продолжает её, отделяет его линия сверху (её можно убрать)',
  surface:
    'Цвет «Поверхность» темы, как у «Преимуществ»: в светлых темах светлый, в тёмных — тёмный',
  accent:
    'Заливка цветом «Акцент» темы (в светлых темах — тёмная), текст — «Текст на акценте». Контраст уже проверен темой',
}

/**
 * Вкладка «Подвал»: вид (как в концепте — карточки с пояснением), фон из ролей темы, строка «О
 * компании», разделы из меню и тексты формы большого подвала. Реквизиты и контакты здесь не
 * вводятся: они из «SEO → Организация», вкладка говорит, чего там не хватает
 */
export function FooterFields(props: FooterFieldsProps) {
  const { editor, readOnly, lookReadOnly } = props
  const { form, errors } = editor
  const policy = policyNote(props.policy, form.layout)
  const seoLink = (hash: string, text: string) =>
    props.seoLinks ? (
      <Link to="/seo" hash={hash}>
        {text}
      </Link>
    ) : (
      text
    )
  const callback = form.callback
  const setCallback = (key: keyof typeof callback, value: string) =>
    editor.change({ ...form, callback: { ...callback, [key]: value } }, `callback.${key}`)

  return (
    <div className={styles.panel}>
      <Section title="Вид подвала" card>
        <SegmentedControl
          legend="Вид подвала"
          hideLegend
          appearance="list"
          name="layout"
          disabled={lookReadOnly}
          options={FooterLayout.options.map((layout) => ({
            value: layout,
            label: footerLayoutTitles[layout],
            description: footerLayoutHints[layout],
          }))}
          value={form.layout}
          onChange={(layout) => editor.change({ ...form, layout }, 'layout')}
          aria-describedby={errors.layout ? 'footer-layout-error' : undefined}
        />
        {errors.layout && (
          <p id="footer-layout-error" className={styles.error}>
            {errors.layout}
          </p>
        )}
        <p className={styles.note}>
          {organizationNote(props.contacts, form.layout)}{' '}
          {seoLink('organization', 'Открыть «Организацию»')}
        </p>
        <p className={styles.note}>
          Ссылки «Политика конфиденциальности» и «Настройки cookie» есть в любом виде.
        </p>
        {lookReadOnly && !readOnly && (
          <InlineAlert tone="info">
            Вид подвала, фон, линию и шрифт текста меняет владелец установки. Тексты и ссылки вы
            меняете сами.
          </InlineAlert>
        )}
        {policy && (
          <InlineAlert tone="warning">
            {policy} {props.seoLinks && <Link to="/seo/cookies">Открыть «Cookie и согласие»</Link>}
          </InlineAlert>
        )}
      </Section>

      <Section title="Фон" card>
        <SegmentedControl
          legend="Фон подвала"
          hideLegend
          name="tone"
          wrap
          disabled={lookReadOnly}
          options={FooterTone.options.map((tone) => ({
            value: tone,
            label: footerToneTitles[tone],
          }))}
          value={form.tone}
          onChange={(tone) => editor.change({ ...form, tone })}
        />
        <p className={styles.note}>{toneHints[form.tone]}.</p>
        <Checkbox
          label="Линия над подвалом"
          checked={form.divider}
          disabled={lookReadOnly}
          onChange={(event) => editor.change({ ...form, divider: event.target.checked })}
        />
      </Section>

      <Section title="Тексты и ссылки" card>
        <div className={styles.fields}>
          <TextArea
            label="Свой текст"
            name="text"
            rows={2}
            maxChars={FOOTER_TEXT_MAX}
            hint="Подпись, часы работы — с переносами строк. Пусто — без текста"
            value={form.text}
            error={errors.text}
            disabled={readOnly}
            onChange={(event) => editor.change({ ...form, text: event.target.value }, 'text')}
          />
          <SegmentedControl
            legend="Шрифт своего текста"
            name="textFont"
            disabled={lookReadOnly}
            options={FooterTextFont.options.map((font) => ({
              value: font,
              label: footerTextFontTitles[font],
            }))}
            value={form.textFont}
            onChange={(textFont) => editor.change({ ...form, textFont })}
          />
          <Checkbox
            label="© и год"
            hint="«© год название сайта» перед реквизитами; год — год сборки сайта"
            checked={form.copyright}
            disabled={readOnly}
            onChange={(event) => editor.change({ ...form, copyright: event.target.checked })}
          />
          <Checkbox
            label="Ссылка на согласие на обработку данных"
            hint={consentNote(props.consent, form.consent)}
            checked={form.consent}
            disabled={readOnly}
            onChange={(event) => editor.change({ ...form, consent: event.target.checked })}
          />
          <Checkbox
            label="Логотип шапки в подвале"
            hint="Тот же, что в шапке: картинка, знак и подпись"
            checked={form.brand}
            disabled={readOnly}
            onChange={(event) => editor.change({ ...form, brand: event.target.checked })}
          />
        </div>
      </Section>

      {form.layout !== 'simple' && (
        <Section title="Колонки" card>
          <div className={styles.fields}>
            {form.layout === 'columns' && (
              <TextArea
                label="О компании"
                name="about"
                rows={2}
                maxChars={FOOTER_ABOUT_MAX}
                hint="Одно предложение под названием сайта, например «Ремонт квартир под ключ в Перми»"
                value={form.about}
                error={errors.about}
                disabled={readOnly}
                onChange={(event) => editor.change({ ...form, about: event.target.value }, 'about')}
              />
            )}
            <Checkbox
              label="Разделы — пункты меню шапки"
              hint={sectionsNote({ menuOnSite: props.menuOnSite, menuEdited: props.menuEdited })}
              checked={form.sections}
              disabled={readOnly}
              onChange={(event) => editor.change({ ...form, sections: event.target.checked })}
            />
          </div>
        </Section>
      )}

      {form.layout === 'big' && (
        <Section
          title="Форма «Перезвоните мне»"
          description="Телефон и согласие со ссылкой на политику. Заявка придёт в «Заявки» с пометкой «подвал», уведомления — как у форм на страницах"
          card
        >
          <div className={styles.fields}>
            <TextInput
              label="Заголовок формы"
              name="callback.title"
              maxChars={80}
              value={callback.title}
              error={errors['callback.title']}
              disabled={readOnly}
              onChange={(event) => setCallback('title', event.target.value)}
            />
            <TextInput
              label="Текст под заголовком"
              name="callback.text"
              maxChars={200}
              value={callback.text}
              error={errors['callback.text']}
              disabled={readOnly}
              onChange={(event) => setCallback('text', event.target.value)}
            />
            <TextInput
              label="Текст кнопки формы"
              name="callback.button"
              maxChars={40}
              value={callback.button}
              error={errors['callback.button']}
              disabled={readOnly}
              onChange={(event) => setCallback('button', event.target.value)}
            />
            <TextArea
              label="Текст после отправки"
              name="callback.successText"
              rows={2}
              maxChars={300}
              value={callback.successText}
              error={errors['callback.successText']}
              disabled={readOnly}
              onChange={(event) => setCallback('successText', event.target.value)}
            />
          </div>
        </Section>
      )}

      <InlineAlert tone="info">
        {props.hiddenOn ? `${props.hiddenOn}. ` : ''}Скрыть подвал на отдельной странице — в
        редакторе страницы: «SEO» → «Подвал сайта». Ссылки на документы там останутся.
      </InlineAlert>
    </div>
  )
}
