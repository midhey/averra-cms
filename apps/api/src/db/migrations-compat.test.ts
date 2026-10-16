import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Миграции — только совместимые вперёд (CONVENTIONS, «База»; шаг 3.7): прежняя версия API должна
// работать на базе после миграций новой. Обновление останавливает прежний API до бэкапа, так что
// одновременно две версии не работают; совместимость нужна при откате образа, когда база не
// восстановилась (вторая линия), и при откате руками на прежний образ. Удалить (таблицу, колонку,
// индекс, ограничение, любой другой объект), переименовать, сменить тип, сделать колонку
// обязательной, снять DEFAULT, наложить новое ограничение на существующие данные — только вторым
// шагом двухшагового процесса, с пометкой «-- averra:compat <почему безопасно>» прямо перед этой
// инструкцией. Пометка разрешает одну инструкцию, а не всю миграцию

const folder = fileURLToPath(new URL('../../drizzle', import.meta.url))

/** Пометка второго шага: без объяснения не считается */
const COMPAT_MARK = /^--[ \t]*averra:compat[ \t]+\S.{9,}$/

/**
 * Миграции до первого релиза (шаг 3.6): установок со старой схемой тогда не было, поэтому эти
 * ограничения на существующие таблицы прошли одним шагом. Список закрыт — новые сюда не попадают
 */
const BEFORE_FIRST_RELEASE = new Set([
  '0002_page_published_with_title.sql: новое ограничение на существующие данные',
  '0007_mail_outbox_data_lifetime.sql: новое ограничение на существующие данные',
])

type Finding = { rule: string; statement: string }

/** Что миграция заводит сама: новые таблицы и колонки. Ограничения на них совместимы */
type Created = { tables: Set<string>; columns: Set<string> }

const ident = /"([^"]+)"/g
const names = (text: string) => [...text.matchAll(ident)].map((match) => match[1] ?? '')

/** Таблица ALTER TABLE / CREATE … INDEX … ON (без схемы) */
function tableOf(statement: string) {
  const alter = /\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:"[^"]+"\.)?"([^"]+)"/i.exec(statement)
  if (alter) return alter[1] ?? ''
  const on = /\bON\s+(?:ONLY\s+)?(?:"[^"]+"\.)?"([^"]+)"/i.exec(statement)
  return on?.[1] ?? ''
}

/**
 * Ограничение или уникальный индекс касается только того, что заведено этой же миграцией: новой
 * таблицы или новых колонок (прежний код их не пишет — там NULL или DEFAULT). Иначе прежний код
 * может нарушить его своими вставками
 */
function touchesOnlyNew(statement: string, created: Created) {
  const table = tableOf(statement)
  if (created.tables.has(table)) return true
  // Колонки: у внешнего ключа — в FOREIGN KEY (…), у остального — все имена после имени
  // ограничения или индекса, кроме самой таблицы, схемы и того, на что ссылается ключ
  const fk = /\bFOREIGN\s+KEY\s*\(([^)]*)\)/i.exec(statement)
  const body = fk
    ? (fk[1] ?? '')
    : statement
        .replace(
          /^[\s\S]*?\b(?:ADD\s+CONSTRAINT\s+"[^"]+"|INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"[^"]+"\s+ON\s+(?:ONLY\s+)?(?:"[^"]+"\.)?"[^"]+")/i,
          '',
        )
        .replace(/\bREFERENCES\b[\s\S]*$/i, '')
  const columns = names(body).filter((name) => name !== table && name !== 'public')
  return columns.length > 0 && columns.every((column) => created.columns.has(`${table}.${column}`))
}

const rules: { rule: string; test: (statement: string, created: Created) => boolean }[] = [
  { rule: 'удаление таблицы', test: (s) => /\bDROP\s+TABLE\b/i.test(s) },
  { rule: 'удаление колонки', test: (s) => /\bDROP\s+COLUMN\b/i.test(s) },
  { rule: 'переименование', test: (s) => /\bRENAME\b/i.test(s) },
  {
    rule: 'смена типа колонки',
    test: (s) => /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i.test(s),
  },
  { rule: 'NOT NULL у существующей колонки', test: (s) => /\bSET\s+NOT\s+NULL\b/i.test(s) },
  {
    // Новая обязательная колонка без значения по умолчанию: прежний код пишет строки без неё
    rule: 'новая NOT NULL-колонка без DEFAULT',
    test: (s) =>
      /\bADD\s+COLUMN\b/i.test(s) && /\bNOT\s+NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s),
  },
  {
    // drizzle-kit пишет его, когда из схемы убрали .default(): вставки прежнего кода без этой
    // колонки упадут на NOT NULL
    rule: 'снятие DEFAULT',
    test: (s) => /\bALTER\s+COLUMN\s+\S+\s+DROP\s+DEFAULT\b/i.test(s),
  },
  {
    // UNIQUE, CHECK, внешний ключ, первичный ключ на существующих данных: прежний код их не знает
    rule: 'новое ограничение на существующие данные',
    test: (s, created) => /\bADD\s+CONSTRAINT\b/i.test(s) && !touchesOnlyNew(s, created),
  },
  {
    rule: 'уникальный индекс на существующие данные',
    test: (s, created) => /\bCREATE\s+UNIQUE\s+INDEX\b/i.test(s) && !touchesOnlyNew(s, created),
  },
  {
    // Перечисления Postgres: удалить, переименовать значение или сам тип — прежний код их пишет
    rule: 'изменение или удаление типа',
    test: (s) => /\b(DROP|ALTER)\s+TYPE\b/i.test(s),
  },
  {
    // Прежний код опирается на уникальные индексы в ON CONFLICT (users_email_unique,
    // pages_site_slug_unique, …): без индекса вставка падает. По имени не понять, уникальный ли
    // он, поэтому любое удаление индекса — вторым шагом с пометкой (у обычного — «только скорость»)
    rule: 'удаление индекса',
    test: (s) => /\bDROP\s+INDEX\b/i.test(s),
  },
  {
    // Первичный и уникальный ключ — та же опора ON CONFLICT; внешний ключ и CHECK — защита данных
    rule: 'удаление ограничения',
    test: (s) => /\bDROP\s+CONSTRAINT\b/i.test(s),
  },
  {
    rule: 'удаление другого объекта базы',
    test: (s) =>
      /\bDROP\s+(?:MATERIALIZED\s+)?(?:VIEW|SEQUENCE|SCHEMA|FUNCTION|PROCEDURE|TRIGGER|EXTENSION|POLICY|DOMAIN|RULE)\b/i.test(
        s,
      ) || /\bALTER\s+COLUMN\s+\S+\s+DROP\s+(?:IDENTITY|EXPRESSION)\b/i.test(s),
  },
]

/**
 * Удаление, которого нет в правилах выше (другая конструкция SQL), тоже не проходит молча.
 * Снятие NOT NULL — не удаление: прежний код просто всегда пишет значение
 */
const UNKNOWN_DROP = /\bDROP\b(?!\s+NOT\s+NULL\b)/i

type Statement = { sql: string; marked: boolean }

/** Инструкции миграции без комментариев и пометка averra:compat прямо перед каждой */
function statementsOf(sql: string): Statement[] {
  return sql
    .split('--> statement-breakpoint')
    .flatMap((part) => part.split(/;[ \t]*$/m))
    .map((part) => {
      const lines = part.split('\n').map((line) => line.trim())
      const firstCode = lines.findIndex((line) => line && !line.startsWith('--'))
      // Пометка — среди комментариев непосредственно над инструкцией, а не где-то в файле
      const leading = firstCode === -1 ? [] : lines.slice(0, firstCode)
      return {
        // Комментарии не исполняются: «DROP» в комментарии — не удаление
        sql: lines
          .filter((line) => !line.startsWith('--'))
          .join('\n')
          .trim(),
        marked: leading.some((line) => COMPAT_MARK.test(line)),
      }
    })
    .filter((statement) => statement.sql)
}

/** Что миграция создаёт: таблицы и колонки */
function createdBy(statements: Statement[]): Created {
  const created: Created = { tables: new Set(), columns: new Set() }
  for (const { sql } of statements) {
    const table = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"\.)?"([^"]+)"/i.exec(sql)
    if (table?.[1]) created.tables.add(table[1])
    const column = /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i.exec(sql)
    if (column?.[1]) created.columns.add(`${tableOf(sql)}.${column[1]}`)
  }
  return created
}

/** Опасные операции миграции, не разрешённые пометкой averra:compat прямо над ними */
function incompatibleStatements(sql: string): Finding[] {
  const statements = statementsOf(sql)
  const created = createdBy(statements)
  const findings: Finding[] = []
  for (const statement of statements) {
    if (statement.marked) continue
    const before = findings.length
    for (const { rule, test } of rules) {
      if (test(statement.sql, created)) {
        findings.push({ rule, statement: statement.sql.slice(0, 200) })
      }
    }
    if (findings.length === before && UNKNOWN_DROP.test(statement.sql)) {
      findings.push({ rule: 'удаление (не из списка)', statement: statement.sql.slice(0, 200) })
    }
  }
  return findings
}

describe('проверка совместимости миграций', () => {
  it('ловит удаление, переименование, смену типа, NOT NULL, снятие DEFAULT, ограничения и типы', () => {
    const cases: [string, string][] = [
      ['DROP TABLE "leads";', 'удаление таблицы'],
      ['ALTER TABLE "leads" DROP COLUMN "data";', 'удаление колонки'],
      ['ALTER TABLE "leads" RENAME COLUMN "data" TO "fields";', 'переименование'],
      ['ALTER TABLE "leads" RENAME TO "requests";', 'переименование'],
      [
        'ALTER TABLE "leads" ALTER COLUMN "page_version" SET DATA TYPE bigint;',
        'смена типа колонки',
      ],
      ['ALTER TABLE "leads" ALTER COLUMN "page_version" TYPE text;', 'смена типа колонки'],
      [
        'ALTER TABLE "leads" ALTER COLUMN "page_version" SET NOT NULL;',
        'NOT NULL у существующей колонки',
      ],
      [
        'ALTER TABLE "leads" ADD COLUMN "source" text NOT NULL;',
        'новая NOT NULL-колонка без DEFAULT',
      ],
      ['ALTER TABLE "leads" ALTER COLUMN "data_bytes" DROP DEFAULT;', 'снятие DEFAULT'],
      [
        'ALTER TABLE "leads" ADD CONSTRAINT "leads_email_unique" UNIQUE("email");',
        'новое ограничение на существующие данные',
      ],
      [
        'ALTER TABLE "sites" ADD CONSTRAINT "sites_name_short" CHECK (length("sites"."name") < 100);',
        'новое ограничение на существующие данные',
      ],
      [
        'ALTER TABLE "leads" ADD CONSTRAINT "leads_page_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id");',
        'новое ограничение на существующие данные',
      ],
      [
        'CREATE UNIQUE INDEX "leads_email_unique" ON "leads" USING btree ("site_id","email");',
        'уникальный индекс на существующие данные',
      ],
      ['DROP TYPE "public"."lead_status";', 'изменение или удаление типа'],
      [
        'ALTER TYPE "public"."lead_status" RENAME VALUE \'new\' TO \'fresh\';',
        'изменение или удаление типа',
      ],
      // Уникальные индексы и ключи — опора ON CONFLICT прежнего кода
      ['DROP INDEX "users_email_unique";', 'удаление индекса'],
      ['DROP INDEX IF EXISTS "public"."pages_site_slug_unique";', 'удаление индекса'],
      [
        'ALTER TABLE "mail_settings" DROP CONSTRAINT "mail_settings_site_unique";',
        'удаление ограничения',
      ],
      [
        'ALTER TABLE "site_members" DROP CONSTRAINT "site_members_site_id_user_id_pk";',
        'удаление ограничения',
      ],
      ['DROP VIEW "lead_stats";', 'удаление другого объекта базы'],
      ['DROP MATERIALIZED VIEW "lead_stats";', 'удаление другого объекта базы'],
      ['DROP SEQUENCE "public"."lead_number_seq";', 'удаление другого объекта базы'],
      ['DROP SCHEMA "old" CASCADE;', 'удаление другого объекта базы'],
      ['ALTER TABLE "leads" ALTER COLUMN "number" DROP IDENTITY;', 'удаление другого объекта базы'],
      ['DROP STATISTICS "leads_stats";', 'удаление (не из списка)'],
    ]
    for (const [sql, rule] of cases) {
      expect(
        incompatibleStatements(sql).map((f) => f.rule),
        sql,
      ).toContain(rule)
    }
  })

  it('пропускает совместимое: новые таблицы и колонки, индексы, снятие NOT NULL, ограничения на новое', () => {
    const sql = [
      'CREATE TABLE "x" ("id" uuid PRIMARY KEY NOT NULL, "name" text NOT NULL, "site_id" uuid);',
      'ALTER TABLE "leads" ADD COLUMN "source" text;',
      'ALTER TABLE "leads" ADD COLUMN "data_bytes" integer DEFAULT 0 NOT NULL;',
      'CREATE INDEX "x_idx" ON "x" USING btree ("name");',
      'ALTER TABLE "mail_outbox" ALTER COLUMN "data" DROP NOT NULL;',
      // Ограничения на новую таблицу и на новые колонки: прежний код их не пишет
      'ALTER TABLE "x" ADD CONSTRAINT "x_site_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id");',
      'CREATE UNIQUE INDEX "x_name_unique" ON "x" USING btree ("name");',
      'ALTER TABLE "leads" ADD CONSTRAINT "leads_bytes_valid" CHECK ("leads"."data_bytes" >= 0);',
      'CREATE UNIQUE INDEX "leads_source_unique" ON "leads" USING btree ("source");',
      'CREATE TYPE "public"."lead_status" AS ENUM(\'new\', \'done\');',
      '-- DROP TABLE в комментарии не считается',
    ].join('--> statement-breakpoint\n')
    expect(incompatibleStatements(sql)).toEqual([])
  })

  it('пометка averra:compat с объяснением разрешает только инструкцию под ней', () => {
    const drop = 'ALTER TABLE "leads" DROP COLUMN "old_data";'
    expect(
      incompatibleStatements(
        `-- averra:compat второй шаг: old_data не читает код с версии 0.8.0\n${drop}`,
      ),
    ).toEqual([])
    expect(incompatibleStatements(`-- averra:compat\n${drop}`)).toHaveLength(1)
    // Пометка над разрешённым удалением не прикрывает случайное переименование рядом
    const mixed = [
      `-- averra:compat второй шаг: old_data не читает код с версии 0.8.0\n${drop}`,
      'ALTER TABLE "leads" RENAME COLUMN "data" TO "fields";',
    ].join('--> statement-breakpoint\n')
    expect(incompatibleStatements(mixed).map((f) => f.rule)).toEqual(['переименование'])
    // И без statement-breakpoint: две инструкции подряд — две разные
    expect(
      incompatibleStatements(
        `-- averra:compat второй шаг: old_data не читает код с версии 0.8.0\n${drop}\nDROP TABLE "pages";`,
      ).map((f) => f.rule),
    ).toEqual(['удаление таблицы'])
    // Пометка в конце файла ничего не разрешает
    expect(
      incompatibleStatements(`${drop}\n-- averra:compat второй шаг: старый код не читает old_data`),
    ).toHaveLength(1)
  })

  it('все миграции репозитория совместимы вперёд', () => {
    const files = readdirSync(folder).filter((name) => name.endsWith('.sql'))
    expect(files.length).toBeGreaterThan(10)
    const found = files.flatMap((name) =>
      incompatibleStatements(readFileSync(`${folder}/${name}`, 'utf8'))
        .filter((finding) => !BEFORE_FIRST_RELEASE.has(`${name}: ${finding.rule}`))
        .map((finding) => `${name}: ${finding.rule} — ${finding.statement}`),
    )
    expect(found).toEqual([])
  })

  it('исключения до первого релиза — ровно те, что есть: список не устаревает молча', () => {
    const files = readdirSync(folder).filter((name) => name.endsWith('.sql'))
    const actual = new Set(
      files.flatMap((name) =>
        incompatibleStatements(readFileSync(`${folder}/${name}`, 'utf8')).map(
          (finding) => `${name}: ${finding.rule}`,
        ),
      ),
    )
    expect(actual).toEqual(BEFORE_FIRST_RELEASE)
  })
})
