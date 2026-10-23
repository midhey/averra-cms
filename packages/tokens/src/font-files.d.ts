// Виртуальный модуль плагина fontFilesPlugin (vite.ts): имя файла шрифта → путь на диске или
// адрес Vite, смотря как плагин подключён
declare module 'virtual:averra/font-files' {
  const files: Readonly<Record<string, string>>
  export default files
}
