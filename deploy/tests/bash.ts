import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

// Общее для тестов скриптов сервера (install.sh, averra.sh): настоящий bash, пути для него
// и временные папки, которые удаляются после каждого теста

/** bash: на Linux — системный, на Windows — Git Bash (bash.exe из System32 — это WSL, не он) */
function findBash() {
  if (process.env.AVERRA_BASH) return process.env.AVERRA_BASH
  if (process.platform !== 'win32') return 'bash'
  // Git для Windows ставится и в Program Files, и в профиль пользователя: ищем ещё от git.exe в PATH
  // (…\Git\cmd или …\Git\mingw64\bin)
  const fromPath = (process.env.PATH ?? '')
    .split(';')
    .filter((dir) => existsSync(join(dir, 'git.exe')))
    .flatMap((dir) => [
      join(dir, '..', 'bin', 'bash.exe'),
      join(dir, '..', '..', 'bin', 'bash.exe'),
    ])
  for (const candidate of [
    ...fromPath,
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
    'C:\\Program Files\\Git\\bin\\bash.exe',
  ]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('Не нашёл Git Bash: задайте путь к bash в AVERRA_BASH')
}
export const bash = findBash()

/** Путь для bash: на Windows Git Bash понимает C:/… с прямыми слешами */
export const posix = (path: string) => path.replaceAll('\\', '/')

/** Папка для PATH внутри bash: там «:» — разделитель, поэтому C:/x на Windows — это /c/x */
export const pathEntry = (path: string) =>
  posix(path).replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

export function tempDir(prefix = 'averra-test') {
  const dir = join(tmpdir(), `${prefix}-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}
