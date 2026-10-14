import { lookup } from 'node:dns/promises'
import { connect as netConnect, type Socket } from 'node:net'
import { createTransport } from 'nodemailer'
import SMTPConnection from 'nodemailer/lib/smtp-connection'
import { composeMail, messageOf } from './compose'
import {
  checkOutgoing,
  type Mailer,
  MailSendError,
  type MailSender,
  type MailStep,
  maskSecrets,
  type OutgoingMail,
  smtpSecrets,
} from './mailer'

/** Настройки SMTP. Пароль живёт только здесь и в замыкании mailer — наружу идёт info без него */
export type SmtpSettings = {
  host: string
  port: number
  /** tls — TLS сразу (465), starttls — обязательный STARTTLS (587). Без шифрования нельзя */
  security: 'tls' | 'starttls'
  user: string
  password: string
  from: MailSender
}

export type SmtpOptions = {
  /**
   * Свой корневой сертификат, которому доверяем вместо системных. Только из кода (тесты
   * с самоподписанным сервером): переменной окружения для него нет. Это не выключает
   * проверку — сертификат сервера по-прежнему должен быть подписан им и подходить к имени
   */
  ca?: string
  /** Тайм-ауты в миллисекундах. Тесты ставят короче */
  timeouts?: Partial<typeof DEFAULT_TIMEOUTS>
  /** Поиск имени в DNS для шага «DNS» в diagnoseSmtp. Тесты подменяют его медленным */
  lookup?: (host: string) => Promise<{ address: string }[]>
}

const DEFAULT_TIMEOUTS = {
  connection: 15_000,
  greeting: 15_000,
  socket: 60_000,
  dns: 10_000,
}

/**
 * Параметры nodemailer. Шифрование обязательно: secure для TLS сразу, requireTLS для STARTTLS
 * (сервер без STARTTLS — ошибка, а не письмо открытым текстом). rejectUnauthorized задан явно:
 * явный параметр сильнее NODE_TLS_REJECT_UNAUTHORIZED=0 в окружении, так что проверку
 * сертификата не выключить и через него. ignoreTLS и opportunisticTLS не задаются никогда
 */
export function smtpConnectionOptions(settings: SmtpSettings, options: SmtpOptions = {}) {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts }
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.security === 'tls',
    requireTLS: settings.security === 'starttls',
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2' as const,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    },
    connectionTimeout: timeouts.connection,
    greetingTimeout: timeouts.greeting,
    socketTimeout: timeouts.socket,
    dnsTimeout: timeouts.dns,
    // Без журналов nodemailer: в отладочном журнале было бы и содержимое писем
    logger: false,
    debug: false,
  }
}

type NodemailerFailure = Error & {
  code?: string
  originalCode?: string
  responseCode?: number
  response?: string
  timeoutType?: string
}

const TLS_CODES = /CERT|SELF_SIGNED|UNABLE_TO_|ERR_TLS|ERR_SSL|EPROTO|HANDSHAKE/i

/** На каком шаге сломалось, по коду ошибки nodemailer и системы */
function stepOf(error: NodemailerFailure): MailStep {
  const codes = `${error.code ?? ''} ${error.originalCode ?? ''}`
  if (error.code === 'EDNS') return 'dns'
  if (error.code === 'EAUTH' || error.code === 'ENOAUTH') return 'auth'
  if (error.code === 'EENVELOPE' || error.code === 'EMESSAGE') return 'send'
  if (
    error.code === 'ETLS' ||
    error.timeoutType === 'UPGRADE_TIMEOUT' ||
    TLS_CODES.test(codes) ||
    /certificate|ssl|tls/i.test(error.message)
  ) {
    return 'tls'
  }
  if (['ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EPROTOCOL'].includes(error.code ?? '')) {
    return 'connection'
  }
  return 'send'
}

function explain(step: MailStep, error: NodemailerFailure, settings: SmtpSettings) {
  const where = `${settings.host}:${settings.port}`
  switch (step) {
    case 'dns':
      return error.originalCode === 'ETIMEOUT'
        ? `DNS не ответил, где сервер ${settings.host}: проверь сеть и DNS-сервер этого компьютера`
        : `Имя сервера ${settings.host} не нашлось в DNS: проверь SMTP_HOST`
    case 'connection':
      return error.code === 'EPROTOCOL'
        ? `${where} ответил не как SMTP-сервер: проверь SMTP_PORT и SMTP_SECURITY`
        : `Не удалось соединиться с ${where}: проверь SMTP_HOST и SMTP_PORT и что порт не закрыт файрволом`
    case 'tls':
      if (
        /STARTTLS/i.test(`${error.message} ${error.response ?? ''}`) &&
        !TLS_CODES.test(`${error.originalCode ?? ''}`)
      ) {
        return `${where} не включил шифрование STARTTLS, а без него письма не уходят: проверь SMTP_PORT и SMTP_SECURITY`
      }
      return settings.security === 'tls'
        ? `Не удалось установить TLS с ${where}: сертификат сервера не прошёл проверку или сервер на этом порту не говорит TLS (для 587 нужен SMTP_SECURITY=starttls)`
        : `Не удалось включить шифрование STARTTLS с ${where}: сертификат сервера не прошёл проверку`
    case 'auth':
      return `Сервер не принял логин или пароль (SMTP_USER, SMTP_PASSWORD)`
    case 'send':
      return error.code === 'EENVELOPE'
        ? 'Сервер не принял адрес отправителя или получателя'
        : 'Сервер не принял письмо'
  }
}

/**
 * Ошибка nodemailer → MailSendError по-русски, с шагом и подробностями от сервера. Пароль и его
 * base64-формы из текста убираются: сервер мог повторить в ответе то, что ему прислали
 */
export function smtpFailure(error: unknown, settings: SmtpSettings) {
  if (error instanceof MailSendError) return error
  const failure = (error instanceof Error ? error : new Error(String(error))) as NodemailerFailure
  const step = stepOf(failure)
  const details = maskSecrets(failure.message, smtpSecrets(settings.user, settings.password))
  // 5xx на адрес или письмо — сервер отказал навсегда, повторять бессмысленно
  const permanent = step === 'send' && (failure.responseCode ?? 0) >= 500
  return new MailSendError(
    `${explain(step, failure, settings)}. Подробности: ${details}`,
    permanent,
    step,
  )
}

/** Отправка через SMTP с обязательным шифрованием. Одно соединение на письмо */
export function smtpMailer(settings: SmtpSettings, options: SmtpOptions = {}): Mailer {
  const transport = createTransport({
    ...smtpConnectionOptions(settings, options),
    auth: { user: settings.user, pass: settings.password },
  })
  return {
    info: {
      kind: 'smtp',
      host: settings.host,
      port: settings.port,
      security: settings.security,
      user: settings.user,
      from: settings.from,
    },
    async send(mail) {
      const message = messageOf(settings.from, mail)
      try {
        const info = await transport.sendMail(message)
        return { messageId: info.messageId }
      } catch (error) {
        throw smtpFailure(error, settings)
      }
    },
    async close() {
      transport.close()
    },
  }
}

const systemLookup = (host: string) => lookup(host, { all: true })

/**
 * Ждёт обещание не дольше ms. dns.lookup не принимает ни тайм-аут, ни AbortSignal, а медленный
 * резолвер может думать долго: шаг DNS ломается по тайм-ауту, а не висит. Сам запрос в DNS
 * доживает в фоне, его результат никому не нужен
 */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: () => Error) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Итог одного шага pnpm mail:test */
export type DiagnosisStep = { step: MailStep; ok: boolean; message: string }

const promisify = <T>(run: (done: (error?: Error | null, result?: T) => void) => void) =>
  new Promise<T | undefined>((resolve, reject) => {
    run((error, result) => (error ? reject(error) : resolve(result)))
  })

/**
 * TCP-соединение без TLS и SMTP: отдельный шаг, чтобы отличить «порт закрыт» от «TLS не вышел».
 * Открытый сокет потом получает nodemailer (параметр connection) и поверх него поднимает TLS
 * или SMTP: второе соединение к серверу не нужно
 */
function tcpConnect(host: string, port: number, timeoutMs: number) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = netConnect({ host, port })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      socket.setTimeout(0)
      socket.removeAllListeners('timeout')
      socket.removeAllListeners('error')
      resolve(socket)
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(Object.assign(new Error(`нет ответа за ${timeoutMs / 1000} с`), { code: 'ETIMEDOUT' }))
    })
    socket.once('error', (error) => {
      socket.destroy()
      reject(
        Object.assign(error, {
          code: 'ECONNECTION',
          originalCode: (error as NodemailerFailure).code,
        }),
      )
    })
  })
}

/**
 * Прощается с сервером (QUIT) и ждёт, пока соединение закроется. После сбоя TLS nodemailer
 * закрывает его сам. Не дожидаться закрытия нельзя: команда завершится, пока сокет TLS ещё
 * закрывается, а на Windows такой выход процесса иногда падал с ошибкой доступа к памяти
 */
async function closeConnection(connection: SMTPConnection) {
  if (connection.destroyed) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      connection.close()
      resolve()
    }, 2000)
    connection.once('end', () => {
      clearTimeout(timer)
      resolve()
    })
    connection.quit()
  })
}

/**
 * Проверка отправки по шагам для pnpm mail:test: DNS, соединение, TLS, вход, отправка.
 * Останавливается на первом сломанном шаге и объясняет, что не так. Пароль не печатается
 * ни в одном сообщении (smtpFailure)
 */
export async function diagnoseSmtp(
  settings: SmtpSettings,
  mail: OutgoingMail,
  options: SmtpOptions = {},
  onStep: (step: DiagnosisStep) => void = () => {},
) {
  const steps: DiagnosisStep[] = []
  const pass = (step: MailStep, message: string) => {
    const result = { step, ok: true, message }
    steps.push(result)
    onStep(result)
  }
  const fail = (step: MailStep, error: unknown) => {
    const failure = smtpFailure(error, settings)
    const result = { step, ok: false, message: failure.message }
    steps.push(result)
    onStep(result)
    return { ok: false as const, steps }
  }
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts }

  let checked: OutgoingMail
  try {
    checked = checkOutgoing(mail)
  } catch (error) {
    return fail('send', error)
  }

  try {
    const addresses = await withTimeout(
      (options.lookup ?? systemLookup)(settings.host),
      timeouts.dns,
      () =>
        Object.assign(new Error(`нет ответа за ${timeouts.dns / 1000} с`), {
          originalCode: 'ETIMEOUT',
        }),
    )
    pass('dns', `${settings.host} → ${addresses.map((address) => address.address).join(', ')}`)
  } catch (error) {
    return fail('dns', Object.assign(error as Error, { code: 'EDNS' }))
  }

  let socket: Socket
  try {
    socket = await tcpConnect(settings.host, settings.port, timeouts.connection)
    pass('connection', `${settings.host}:${settings.port} принимает соединения`)
  } catch (error) {
    return fail('connection', error)
  }

  const connection = new SMTPConnection({
    ...smtpConnectionOptions(settings, options),
    connection: socket,
  })
  // Сбой соединения SMTPConnection сообщает событием error, а не в колбэк connect: ждём одно из двух.
  // Обработчик error остаётся и после: без него поздняя ошибка сокета уронила бы процесс
  let lastError: Error | undefined
  connection.on('error', (error) => {
    lastError = error
  })
  try {
    try {
      await new Promise<void>((resolve, reject) => {
        connection.once('error', reject)
        connection.connect(() => {
          connection.off('error', reject)
          resolve()
        })
      })
      pass(
        'tls',
        settings.security === 'tls'
          ? 'TLS установлен, сертификат сервера проверен'
          : 'STARTTLS включён, сертификат сервера проверен',
      )
    } catch (error) {
      const failure = smtpFailure(error ?? lastError, settings)
      return fail(
        failure.step === 'connection' || failure.step === 'dns' ? failure.step : 'tls',
        failure,
      )
    }

    try {
      await promisify<boolean>((done) =>
        connection.login({ user: settings.user, pass: settings.password }, done),
      )
      pass('auth', `Сервер принял вход ${settings.user}`)
    } catch (error) {
      return fail('auth', error)
    }

    try {
      const { raw } = await composeMail(settings.from, checked)
      await promisify((done) =>
        connection.send({ from: settings.from.address, to: [checked.to] }, raw, done),
      )
      pass('send', `Письмо для ${checked.to} принято сервером`)
    } catch (error) {
      return fail('send', error)
    }
    return { ok: true as const, steps }
  } finally {
    await closeConnection(connection)
  }
}
