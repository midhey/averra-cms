/** Путь до значения внутри полей блока: ['items', 0, 'title'] */
export type Path = readonly (string | number)[]

export const pathKey = (path: Path) => path.join('.')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function getIn(value: unknown, path: Path): unknown {
  let current = value
  for (const key of path) {
    if (typeof key === 'number') current = Array.isArray(current) ? current[key] : undefined
    else current = isRecord(current) ? current[key] : undefined
  }
  return current
}

/** Копия value, где по пути path лежит next. undefined убирает поле из объекта совсем */
export function setIn(value: unknown, path: Path, next: unknown): unknown {
  const [key, ...rest] = path
  if (key === undefined) return next
  if (typeof key === 'number') {
    const list: unknown[] = Array.isArray(value) ? [...value] : []
    list[key] = setIn(list[key], rest, next)
    return list
  }
  const record = isRecord(value) ? { ...value } : {}
  const child = setIn(record[key], rest, next)
  if (child === undefined) delete record[key]
  else record[key] = child
  return record
}
