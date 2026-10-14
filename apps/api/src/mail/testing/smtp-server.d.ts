// У smtp-server нет своих типов, а @types/smtp-server тянет @types/nodemailer, который спорит
// с типами из nodemailer 10. Здесь — только то, чем пользуются тесты

declare module 'smtp-server' {
  import type { Server } from 'node:net'
  import type { Readable } from 'node:stream'

  type Address = { address: string }
  type Session = {
    user?: string
    secure: boolean
    envelope: { mailFrom: Address | false; rcptTo: Address[] }
  }
  type Auth = { method: string; username: string; password: string }
  type Done<T = void> = (error?: Error | null, result?: T) => void

  export type SMTPServerOptions = {
    secure?: boolean
    key?: string
    cert?: string
    hideSTARTTLS?: boolean
    disabledCommands?: string[]
    authMethods?: string[]
    allowInsecureAuth?: boolean
    logger?: boolean
    onAuth?: (auth: Auth, session: Session, callback: Done<{ user: string }>) => void
    onData?: (stream: Readable, session: Session, callback: Done) => void
  }

  export class SMTPServer {
    constructor(options: SMTPServerOptions)
    server: Server
    listen(port: number, host: string, callback: () => void): void
    close(callback: () => void): void
    on(event: 'error', listener: (error: Error) => void): this
  }
}
