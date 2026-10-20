#!/usr/bin/env bash
# Установка Averra на чистый Ubuntu VPS одной командой.
#
#   sudo ./install.sh --site-domain example.ru --email studio@example.com --version 0.6.0
#
# Что делает: проверяет окружение (Docker, свободные порты 80 и 443, DNS доменов указывает на этот
# сервер), пишет папку установки (compose.yaml и .env с секретами, права 600), поднимает
# PostgreSQL и API, ждёт /api/health/ready, создаёт владельца и сайт, поднимает Caddy (SSL сам).
#
# Повторный запуск безопасен: секреты из .env не перегенерируются, владелец и сайт не создаются
# второй раз, а новые домены, почта или версия из флагов записываются в .env и применяются.
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
  --version <версия>      версия образов Averra (тег в GHCR), например 0.6.0

Необязательные:
  --admin-domain <домен>  поддомен админки, по умолчанию admin.<домен сайта>
  --owner-name <имя>      имя владельца в админке, по умолчанию «Владелец»
  --site-name <название>  название сайта в админке, по умолчанию домен сайта
  --dir <папка>           папка установки, по умолчанию /opt/averra
  --api-image <образ>     образ API без тега, по умолчанию ghcr.io/midhey/averra-api
  --web-image <образ>     образ Caddy с админкой, по умолчанию ghcr.io/midhey/averra-web
  --public-ip <IP>        публичный адрес сервера, если его нет на сетевых интерфейсах (NAT);
                          у сервера с IPv4 и IPv6 — флаг на каждый адрес
  --ghcr-user <логин>     вход в ghcr.io для приватных образов: токен спросят скрыто
  --skip-dns-check        не проверять, что домены указывают на сервер
  --skip-port-check       не проверять, что порты 80 и 443 свободны
  --install-docker        поставить Docker из пакетов Ubuntu (docker.io, docker-compose-v2)
  --env-only              только записать папку установки и .env, Docker не трогать
  --dry-run               показать план и пройти проверки (Docker, порты, DNS), ничего не меняя
  --yes                   ничего не спрашивать: всё из флагов и .env
  -h, --help              эта справка

Секреты — не флагами: они попали бы в историю команд и список процессов. Без терминала их
передают переменными окружения, не набирая значение в командной строке:
  read -rs GHCR_TOKEN && export GHCR_TOKEN && sudo -E bash install.sh … --ghcr-user <логин>
  GHCR_TOKEN              токен ghcr.io (только read:packages), иначе его спросят скрыто
  GHCR_USER               то же, что --ghcr-user
  AVERRA_OWNER_PASSWORD   пароль владельца без вопроса (иначе его спросят скрыто)
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
SITE_NAME=''
INSTALL_DIR='/opt/averra'
API_IMAGE_ARG=''
WEB_IMAGE_ARG=''
PUBLIC_IP=''
GHCR_USER="${GHCR_USER:-}"
SKIP_DNS=0
SKIP_PORTS=0
INSTALL_DOCKER=0
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
    --site-name) need_value "$@"; SITE_NAME="$2"; shift 2 ;;
    --dir) need_value "$@"; INSTALL_DIR="$2"; shift 2 ;;
    --api-image) need_value "$@"; API_IMAGE_ARG="$2"; shift 2 ;;
    --web-image) need_value "$@"; WEB_IMAGE_ARG="$2"; shift 2 ;;
    --public-ip) need_value "$@"; PUBLIC_IP+="$2"$'\n'; shift 2 ;;
    --ghcr-user) need_value "$@"; GHCR_USER="$2"; shift 2 ;;
    --skip-dns-check) SKIP_DNS=1; shift ;;
    --skip-port-check) SKIP_PORTS=1; shift ;;
    --install-docker) INSTALL_DOCKER=1; shift ;;
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
  printf '%s' "${line#*=}"
}

# Ключи, которые ведёт установщик. Остальные строки .env (свои добавки) переносятся как есть
MANAGED_KEYS=(
  AVERRA_VERSION AVERRA_API_IMAGE AVERRA_WEB_IMAGE SITE_DOMAIN ADMIN_DOMAIN ACME_EMAIL
  OWNER_EMAIL SITE_ID POSTGRES_PASSWORD AUTH_SECRET MAIL_ENCRYPTION_KEY BACKUP_PASSPHRASE
)

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
SITE_ID="$(env_get SITE_ID)"
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
[[ -z "$SITE_ID" || "$SITE_ID" =~ ^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$ ]] ||
  fail "SITE_ID в $ENV_FILE — не id сайта"

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
  [[ -n "$SITE_ID" ]] && say "Сайт в админке:    уже есть ($SITE_ID)" || say "Сайт в админке:    будет создан («$SITE_NAME»)"
  [[ -n "$GHCR_USER" ]] && say "Вход в ghcr.io:    $GHCR_USER" || say 'Вход в ghcr.io:    нет (образы публичные или вход уже есть)'
  # Проверки только читают: Docker, порты и DNS — те же, что перед настоящей установкой
  say ''
  say 'Проверки:'
  can_write_install_dir || problem "нет прав на запись в $INSTALL_DIR: запустите через sudo" || true
  if [[ $ENV_ONLY -eq 0 ]]; then
    check_docker || true
    if [[ $SKIP_PORTS -eq 1 ]]; then say '  порты: не проверяются (--skip-port-check)'; else check_ports || true; fi
    if [[ $SKIP_DNS -eq 1 ]]; then say '  DNS: не проверяется (--skip-dns-check)'; else check_dns || true; fi
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
      printf '%s=%s\n' "$key" "$value"
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

step "Пишу $INSTALL_DIR"
if [[ "$SCRIPT_DIR" != "$(cd "$INSTALL_DIR" 2>/dev/null && pwd || true)" ]]; then
  mkdir -p "$INSTALL_DIR"
  cp "$SCRIPT_DIR/compose.yaml" "$INSTALL_DIR/compose.yaml"
  # Скрипт управления установкой: бэкапы, восстановление, обновление, состояние. Только root
  install -m 700 "$SCRIPT_DIR/averra.sh" "$INSTALL_DIR/averra.sh"
fi
# Бэкапы (в них персональные данные) — только root; состояние читает API в контейнере
(umask 077 && mkdir -p "$INSTALL_DIR/backups")
(umask 022 && mkdir -p "$INSTALL_DIR/state")
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
compose pull

step 'Поднимаю PostgreSQL и API'
compose up -d postgres api

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
say 'API работает, миграции применены'

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

if [[ -z "$SITE_ID" ]]; then
  step "Создаю сайт «$SITE_NAME»"
  created="$(compose exec -T api node dist/server/site-create.js --name "$SITE_NAME" --print-id)"
  created="$(tr -d '\r\n' <<<"$created")"
  [[ "$created" =~ ^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$ ]] || fail "сайт не создан: $created"
  set_env SITE_ID "$created"
fi

step 'Поднимаю Caddy (сертификаты он выпустит сам)'
compose up -d

# Бэкап по расписанию: таймер systemd раз в сутки. Persistent — пропущенный, пока сервер был
# выключен, сделается при старте. Журнал: journalctl -u averra-backup
install_backup_timer() {
  local units="${AVERRA_SYSTEMD_DIR:-/etc/systemd/system}"
  if ! command -v systemctl >/dev/null 2>&1; then
    say "Нет systemd: бэкап по расписанию не поставлен. Добавьте в cron: $INSTALL_DIR/averra.sh backup --kind scheduled"
    return
  fi
  step 'Ставлю бэкап по расписанию (averra-backup.timer, каждый день около 03:30)'
  cat >"$units/averra-backup.service" <<UNIT
[Unit]
Description=Бэкап установки Averra (база и медиа, с проверкой восстановлением)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=$INSTALL_DIR/averra.sh backup --kind scheduled
UNIT
  cat >"$units/averra-backup.timer" <<UNIT
[Unit]
Description=Бэкап установки Averra раз в сутки

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now averra-backup.timer
}
install_backup_timer

step 'Готово'
say "Админка: https://$ADMIN_DOMAIN (вход: $OWNER_EMAIL)"
say "Сайт:    https://$SITE_DOMAIN — появится после первой публикации в админке"
say 'Дальше: задайте SMTP на странице «Почта» в админке и проверьте подключение.'
say "Сохраните BACKUP_PASSPHRASE из $ENV_FILE в менеджер паролей студии: без него копии бэкапов"
say 'во внешнем хранилище не расшифровать, если сервер пропадёт вместе с .env.'
say "Бэкап руками: $INSTALL_DIR/averra.sh backup. Обновление: $INSTALL_DIR/averra.sh update --version <версия>"
say "Повторный запуск с теми же флагами безопасен. Логи: docker compose --project-directory $INSTALL_DIR logs -f"
