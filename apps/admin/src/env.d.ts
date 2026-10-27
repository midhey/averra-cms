// Переменные сборки админки (Vite): только VITE_*, и только то, что не секрет — всё это уходит
// в статику, которую видит любой браузер

interface ImportMetaEnv {
  /** Версия установки, для которой собрана админка (deploy/Dockerfile); в разработке нет */
  readonly VITE_AVERRA_VERSION?: string
}
