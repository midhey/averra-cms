#!/usr/bin/env bash
# Установка Averra на чистый Ubuntu VPS одной командой.
#
#   sudo ./install.sh --site-domain example.ru --email studio@example.com --version 0.1.0
#
# Что делает: проверяет окружение (Docker, свободные порты 80 и 443, DNS доменов указывает на этот
# сервер), пишет папку установки (compose.yaml и .env с секретами, права 600), поднимает
# PostgreSQL (свою или — с --external-db — проверяет внешнюю) и API, ждёт /api/health/ready, создаёт владельца, поднимает Caddy (SSL сам). Сайт
# установки (одна установка — один сайт) API создаёт сам при первом запуске: название — SITE_NAME.
#
# Повторный запуск безопасен: секреты из .env не перегенерируются, владелец не создаётся второй
# раз, а новые домены, почта или версия из флагов записываются в .env и применяются.
# Учебного режима на сервере нет: API в образе запускается без --dev и с NODE_ENV=production.
#
# Полный список флагов: ./install.sh --help.
# Подробно — https://midhey.github.io/averra-cms/install/server/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Установка Averra на этот сервер.

  ./install.sh --site-domain <домен> --email <почта> --version <версия> [флаги]

Обязательные при первой установке (дальше берутся из .env):
  --site-domain <домен>   домен сайта, например example.ru
  --email <почта>         почта для Let's Encrypt и вход владельца админки
  --version <версия>      версия образов Averra (тег в GHCR), например 0.1.0

Необязательные:
  --admin-domain <домен>  поддомен админки, по умолчанию admin.<домен сайта>
  --owner-name <имя>      имя владельца в админке, по умолчанию «Владелец»
  --site-name <название>  название сайта при первом запуске, по умолчанию домен сайта
  --dir <папка>           папка установки, по умолчанию /opt/averra
  --api-image <образ>     образ API без тега, по умолчанию ghcr.io/midhey/averra-api
  --web-image <образ>     образ Caddy с админкой, по умолчанию ghcr.io/midhey/averra-web
  --public-ip <IP>        публичный адрес сервера, если его нет на сетевых интерфейсах (NAT);
                          у сервера с IPv4 и IPv6 — флаг на каждый адрес
  --ghcr-user <логин>     вход в ghcr.io для закрытых образов (свой форк или пакет): токен
                          спросят скрыто. Образы Averra публичные, им вход не нужен
  --skip-dns-check        не проверять, что домены указывают на сервер
  --skip-port-check       не проверять, что порты 80 и 443 свободны
  --install-docker        поставить Docker из пакетов Ubuntu (docker.io, docker-compose-v2)
  --external-db           внешняя PostgreSQL 16–18 вместо своей: адрес — переменной
                          AVERRA_DATABASE_URL или скрытым вводом, только с TLS (sslmode=verify-full)
  --db-ca-file <файл>     корневой сертификат провайдера базы (PEM), если он не из публичных
  --env-only              только записать папку установки и .env, Docker не трогать
  --dry-run               показать план и пройти проверки (Docker, порты, DNS), ничего не меняя
  --yes                   ничего не спрашивать: всё из флагов и .env
  -h, --help              эта справка

Секреты — не флагами: они попали бы в историю команд и список процессов. Без терминала их
передают переменными окружения, не набирая значение в командной строке:
  read -rs AVERRA_OWNER_PASSWORD && export AVERRA_OWNER_PASSWORD && sudo -E bash install.sh … --yes
  AVERRA_OWNER_PASSWORD   пароль владельца без вопроса (иначе его спросят скрыто)
  GHCR_TOKEN              токен ghcr.io для --ghcr-user (только read:packages), иначе спросят скрыто
  GHCR_USER               то же, что --ghcr-user
  AVERRA_DATABASE_URL     адрес внешней базы для --external-db:
                          postgres://пользователь:пароль@хост:5432/база. Знаки @ : / # ? % и
                          кавычки в пароле — percent-encoded (@ → %40, # → %23, % → %25)
EOF
}

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
fail() {
  printf 'Ошибка: %s\n' "$*" >&2
  exit 1
}

# ── Флаги ──────────────────────────────────────────────────────────────────────────────────

SITE_DOMAIN_ARG=''
ADMIN_DOMAIN_ARG=''
EMAIL_ARG=''
VERSION_ARG=''
OWNER_NAME='Владелец'
SITE_NAME_ARG=''
INSTALL_DIR='/opt/averra'
API_IMAGE_ARG=''
WEB_IMAGE_ARG=''
PUBLIC_IP=''
GHCR_USER="${GHCR_USER:-}"
SKIP_DNS=0
SKIP_PORTS=0
INSTALL_DOCKER=0
EXTERNAL_DB=0
DB_CA_FILE_ARG=''
ENV_ONLY=0
DRY_RUN=0
ASSUME_YES=0

need_value() {
  [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "у флага $1 нет значения. Справка: ./install.sh --help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site-domain) need_value "$@"; SITE_DOMAIN_ARG="$2"; shift 2 ;;
    --admin-domain) need_value "$@"; ADMIN_DOMAIN_ARG="$2"; shift 2 ;;
    --email) need_value "$@"; EMAIL_ARG="$2"; shift 2 ;;
    --version) need_value "$@"; VERSION_ARG="$2"; shift 2 ;;
    --owner-name) need_value "$@"; OWNER_NAME="$2"; shift 2 ;;
    --site-name) need_value "$@"; SITE_NAME_ARG="$2"; shift 2 ;;
    --dir) need_value "$@"; INSTALL_DIR="$2"; shift 2 ;;
    --api-image) need_value "$@"; API_IMAGE_ARG="$2"; shift 2 ;;
    --web-image) need_value "$@"; WEB_IMAGE_ARG="$2"; shift 2 ;;
    --public-ip) need_value "$@"; PUBLIC_IP+="$2"$'\n'; shift 2 ;;
    --ghcr-user) need_value "$@"; GHCR_USER="$2"; shift 2 ;;
    --skip-dns-check) SKIP_DNS=1; shift ;;
    --skip-port-check) SKIP_PORTS=1; shift ;;
    --install-docker) INSTALL_DOCKER=1; shift ;;
    # Адрес внешней базы — не значением флага: в нём пароль (история команд, список процессов)
    --external-db) EXTERNAL_DB=1; shift ;;
    --db-ca-file) need_value "$@"; DB_CA_FILE_ARG="$2"; shift 2 ;;
    --env-only) ENV_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) fail "непонятный аргумент: $1. Справка: ./install.sh --help" ;;
  esac
done

ENV_FILE="$INSTALL_DIR/.env"

# ── .env: чтение без выполнения ────────────────────────────────────────────────────────────
# .env не «source»-им: строка в нём не должна выполниться как команда. Берём KEY=VALUE как текст

env_get() {
  local key="$1" line
  [[ -f "$ENV_FILE" ]] || return 0
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  # Значение в одинарных кавычках (адрес внешней базы) Compose берёт буквально — и мы так же
  if [[ ${#line} -ge 2 && "$line" == \'*\' ]]; then line="${line:1:${#line}-2}"; fi
  printf '%s' "$line"
}

# Ключи, которые ведёт установщик. Остальные строки .env (свои добавки) переносятся как есть
MANAGED_KEYS=(
  AVERRA_VERSION AVERRA_API_IMAGE AVERRA_WEB_IMAGE SITE_DOMAIN ADMIN_DOMAIN ACME_EMAIL
  SITE_NAME OWNER_EMAIL POSTGRES_PASSWORD AUTH_SECRET MAIL_ENCRYPTION_KEY BACKUP_PASSPHRASE
)
# Внешняя база (--external-db): режим, адрес и образ клиента PostgreSQL вместо пароля своей базы.
# У своей базы этих ключей нет: .env прежних установок не меняется
# SITE_ID в .env прежних версий не ведётся: Caddy берёт сайт по ссылке main, которую ставит API.
# Строка остаётся как своя — она нужна прежнему Caddyfile, если обновление откатят

# ── Значения: флаг → .env → вопрос ─────────────────────────────────────────────────────────

ask() {
  local prompt="$1" answer
  if [[ $ASSUME_YES -eq 1 || ! -t 0 ]]; then
    return 1
  fi
  read -r -p "$prompt: " answer
  printf '%s' "$answer"
}

pick() {
  # pick <значение флага> <ключ .env> <вопрос> — что выбрано, или пусто
  local from_flag="$1" key="$2" prompt="$3" value
  if [[ -n "$from_flag" ]]; then printf '%s' "$from_flag"; return; fi
  value="$(env_get "$key")"
  if [[ -n "$value" ]]; then printf '%s' "$value"; return; fi
  if [[ -n "$prompt" ]]; then ask "$prompt" || true; fi
}

SITE_DOMAIN="$(pick "$SITE_DOMAIN_ARG" SITE_DOMAIN 'Домен сайта (например, example.ru)')"
[[ -n "$SITE_DOMAIN" ]] || fail 'не задан домен сайта: --site-domain'
ADMIN_DOMAIN="$(pick "$ADMIN_DOMAIN_ARG" ADMIN_DOMAIN '')"
[[ -n "$ADMIN_DOMAIN" ]] || ADMIN_DOMAIN="admin.$SITE_DOMAIN"
ACME_EMAIL="$(pick "$EMAIL_ARG" ACME_EMAIL 'Почта (Let'"'"'s Encrypt и вход владельца)')"
[[ -n "$ACME_EMAIL" ]] || fail 'не задана почта: --email'
AVERRA_VERSION="$(pick "$VERSION_ARG" AVERRA_VERSION 'Версия Averra (тег образов)')"
[[ -n "$AVERRA_VERSION" ]] || fail 'не задана версия образов: --version'
AVERRA_API_IMAGE="$(pick "$API_IMAGE_ARG" AVERRA_API_IMAGE '')"
[[ -n "$AVERRA_API_IMAGE" ]] || AVERRA_API_IMAGE='ghcr.io/midhey/averra-api'
AVERRA_WEB_IMAGE="$(pick "$WEB_IMAGE_ARG" AVERRA_WEB_IMAGE '')"
[[ -n "$AVERRA_WEB_IMAGE" ]] || AVERRA_WEB_IMAGE='ghcr.io/midhey/averra-web'
OWNER_EMAIL="$(env_get OWNER_EMAIL)"
# Название сайта нужно API один раз — при первом запуске, когда сайта ещё нет. Потом оно живёт
# в базе, и новое значение здесь его не меняет
SITE_NAME="$(pick "$SITE_NAME_ARG" SITE_NAME '')"
[[ -n "$SITE_NAME" ]] || SITE_NAME="$SITE_DOMAIN"

# Проверка формата: значения попадают в Caddyfile и .env — без пробелов, кавычек и переводов строк
DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+xn--[a-z0-9-]{1,59}$'
for pair in "SITE_DOMAIN:$SITE_DOMAIN" "ADMIN_DOMAIN:$ADMIN_DOMAIN"; do
  name="${pair%%:*}"
  value="${pair#*:}"
  [[ "$value" =~ $DOMAIN_RE ]] ||
    fail "$name «$value» — не домен. Нужен вид example.ru, латиницей или в punycode (xn--…), строчными"
done
[[ "$SITE_DOMAIN" != "$ADMIN_DOMAIN" ]] || fail 'домен сайта и админки должны различаться'
[[ "$ACME_EMAIL" =~ ^[^[:space:]@\"\']+@[^[:space:]@\"\']+\.[^[:space:]@\"\']+$ ]] ||
  fail "почта «$ACME_EMAIL» — не адрес почты"
[[ "$AVERRA_VERSION" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] ||
  fail "версия «$AVERRA_VERSION» — не тег образа"
for image in "$AVERRA_API_IMAGE" "$AVERRA_WEB_IMAGE"; do
  [[ "$image" =~ ^[a-z0-9]([a-z0-9._/:-]*[a-z0-9])?$ ]] || fail "«$image» — не имя образа"
done
# Название уходит в .env, который читает docker compose: кавычки, $ (подстановка), # (комментарий)
# и \ там меняют значение, а перевод строки рвёт файл. Длиннее 80 символов API его обрежет
[[ "$SITE_NAME" != *[$'\n\r'\"\'\$#\\]* ]] ||
  fail "название сайта «$SITE_NAME» — одной строкой, без кавычек и знаков \$ # \\"

# ── База: своя или внешняя ─────────────────────────────────────────────────────────────────
# Своя — контейнер postgres из compose.yaml (по умолчанию). Внешняя — управляемая PostgreSQL на
# другом сервере (--external-db): адрес только из AVERRA_DATABASE_URL или скрытого ввода, TLS с
# проверкой сертификата. Режим живёт в .env (AVERRA_DB_MODE): повторный запуск его не меняет

# Клиент PostgreSQL для проверки внешней базы, пока её версия не известна: тот же образ, что у
# своей базы в compose.yaml. psql 17 говорит и с сервером 18
PG_PROBE_IMAGE='postgres:17.11-alpine3.24'
# Где CA провайдера внутри контейнеров (API и клиент PostgreSQL): папка db-tls установки
DB_CA_MOUNT='/run/averra-db'

# ── Общее у install.sh и averra.sh: тест сверяет, что текст одинаковый ──
# Образ клиента PostgreSQL той же мажорной версии, что сервер: pg_dump не бывает старше сервера.
# Теги точные, как у своей базы в compose.yaml
pg_image_for_major() {
  case "$1" in
    16) printf 'postgres:16.15-alpine3.24' ;;
    17) printf 'postgres:17.11-alpine3.24' ;;
    18) printf 'postgres:18.6-alpine3.24' ;;
    *) return 1 ;;
  esac
}

# Раскодировать percent-encoding. Обратной косой черты в адресе нет (db_url_parse не пускает),
# поэтому printf %b видит только наши \xHH
pct_decode() { printf '%b' "${1//%/\\x}"; }

# Разбор адреса postgres://пользователь:пароль@хост:порт/база?параметры. Итог — в DBU_* (USER и
# PASSWORD раскодированы), адрес в каноническом виде — DBU_URL (sslmode=verify-full, sslrootcert —
# наш CA, если второй аргумент 1). Код 1 и DBU_ERROR — что не так, по-русски. Сам адрес в
# сообщения не попадает: в нём пароль
db_url_parse() {
  local url="$1" ca="${2:-0}" rest authority after userinfo hostport path query param key value
  local user pass sslmode='' encoded extra host_in_url
  local params=() kept=()
  local LC_ALL=C
  local hint='знаки @ : / # ? % пробел и кавычки в пароле и имени пользователя записывают percent-encoded: @ → %40, : → %3A, / → %2F, # → %23, ? → %3F, % → %25'
  DBU_ERROR=''
  if [[ ! "$url" =~ ^postgres(ql)?:// ]]; then
    DBU_ERROR='адрес базы должен начинаться с postgres:// (вид postgres://пользователь:пароль@хост:5432/база)'
    return 1
  fi
  if [[ "$url" == *[[:space:]\'\"\\\#]* ]]; then
    DBU_ERROR="в адресе базы пробел, кавычка, \\ или #: $hint"
    return 1
  fi
  if [[ "$url" =~ %($|[^0-9A-Fa-f]|[0-9A-Fa-f]($|[^0-9A-Fa-f])) ]]; then
    DBU_ERROR="в адресе базы % не перед двумя шестнадцатеричными цифрами: $hint"
    return 1
  fi
  # %00 — нулевой байт: bash его отбросит, а API (decodeURIComponent) оставит, и пароль у клиента
  # бэкапов и у API разошёлся бы
  if [[ "$url" == *%00* ]]; then
    DBU_ERROR="в адресе базы %00 (нулевой байт): такой пароль или имя не передать клиенту PostgreSQL"
    return 1
  fi
  rest="${url#*://}"
  authority="${rest%%/*}"
  after="${rest:${#authority}}"
  if [[ "$authority" != *@* ]]; then
    DBU_ERROR="в адресе базы нет «пользователь:пароль@» (или в пароле / без кодирования): $hint"
    return 1
  fi
  userinfo="${authority%@*}"
  hostport="${authority##*@}"
  user="${userinfo%%:*}"
  pass=''
  [[ "$userinfo" != *:* ]] || pass="${userinfo#*:}"
  encoded='^([A-Za-z0-9._~!$&()*+,;=-]|%[0-9A-Fa-f]{2})+$'
  if [[ ! "$user" =~ $encoded || ! "$pass" =~ $encoded ]]; then
    DBU_ERROR="в адресе базы не разобрать пользователя и пароль (нужны оба): $hint"
    return 1
  fi
  if [[ "$hostport" =~ ^\[([0-9A-Fa-f:.]+)\](:([0-9]+))?$ ]]; then
    DBU_HOST="${BASH_REMATCH[1]}"
    DBU_PORT="${BASH_REMATCH[3]}"
  elif [[ "$hostport" =~ ^([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:([0-9]+))?$ ]]; then
    DBU_HOST="${BASH_REMATCH[1]}"
    DBU_PORT="${BASH_REMATCH[4]}"
  else
    DBU_ERROR='в адресе базы не разобрать хост и порт: нужен вид хост:5432 (один хост, без запятых)'
    return 1
  fi
  [[ -n "$DBU_PORT" ]] || DBU_PORT=5432
  if [[ ! "$DBU_PORT" =~ ^[0-9]{1,5}$ ]] || ((10#$DBU_PORT < 1 || 10#$DBU_PORT > 65535)); then
    DBU_ERROR="порт базы $DBU_PORT — не порт (1–65535)"
    return 1
  fi
  path="${after%%\?*}"
  query=''
  [[ "$after" != *\?* ]] || query="${after#*\?}"
  DBU_NAME="${path#/}"
  if [[ "$path" != /* || ! "$DBU_NAME" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$ ]]; then
    DBU_ERROR='в адресе базы нет имени базы после хоста (…@хост:5432/база): латиница, цифры, _ . -'
    return 1
  fi
  [[ -z "$query" ]] || IFS='&' read -r -a params <<<"$query"
  for param in "${params[@]}"; do
    [[ -n "$param" ]] || continue
    key="${param%%=*}"
    value="${param#*=}"
    case "$key" in
      sslmode) sslmode="$value" ;;
      # Свой CA задаёт --db-ca-file: путь внутри контейнеров знает только установка
      sslrootcert)
        if [[ "$value" != "$DB_CA_MOUNT/ca.pem" ]]; then
          DBU_ERROR='sslrootcert в адресе базы не задают: корневой сертификат провайдера передайте флагом --db-ca-file <файл>'
          return 1
        fi
        ;;
      connect_timeout | application_name)
        if [[ ! "$value" =~ ^[A-Za-z0-9_.-]{1,64}$ ]]; then
          DBU_ERROR="параметр $key в адресе базы: латиница, цифры, _ . -"
          return 1
        fi
        kept+=("$key=$value")
        ;;
      *)
        DBU_ERROR="параметр «$key» в адресе базы не поддерживается: годятся sslmode, connect_timeout, application_name"
        return 1
        ;;
    esac
  done
  case "$sslmode" in
    '' | verify-full) ;;
    disable | allow | prefer)
      DBU_ERROR="sslmode=$sslmode — соединение без обязательного TLS: пароль и персональные данные пошли бы по сети открыто. Уберите sslmode (установщик поставит verify-full) или задайте sslmode=verify-full"
      return 1
      ;;
    require | verify-ca)
      DBU_ERROR="sslmode=$sslmode не проверяет имя сервера в сертификате: нужен verify-full. Сертификат провайдера не из публичных — передайте его корневой сертификат флагом --db-ca-file"
      return 1
      ;;
    *)
      DBU_ERROR="sslmode=$sslmode — непонятное значение: нужен verify-full"
      return 1
      ;;
  esac
  DBU_USER="$(pct_decode "$user")"
  DBU_PASSWORD="$(pct_decode "$pass")"
  if [[ -z "$DBU_USER" || -z "$DBU_PASSWORD" || "$DBU_USER$DBU_PASSWORD" == *[$'\n\r']* ]]; then
    DBU_ERROR='в адресе базы пустые или многострочные пользователь или пароль'
    return 1
  fi
  # Раскодированные имя и пароль — текст UTF-8: иначе (%FF и т. п.) клиент бэкапов войдёт, а API
  # (decodeURIComponent) адрес не разберёт и не поднимется — с непонятной причиной уже после записи
  for value in "$DBU_USER" "$DBU_PASSWORD"; do
    if ! printf '%s' "$value" | iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1; then
      DBU_ERROR='в адресе базы пользователь или пароль после раскодирования %XX — не текст UTF-8 (например, %FF): API такой адрес не разберёт. Знак не из латиницы кодируют всеми байтами UTF-8 (я → %D1%8F), а проще — пароль из латиницы и цифр'
      return 1
    fi
  done
  host_in_url="$DBU_HOST"
  [[ "$DBU_HOST" != *:* ]] || host_in_url="[$DBU_HOST]"
  DBU_URL="postgres://$user:$pass@$host_in_url:$DBU_PORT/$DBU_NAME?sslmode=verify-full"
  [[ "$ca" != 1 ]] || DBU_URL+="&sslrootcert=$DB_CA_MOUNT/ca.pem"
  for extra in "${kept[@]}"; do DBU_URL+="&$extra"; done
}
# ── Конец общего у install.sh и averra.sh ──

DB_MODE_BEFORE="$(env_get AVERRA_DB_MODE)"
[[ -n "$DB_MODE_BEFORE" ]] || DB_MODE_BEFORE='own'
[[ "$DB_MODE_BEFORE" =~ ^(own|external)$ ]] ||
  fail "AVERRA_DB_MODE=$DB_MODE_BEFORE в $ENV_FILE — непонятный режим базы (own или external)"
DB_MODE="$DB_MODE_BEFORE"
[[ $EXTERNAL_DB -eq 0 ]] || DB_MODE='external'
# Смена режима на установке, где уже есть владелец (а значит, данные в своей базе): данные
# остались бы в томе postgres, а API поднялся бы на пустой внешней. Переезд — бэкапом
if [[ "$DB_MODE" != "$DB_MODE_BEFORE" && -n "$OWNER_EMAIL" ]]; then
  fail 'установка уже работает со своей базой, в ней данные: перевести её на внешнюю базу установщик не может. Переезд — бэкапом: новая установка с --external-db и averra.sh restore (https://midhey.github.io/averra-cms/install/backups/)'
fi
[[ -z "$DB_CA_FILE_ARG" || "$DB_MODE" == external ]] ||
  fail '--db-ca-file — только для внешней базы (--external-db)'

DATABASE_URL=''
AVERRA_PG_IMAGE=''
AVERRA_DB_MODE=''
DB_CA_HOST=''
if [[ "$DB_MODE" == external ]]; then
  AVERRA_DB_MODE='external'
  # CA провайдера: новый из флага или уже лежащий в папке установки
  # Путь — абсолютный: относительный Docker в -v принял бы за имя тома (создал бы пустой том и
  # смонтировал бы папку вместо файла), а ./ — отверг бы
  if [[ -n "$DB_CA_FILE_ARG" && "$DB_CA_FILE_ARG" != /* && -d "$(dirname -- "$DB_CA_FILE_ARG")" ]]; then
    DB_CA_FILE_ARG="$(cd "$(dirname -- "$DB_CA_FILE_ARG")" && pwd)/$(basename -- "$DB_CA_FILE_ARG")"
  fi
  if [[ -n "$DB_CA_FILE_ARG" ]]; then
    [[ -f "$DB_CA_FILE_ARG" && -r "$DB_CA_FILE_ARG" ]] ||
      fail "нет файла сертификата $DB_CA_FILE_ARG (--db-ca-file)"
    grep -q -- '-----BEGIN CERTIFICATE-----' "$DB_CA_FILE_ARG" ||
      fail "$DB_CA_FILE_ARG — не сертификат PEM (нужна строка -----BEGIN CERTIFICATE-----)"
    DB_CA_HOST="$DB_CA_FILE_ARG"
  elif [[ -f "$INSTALL_DIR/db-tls/ca.pem" ]]; then
    DB_CA_HOST="$INSTALL_DIR/db-tls/ca.pem"
  fi
  db_url_raw="${AVERRA_DATABASE_URL:-}"
  [[ -n "$db_url_raw" ]] || db_url_raw="$(env_get DATABASE_URL)"
  if [[ -z "$db_url_raw" ]]; then
    if [[ $ASSUME_YES -eq 1 || ! -t 0 ]]; then
      fail 'не задан адрес внешней базы: передайте его переменной окружения AVERRA_DATABASE_URL, не флагом (read -rs AVERRA_DATABASE_URL && export AVERRA_DATABASE_URL && sudo -E bash install.sh … --external-db)'
    fi
    read -rs -p 'Адрес внешней базы postgres://пользователь:пароль@хост:5432/база (не показывается): ' db_url_raw
    printf '\n'
  fi
  db_ca=0
  [[ -z "$DB_CA_HOST" ]] || db_ca=1
  db_url_parse "$db_url_raw" "$db_ca" || fail "$DBU_ERROR"
  # Адрес с паролем больше не нужен в окружении: его унаследовали бы docker, curl и остальные
  unset db_url_raw AVERRA_DATABASE_URL
  DATABASE_URL="$DBU_URL"
  AVERRA_PG_IMAGE="$(env_get AVERRA_PG_IMAGE)"
  # Своей базы нет: её пароль не создаётся и не ведётся (строка прежнего .env остаётся своей)
  managed=()
  for key in "${MANAGED_KEYS[@]}"; do
    [[ "$key" == POSTGRES_PASSWORD ]] || managed+=("$key")
  done
  MANAGED_KEYS=("${managed[@]}" AVERRA_DB_MODE DATABASE_URL AVERRA_PG_IMAGE)
fi

# ── Секреты ────────────────────────────────────────────────────────────────────────────────
# Из /dev/urandom, без openssl. Пароль Postgres — hex: он стоит в DATABASE_URL, и знаки
# base64 (/ + =) сломали бы адрес. Уже записанные секреты не меняются никогда: новый
# AUTH_SECRET выкинул бы всех из админки, новый MAIL_ENCRYPTION_KEY сделал бы нечитаемым
# пароль SMTP, а новый пароль Postgres не подошёл бы к уже созданной базе

random_base64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
random_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

secret_or_new() {
  local key="$1" generator="$2" bytes="$3" value
  value="$(env_get "$key")"
  if [[ -n "$value" ]]; then printf '%s' "$value"; else "$generator" "$bytes"; fi
}

NEW_SECRETS=()
for key in POSTGRES_PASSWORD AUTH_SECRET MAIL_ENCRYPTION_KEY BACKUP_PASSPHRASE; do
  [[ "$key" != POSTGRES_PASSWORD || "$DB_MODE" == own ]] || continue
  [[ -n "$(env_get "$key")" ]] || NEW_SECRETS+=("$key")
done

# ── Проверки окружения ─────────────────────────────────────────────────────────────────────

compose() { docker compose --project-directory "$INSTALL_DIR" "$@"; }

# Проверка не прошла: обычный прогон останавливается, сухой — запоминает и идёт дальше,
# чтобы показать все проблемы сразу
PROBLEMS=0
problem() {
  if [[ $DRY_RUN -eq 1 ]]; then
    say "  не пройдёт: $*"
    PROBLEMS=$((PROBLEMS + 1))
    return 1
  fi
  fail "$*"
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    if [[ $INSTALL_DOCKER -eq 1 && $DRY_RUN -eq 1 ]]; then
      say '  Docker нет: его поставит --install-docker'
      return 0
    elif [[ $INSTALL_DOCKER -eq 1 ]]; then
      step 'Ставлю Docker из пакетов Ubuntu'
      [[ $EUID -eq 0 ]] || fail 'для --install-docker нужен root (sudo)'
      apt-get update
      apt-get install -y docker.io docker-compose-v2
      systemctl enable --now docker
    else
      problem 'нет Docker. Поставьте его: sudo apt-get install -y docker.io docker-compose-v2 (или запустите с --install-docker)'
      return 1
    fi
  fi
  docker compose version >/dev/null 2>&1 ||
    problem 'нет Docker Compose v2 (docker compose). Ubuntu: sudo apt-get install -y docker-compose-v2' ||
    return 1
  docker info >/dev/null 2>&1 ||
    problem 'Docker не отвечает или нет прав: запустите от root (sudo) или добавьте пользователя в группу docker' ||
    return 1
}

caddy_running() {
  [[ -f "$INSTALL_DIR/compose.yaml" ]] &&
    [[ -n "$(compose ps --status running -q caddy 2>/dev/null || true)" ]]
}

check_ports() {
  # Повторный запуск: порты держит наш же Caddy — это не помеха
  if caddy_running; then return; fi
  local port busy=()
  for port in 80 443; do
    if [[ -n "$(ss -Hltn "sport = :$port" 2>/dev/null || true)" ]]; then busy+=("$port"); fi
  done
  [[ ${#busy[@]} -eq 0 ]] ||
    problem "порты заняты: ${busy[*]}. Их держит другой веб-сервер (nginx, apache?) — остановите его или запустите с --skip-port-check"
}

server_ips() {
  if [[ -n "$PUBLIC_IP" ]]; then
    printf '%s' "$PUBLIC_IP"
  else
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' || true
  fi
}

# Адреса домена: A и AAAA, по строке. getent ahosts спрашивает AAAA, только если у самого сервера
# есть IPv6 (AI_ADDRCONFIG), а чужая AAAA-запись опасна как раз у сервера без IPv6. Поэтому
# записи спрашиваются ещё и напрямую: dig (bind9-dnsutils, есть в образах Ubuntu Server), а без
# него — getaddrinfo из python3 без AI_ADDRCONFIG. Имена из CNAME и адреса ::ffff: отбрасываются
dns_addresses() {
  local domain="$1"
  {
    getent ahosts "$domain" 2>/dev/null | awk '{print $1}'
    if command -v dig >/dev/null 2>&1; then
      dig +short A "$domain" 2>/dev/null
      dig +short AAAA "$domain" 2>/dev/null
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c '
import socket, sys
for family in (socket.AF_INET, socket.AF_INET6):
    try:
        for info in socket.getaddrinfo(sys.argv[1], None, family, socket.SOCK_STREAM):
            print(info[4][0])
    except OSError:
        pass
' "$domain" 2>/dev/null
    fi
  } | tr -d '\r' | grep -E '^([0-9]+\.){3}[0-9]+$|^[0-9a-fA-F]*:[0-9a-fA-F:.]*$' |
    grep -v '^::ffff:' | sort -u || true
}

# На этот сервер должны вести все A- и AAAA-записи домена, а не хотя бы одна: Let's Encrypt
# проверяет домен по любому из адресов, а по IPv6 — в первую очередь. Лишняя AAAA-запись на чужой
# адрес (её часто ставит панель регистратора) — и сертификат не выпустится, хотя A-запись верна
check_dns() {
  local ips domain resolved address foreign hint
  ips="$(server_ips)"
  if [[ -z "$ips" ]]; then
    problem 'не удалось узнать адрес сервера: задайте --public-ip'
    return 1
  fi
  for domain in "$SITE_DOMAIN" "$ADMIN_DOMAIN"; do
    resolved="$(dns_addresses "$domain")"
    if [[ -z "$resolved" ]]; then
      problem "домен $domain не находится в DNS. Добавьте A-запись на адрес сервера и подождите, пока она разойдётся (или --skip-dns-check)" || true
      continue
    fi
    foreign=''
    while read -r address; do
      grep -qxF "$address" <<<"$ips" || foreign+="$address "
    done <<<"$resolved"
    [[ -n "$foreign" ]] || continue
    if [[ "$foreign" == *:* ]]; then
      hint="Let's Encrypt проверяет каждый адрес домена, IPv6 — первым: AAAA-запись направьте на IPv6 этого сервера или удалите её"
    else
      hint='A-запись направьте на адрес сервера, лишние A-записи удалите'
    fi
    problem "домен $domain указывает на $(tr '\n' ' ' <<<"$resolved")— не этого сервера: $foreign(у сервера адреса: $(tr '\n' ' ' <<<"$ips")). Без верного DNS Caddy не получит сертификат. $hint. За NAT задайте --public-ip (флаг на каждый адрес), проверить позже — --skip-dns-check" ||
      true
  done
}

# Проверка внешней базы тем же клиентом PostgreSQL, что потом снимает бэкапы: вход по TLS с
# проверкой сертификата, версия сервера и права. Итог — AVERRA_PG_IMAGE (клиент той же версии,
# что сервер). Пароль уходит в контейнер переменной окружения (-e PGPASSWORD без значения), не
# аргументом: его не видно в списке процессов
DB_PROBE_SQL="select current_setting('server_version_num'), has_database_privilege(current_database(), 'CREATE'), case when exists (select 1 from pg_namespace where nspname = 'public') then has_schema_privilege('public', 'CREATE') else false end, (select count(*) from information_schema.tables where table_schema = 'public'), to_regclass('drizzle.__drizzle_migrations') is not null"

check_external_db() {
  local mount=() out err code=0 rootcert='system' facts major has_db has_schema tables migrated
  local sql_user sql_db
  if [[ -n "$DB_CA_HOST" ]]; then
    mount=(-v "$DB_CA_HOST:$DB_CA_MOUNT/ca.pem:ro")
    rootcert="$DB_CA_MOUNT/ca.pem"
  fi
  err="$(mktemp)"
  out="$(PGHOST="$DBU_HOST" PGPORT="$DBU_PORT" PGUSER="$DBU_USER" PGPASSWORD="$DBU_PASSWORD" \
    PGDATABASE="$DBU_NAME" PGSSLMODE=verify-full PGSSLROOTCERT="$rootcert" PGCONNECT_TIMEOUT=15 \
    docker run --rm --cap-drop ALL --security-opt no-new-privileges:true "${mount[@]}" \
    -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGSSLROOTCERT \
    -e PGCONNECT_TIMEOUT "$PG_PROBE_IMAGE" psql -X -q -tA -F '|' -c "$DB_PROBE_SQL" 2>"$err")" ||
    code=$?
  if [[ $code -ne 0 ]]; then
    local reason hint
    # Сообщение libpq: хост, причина — пароля в нём нет
    reason="$(tr '\n' ' ' <"$err" | sed -E 's/[[:space:]]+/ /g; s/ $//' | cut -c1-400)"
    rm -f "$err"
    case "$reason" in
      *pg_hba* | *'no encryption'*)
        hint="сервер базы не пускает этот сервер: разрешите его IP ($(server_ips | tr '\n' ' ')) в pg_hba.conf или в списке доступа панели провайдера, с hostssl" ;;
      *certificate* | *SSL* | *ssl*)
        hint='сертификат базы не проверился: имя хоста в адресе должно совпадать с сертификатом, а корневой сертификат провайдера не из публичных передают флагом --db-ca-file' ;;
      *password* | *authentication*)
        hint='база не приняла пользователя или пароль: проверьте их (знаки @ : / # ? % в пароле — percent-encoded)' ;;
      *'does not exist'*)
        hint='такой базы или пользователя на сервере нет' ;;
      *)
        hint='сервер базы не ответил: проверьте хост и порт, файрвол провайдера и что исходящие соединения с этого сервера на порт базы открыты' ;;
    esac
    problem "не удалось войти во внешнюю базу $DBU_USER@$DBU_HOST:$DBU_PORT/$DBU_NAME по TLS: $hint. Ответ клиента: ${reason:-нет}"
    return 1
  fi
  rm -f "$err"
  facts="$(printf '%s' "$out" | tr -d '[:space:]')"
  IFS='|' read -r major has_db has_schema tables migrated <<<"$facts"
  if [[ ! "$major" =~ ^[0-9]+$ ]]; then
    problem 'внешняя база ответила непонятно на проверку версии и прав'
    return 1
  fi
  major=$((10#$major / 10000))
  sql_user="\"${DBU_USER//\"/\"\"}\""
  sql_db="\"${DBU_NAME//\"/\"\"}\""
  if ! AVERRA_PG_IMAGE="$(pg_image_for_major "$major")"; then
    problem "внешняя база — PostgreSQL $major: поддерживаются 16, 17 и 18"
    return 1
  fi
  if [[ "$has_db" != t ]]; then
    problem "у пользователя $DBU_USER нет права CREATE на базе $DBU_NAME: оно нужно миграциям (схема drizzle). Владелец базы выдаёт его так: GRANT CREATE ON DATABASE $sql_db TO $sql_user;"
    return 1
  fi
  if [[ "$has_schema" != t ]]; then
    problem "у пользователя $DBU_USER нет права CREATE на схеме public базы $DBU_NAME: в ней таблицы Averra. Владелец базы выдаёт его так: ALTER SCHEMA public OWNER TO $sql_user; (или GRANT USAGE, CREATE ON SCHEMA public TO $sql_user;)"
    return 1
  fi
  # Первая установка — только на пустую базу или базу Averra: чужие таблицы в public перемешались
  # бы с нашими, а восстановление из бэкапа их удалило бы
  if [[ -z "$OWNER_EMAIL" && "$migrated" != t && "$tables" =~ ^[0-9]+$ && $tables -gt 0 ]]; then
    problem "во внешней базе $DBU_NAME уже есть таблицы ($tables), а миграций Averra нет: нужна отдельная пустая база"
    return 1
  fi
  # Владелец уже создан, а миграций в базе нет: адрес ведёт не в базу этой установки (опечатка,
  # другая база у провайдера). API поднялся бы на пустой базе без владельца — войти было бы некому
  if [[ -n "$OWNER_EMAIL" && "$migrated" != t ]]; then
    problem "во внешней базе $DBU_NAME нет миграций Averra, а владелец у установки уже создан: это не база этой установки. Проверьте адрес; переезд на другую базу — бэкапом (averra.sh restore)"
    return 1
  fi
  say "  внешняя база: PostgreSQL $major, вход по TLS с проверкой сертификата, права CREATE есть; клиент бэкапов — $AVERRA_PG_IMAGE"
}

# Можно ли писать в папку установки (или создать её): иначе — понятный отказ «нужен sudo»,
# а не «Permission denied» из mkdir посреди установки
can_write_install_dir() {
  local dir="$INSTALL_DIR"
  while [[ ! -e "$dir" ]]; do
    local parent
    parent="$(dirname "$dir")"
    [[ "$parent" != "$dir" ]] || break
    dir="$parent"
  done
  [[ -d "$dir" && -w "$dir" ]] && { [[ ! -e "$ENV_FILE" ]] || [[ -w "$ENV_FILE" ]]; }
}

# ── Сухой прогон ───────────────────────────────────────────────────────────────────────────

if [[ $DRY_RUN -eq 1 ]]; then
  say 'Сухой прогон: ничего не меняется.'
  say "Папка установки:   $INSTALL_DIR"
  say "Сайт:              https://$SITE_DOMAIN"
  say "Админка:           https://$ADMIN_DOMAIN"
  say "Почта:             $ACME_EMAIL"
  say "Образы:            $AVERRA_API_IMAGE:$AVERRA_VERSION, $AVERRA_WEB_IMAGE:$AVERRA_VERSION"
  if [[ ${#NEW_SECRETS[@]} -gt 0 ]]; then
    say "Новые секреты:     ${NEW_SECRETS[*]}"
  else
    say 'Новые секреты:     нет (берутся из .env)'
  fi
  [[ -n "$OWNER_EMAIL" ]] && say "Владелец:          уже создан ($OWNER_EMAIL)" || say "Владелец:          будет создан ($ACME_EMAIL)"
  say "Сайт в админке:    «$SITE_NAME» (API создаст его при первом запуске, если сайта ещё нет)"
  if [[ "$DB_MODE" == external ]]; then
    say "База:              внешняя — $DBU_USER@$DBU_HOST:$DBU_PORT/$DBU_NAME, TLS verify-full$([[ -z "$DB_CA_HOST" ]] || printf ', CA провайдера: %s' "$DB_CA_HOST")"
  else
    say 'База:              своя (контейнер postgres)'
  fi
  [[ -n "$GHCR_USER" ]] && say "Вход в ghcr.io:    $GHCR_USER" || say 'Вход в ghcr.io:    нет (образы публичные или вход уже есть)'
  # Проверки только читают: Docker, порты и DNS — те же, что перед настоящей установкой
  say ''
  say 'Проверки:'
  can_write_install_dir || problem "нет прав на запись в $INSTALL_DIR: запустите через sudo" || true
  if [[ $ENV_ONLY -eq 0 ]]; then
    docker_ok=0
    if check_docker; then docker_ok=1; fi
    if [[ $SKIP_PORTS -eq 1 ]]; then say '  порты: не проверяются (--skip-port-check)'; else check_ports || true; fi
    if [[ $SKIP_DNS -eq 1 ]]; then say '  DNS: не проверяется (--skip-dns-check)'; else check_dns || true; fi
    if [[ "$DB_MODE" == external && $docker_ok -eq 1 ]]; then
      check_external_db || true
    elif [[ "$DB_MODE" == external ]]; then
      say '  внешняя база: не проверяется без Docker'
    fi
  fi
  if [[ $PROBLEMS -eq 0 ]]; then
    say '  всё в порядке'
    exit 0
  fi
  say "Проблем: $PROBLEMS — настоящая установка остановится на первой"
  exit 1
fi

# ── Права на папку установки ───────────────────────────────────────────────────────────────

can_write_install_dir || fail "нет прав на запись в $INSTALL_DIR: запустите через sudo"

if [[ $ENV_ONLY -eq 0 ]]; then
  step 'Проверяю окружение'
  check_docker
  [[ $SKIP_PORTS -eq 1 ]] || check_ports
  [[ $SKIP_DNS -eq 1 ]] || check_dns
  say 'Docker, порты и DNS в порядке'
  if [[ "$DB_MODE" == external ]]; then
    step 'Проверяю внешнюю базу'
    check_external_db
    # Клиент бэкапов нужен ночью, при проверке, восстановлении и откате: не скачается тогда — сбой
    # выглядел бы как «база не ответила». Скачиваем сейчас, пока человек у терминала
    step "Скачиваю клиент PostgreSQL для бэкапов ($AVERRA_PG_IMAGE)"
    docker pull "$AVERRA_PG_IMAGE" >/dev/null ||
      fail "образ $AVERRA_PG_IMAGE не скачался: без него не снять и не проверить бэкап внешней базы. Причина — в ответе Docker выше: проверьте доступ этого сервера к Docker Hub (registry-1.docker.io) и повторите установку"
  fi
elif [[ "$DB_MODE" == external ]]; then
  say 'Внешняя база не проверялась (--env-only): проверит повторный запуск без --env-only'
fi

# ── Папка установки и .env ─────────────────────────────────────────────────────────────────

# Временный .env, пока он пишется: прервался прогон (сбой, Ctrl+C) — файл с секретами не остаётся
# лежать в папке установки рядом с настоящим .env
ENV_TMP=''
remove_env_tmp() {
  [[ -z "$ENV_TMP" ]] || rm -f "$ENV_TMP"
}

write_env() {
  local tmp key value
  mkdir -p "$INSTALL_DIR"
  trap remove_env_tmp EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  # Файл с секретами не бывает доступен другим ни на миг: umask до создания, chmod после
  tmp="$(umask 077 && mktemp "$INSTALL_DIR/.env.XXXXXX")"
  ENV_TMP="$tmp"
  {
    printf '# Установка Averra. Ведёт deploy/install.sh: секреты здесь не меняются при повторном запуске.\n'
    printf '# Права 600: в файле пароли. Не копируйте его в чаты и не кладите в git\n'
    for key in "${MANAGED_KEYS[@]}"; do
      case "$key" in
        POSTGRES_PASSWORD) value="$(secret_or_new POSTGRES_PASSWORD random_hex 24)" ;;
        AUTH_SECRET) value="$(secret_or_new AUTH_SECRET random_base64 32)" ;;
        MAIL_ENCRYPTION_KEY) value="$(secret_or_new MAIL_ENCRYPTION_KEY random_base64 32)" ;;
        # Пароль шифрования копий бэкапов во внешнем хранилище (averra.sh). Новый сделал бы
        # нечитаемыми уже выгруженные копии — не меняется, как остальные секреты
        BACKUP_PASSPHRASE) value="$(secret_or_new BACKUP_PASSPHRASE random_base64 32)" ;;
        *) value="${!key}" ;;
      esac
      if [[ "$key" == DATABASE_URL ]]; then
        # Одинарные кавычки: Compose берёт значение буквально, $ из пароля не подставляется.
        # Кавычек в адресе нет — их не пускает db_url_parse
        printf "%s='%s'\n" "$key" "$value"
      else
        printf '%s=%s\n' "$key" "$value"
      fi
    done
    # Свои строки из прежнего .env (например, переменные для compose.override.yaml)
    if [[ -f "$ENV_FILE" ]]; then
      local managed_re
      managed_re="^($(IFS='|'; printf '%s' "${MANAGED_KEYS[*]}"))="
      grep -vE "$managed_re" "$ENV_FILE" | grep -vE '^# (Установка Averra|Права 600)' || true
    fi
  } >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
  ENV_TMP=''
  trap - EXIT INT TERM HUP
}

# Своя база сменилась на внешнюю до создания владельца (прошлая установка оборвалась): контейнер
# postgres прежнего compose.yaml остался бы сиротой и держал бы память — убрать его, пока прежний
# compose.yaml на месте. Том с данными не трогается
if [[ $ENV_ONLY -eq 0 && "$DB_MODE_BEFORE" == own && "$DB_MODE" == external && -f "$ENV_FILE" &&
  -f "$INSTALL_DIR/compose.yaml" ]]; then
  compose rm -sf postgres >/dev/null 2>&1 || true
fi

step "Пишу $INSTALL_DIR"
if [[ "$SCRIPT_DIR" != "$(cd "$INSTALL_DIR" 2>/dev/null && pwd || true)" ]]; then
  mkdir -p "$INSTALL_DIR"
  # Внешняя база — свой файл Compose без сервиса postgres (в папке установки он — compose.yaml)
  if [[ "$DB_MODE" == external ]]; then
    cp "$SCRIPT_DIR/compose.external.yaml" "$INSTALL_DIR/compose.yaml"
  else
    cp "$SCRIPT_DIR/compose.yaml" "$INSTALL_DIR/compose.yaml"
  fi
  # Скрипт управления установкой: бэкапы, восстановление, обновление, состояние. Только root
  install -m 700 "$SCRIPT_DIR/averra.sh" "$INSTALL_DIR/averra.sh"
fi
# Бэкапы (в них персональные данные) — только root; состояние читает API в контейнере. Заявки на
# обновление из админки пишет только API — пользователь node образа (uid 1000); папка должна быть
# до запуска API: иначе Docker создаст её сам от root, и API в неё не напишет
(umask 077 && mkdir -p "$INSTALL_DIR/backups")
(umask 022 && mkdir -p "$INSTALL_DIR/state")
(umask 077 && mkdir -p "$INSTALL_DIR/requests")
# CA провайдера внешней базы: не секрет, его читают API и клиент PostgreSQL в контейнерах
if [[ "$DB_MODE" == external ]]; then
  (umask 022 && mkdir -p "$INSTALL_DIR/db-tls")
  if [[ -n "$DB_CA_FILE_ARG" && "$DB_CA_HOST" != "$INSTALL_DIR/db-tls/ca.pem" ]]; then
    cp "$DB_CA_FILE_ARG" "$INSTALL_DIR/db-tls/ca.pem.new"
    chmod 644 "$INSTALL_DIR/db-tls/ca.pem.new"
    mv -f "$INSTALL_DIR/db-tls/ca.pem.new" "$INSTALL_DIR/db-tls/ca.pem"
  fi
fi
chmod 700 "$INSTALL_DIR/requests"
chown 1000:1000 "$INSTALL_DIR/requests" ||
  say 'Не удалось отдать папку заявок пользователю API (uid 1000): кнопка «Обновить» в админке не сработает'
write_env
if [[ ${#NEW_SECRETS[@]} -gt 0 ]]; then
  say "Созданы секреты: ${NEW_SECRETS[*]} (в $ENV_FILE, права 600)"
else
  say "Секреты из $ENV_FILE не менялись"
fi

if [[ $ENV_ONLY -eq 1 ]]; then
  say 'Готово: --env-only, Docker не запускался'
  exit 0
fi

# ── Образы и запуск ────────────────────────────────────────────────────────────────────────

if [[ -n "$GHCR_USER" && -z "${GHCR_TOKEN:-}" ]]; then
  # Токен не флагом и не переменной в командной строке: спрашиваем скрыто
  [[ -t 0 ]] || fail 'нет терминала, чтобы спросить токен ghcr.io: передайте GHCR_TOKEN окружением (read -rs GHCR_TOKEN; export GHCR_TOKEN; sudo -E …)'
  read -rs -p "Токен ghcr.io для $GHCR_USER (read:packages, не показывается): " GHCR_TOKEN
  printf '\n'
fi
if [[ -n "${GHCR_TOKEN:-}" ]]; then
  step 'Вхожу в ghcr.io'
  [[ -n "$GHCR_USER" ]] || fail 'задан GHCR_TOKEN без --ghcr-user (GHCR_USER)'
  # Токен — через stdin, а не аргументом: его не видно в списке процессов
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
fi

step "Скачиваю образы $AVERRA_VERSION"
# Причину Docker печатает выше. На несуществующий тег публичного пакета он отвечает
# «manifest unknown», а denied/unauthorized без входа — закрытый пакет или чужое имя образа
compose pull || fail "образы $AVERRA_VERSION не скачались." \
  'Ответ denied или unauthorized — пакеты в GHCR закрытые (переключите в Public или войдите:' \
  '--ghcr-user и токен read:packages) или опечатка в имени образа (--api-image, --web-image).' \
  'Ответ manifest unknown — такой версии нет, проверьте --version'

if [[ "$DB_MODE" == external ]]; then
  step 'Поднимаю API (база — внешняя)'
  compose up -d api
else
  step 'Поднимаю PostgreSQL и API'
  compose up -d postgres api
fi

step 'Жду, пока API ответит /api/health/ready'
ready=0
for _ in $(seq 1 90); do
  if compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ $ready -eq 1 ]] || fail "API не поднялся за 3 минуты. Лог: docker compose --project-directory $INSTALL_DIR logs api"
say 'API работает, миграции применены, сайт установки на месте'

set_env() {
  # Записать одно значение в .env (тем же write_env: права и чужие строки сохраняются)
  printf -v "$1" '%s' "$2"
  write_env
}

if [[ -z "$OWNER_EMAIL" ]]; then
  step "Создаю владельца $ACME_EMAIL"
  # --if-missing: владелец с этой почтой уже есть (прошлый запуск упал позже) — не ошибка,
  # и пароль тогда не спрашивается
  owner_args=(node dist/server/user-create.js --email "$ACME_EMAIL" --name "$OWNER_NAME" --if-missing)
  if [[ -n "${AVERRA_OWNER_PASSWORD:-}" ]]; then
    # Пароль уходит в контейнер переменной окружения (-e без значения берёт её отсюда),
    # а не аргументом команды: его не видно в списке процессов
    (
      export CMS_USER_PASSWORD="$AVERRA_OWNER_PASSWORD"
      compose exec -T -e CMS_USER_PASSWORD api "${owner_args[@]}"
    ) || fail 'владелец не создан (сообщение выше). Запустите установщик ещё раз'
  else
    [[ -t 0 ]] || fail 'нет терминала, чтобы спросить пароль владельца: задайте AVERRA_OWNER_PASSWORD'
    say 'Придумайте пароль владельца (от 10 символов). Он не показывается при вводе'
    compose exec api "${owner_args[@]}" ||
      fail 'владелец не создан (сообщение выше). Запустите установщик ещё раз'
  fi
  set_env OWNER_EMAIL "$ACME_EMAIL"
fi

step 'Поднимаю Caddy (сертификаты он выпустит сам)'
compose up -d

# Службы systemd ставит сам averra.sh (install-units): бэкап и проверка новой версии раз в сутки
# (averra-backup.timer, около 03:30), заявки на обновление из админки (averra-update-request.path)
# и доведение обновления, прерванного перезагрузкой (averra-update-resume.service). Тем же он
# переставляет их после обновления — юниты новой версии доезжают без ручного шага. Журнал:
# journalctl -u averra-backup -u averra-update-request -u averra-update-resume
"$BASH" "$INSTALL_DIR/averra.sh" install-units ||
  say "Службы systemd не встали (сообщение выше): повторите $INSTALL_DIR/averra.sh install-units"

step 'Готово'
say "Админка: https://$ADMIN_DOMAIN (вход: $OWNER_EMAIL)"
say "Сайт:    https://$SITE_DOMAIN — появится после первой публикации в админке"
say 'Дальше: задайте SMTP на странице «Почта» в админке и проверьте подключение.'
say "Сохраните BACKUP_PASSPHRASE из $ENV_FILE в менеджер паролей студии: без него копии бэкапов"
say 'во внешнем хранилище не расшифровать, если сервер пропадёт вместе с .env.'
say "Бэкап руками: $INSTALL_DIR/averra.sh backup. Обновление: кнопкой в «Состоянии установки» в"
say "админке или $INSTALL_DIR/averra.sh update --version <версия>"
say "Повторный запуск с теми же флагами безопасен. Логи: docker compose --project-directory $INSTALL_DIR logs -f"
