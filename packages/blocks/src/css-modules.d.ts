// Типы для CSS Modules: в приложениях их даёт Vite, а пакету нужны свои
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
