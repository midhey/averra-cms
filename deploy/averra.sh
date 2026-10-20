#!/usr/bin/env bash
# Управление установкой Averra на сервере: бэкапы, восстановление, обновление, состояние.
# Ставит его install.sh в папку установки (/opt/averra/averra.sh), запускается от root:
#
#   sudo /opt/averra/averra.sh backup               бэкап базы и медиа с проверкой восстановлением
#   sudo /opt/averra/averra.sh backups              список бэкапов
#   sudo /opt/averra/averra.sh verify <бэкап>       проверить бэкап ещё раз
#   sudo /opt/averra/averra.sh restore <бэкап>      восстановить (--from-s3 — из внешнего хранилища)
#   sudo /opt/averra/averra.sh update --version X   обновить: бэкап → образ → миграции → проверка → откат
#   sudo /opt/averra/averra.sh status [--json]      состояние установки (так его берёт pnpm fleet)
#
# Бэкап по расписанию запускает таймер systemd averra-backup.timer (ставит install.sh).
# Подробно — документация: https://midhey.github.io/averra-cms/install/

set -euo pipefail

AVERRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$AVERRA_DIR/.env"
BACKUP_DIR="$AVERRA_DIR/backups"
# Итоги бэкапов и обновлений для API (в контейнере — /data/state только на чтение). Имена файлов —
# те же, что в apps/api/src/status/host.ts
STATE_DIR="$AVERRA_DIR/state"
LOCK_FILE="$AVERRA_DIR/.averra.lock"
# Обновление: отметка незавершённого обновления (ход по шагам), лог, номер процесса и его итог
UPDATE_RUN="$AVERRA_DIR/.update-run"
UPDATE_LOG="$AVERRA_DIR/update.log"
UPDATE_PID="$AVERRA_DIR/.update-pid"
UPDATE_EXIT="$AVERRA_DIR/.update-exit"
# Внешнее хранилище — rclone в контейнере: на хосте ставить нечего. Версия точная
RCLONE_IMAGE='rclone/rclone:1.75.2'
# Сколько ждать /api/health/ready после запуска API, секунд
READY_TIMEOUT="${AVERRA_READY_TIMEOUT:-180}"

usage() {
  cat <<'EOF'
Управление установкой Averra.

  averra.sh backup [--kind manual|scheduled]   бэкап базы и медиа, проверка восстановлением,
                                               копия во внешнее хранилище (если задано в .env)
  averra.sh backups                            список бэкапов
  averra.sh verify <бэкап>                     проверить бэкап: контрольные суммы и восстановление
                                               дампа во временную базу
  averra.sh restore <бэкап> [--yes]            восстановить базу и медиа из бэкапа
  averra.sh restore --from-s3 <бэкап> [--yes]  то же из внешнего хранилища
  averra.sh update --version <версия> [--yes]  обновить: бэкап → новая версия → миграции →
                                               проверка → при сбое откат
  averra.sh status [--json]                    состояние установки
  averra.sh help                               эта справка

Обновление идёт в фоне на сервере, отвязанным от SSH: обрыв связи его не прервёт, лог — update.log
рядом. Если процесс всё же оборвался (перезагрузка), повторите ту же команду update: она доведёт
прерванное до конца — закончит обновление или откатит.

Настройки бэкапов — в .env рядом: BACKUP_KEEP (по умолчанию 7: столько последних бэкапов и не
старше стольких дней), внешнее хранилище — BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_BUCKET,
BACKUP_S3_PREFIX, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY. Копия шифруется паролем
BACKUP_PASSPHRASE. Сколько ждать готовности API при update и restore — переменная окружения
AVERRA_READY_TIMEOUT (секунды, по умолчанию 180): sudo AVERRA_READY_TIMEOUT=300 averra.sh update …
EOF
}

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
fail() {
  printf 'Ошибка: %s\n' "$*" >&2
  exit 1
}

# ── .env и отметка обновления: «ключ=значение», чтение без выполнения, запись с правами 600 ─

kv_get() {
  local file="$1" key="$2" line
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

kv_set() {
  # Одно значение: остальные строки как есть, файл с секретами не бывает доступен другим ни на миг
  local file="$1" key="$2" value="$3" tmp
  tmp="$(umask 077 && mktemp "$file.XXXXXX")"
  {
    grep -vE "^${key}=" "$file" 2>/dev/null || true
    printf '%s=%s\n' "$key" "$value"
  } >"$tmp"
  mv -f "$tmp" "$file"
}

env_get() { kv_get "$ENV_FILE" "$1"; }
env_set() { kv_set "$ENV_FILE" "$1" "$2"; }

compose() { docker compose --project-directory "$AVERRA_DIR" "$@"; }

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
stamp() { date -u +%Y%m%d-%H%M%S; }

# Имя бэкапа: время UTC и вид. Его же проверяет схема BackupRun в API
BACKUP_NAME_RE='^[0-9]{8}-[0-9]{6}-(scheduled|manual|pre-update)$'
VERSION_RE='^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
# База, отложенная при откате обновления: в ней данные, принятые после бэкапа. Её же имя
# проверяет схема UpdateRun в API
ROLLED_BACK_PREFIX='averra_rolled_back_'
# База, на которой не поднялся API при восстановлении: в ней данные бэкапа
FAILED_RESTORE_PREFIX='averra_failed_restore_'
# Служебные базы с копиями данных и временем в имени: их удаляет срок хранения бэкапов (152-ФЗ)
SERVICE_DB_RE='^averra_(rolled_back|failed_restore)_[0-9]{8}_[0-9]{6}$'

# Граница срока хранения: всё, что старше keep дней, удаляется (152-ФЗ). В формате имени бэкапа,
# поэтому сравнивается строкой
cutoff_stamp() { date -u -d "-$1 days" +%Y%m%d-%H%M%S; }

# Один замок на бэкап, восстановление и обновление: ночной бэкап посреди обновления не пойдёт
take_lock() {
  exec 9>"$LOCK_FILE"
  flock -n 9 || fail 'уже идёт бэкап, восстановление или обновление (замок .averra.lock). Подождите'
}

# ── Файлы состояния для API ────────────────────────────────────────────────────────────────
# Значения — свои: имена, времена, числа и фиксированные причины. Вывод команд сюда не попадает:
# в нём бывают параметры подключения

json_str() {
  local value="${1//\\/\\\\}"
  printf '"%s"' "${value//\"/\\\"}"
}
json_or_null() { if [[ -n "$1" ]]; then json_str "$1"; else printf 'null'; fi; }
num_or_null() { if [[ "$1" =~ ^[0-9]+$ ]]; then printf '%s' "$1"; else printf 'null'; fi; }

write_state() {
  local file="$1" content="$2" tmp
  mkdir -p "$STATE_DIR"
  tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
  printf '%s\n' "$content" >"$tmp"
  # API в контейнере читает файл не от root
  chmod 644 "$tmp"
  mv -f "$tmp" "$STATE_DIR/$file"
}

# ── База ───────────────────────────────────────────────────────────────────────────────────

psql_value() {
  # psql_value <база> <запрос> — одно значение без пробелов
  compose exec -T postgres psql -U averra -d "$1" -tAc "$2" | tr -d '[:space:]'
}

count_migrations() { psql_value "$1" 'select count(*) from drizzle.__drizzle_migrations'; }
# Есть ли база с таким именем: 1 или 0. Имя — только наше (латиница, цифры, _), не ввод человека
db_exists() { psql_value postgres "select count(*) from pg_database where datname = '$1'"; }
count_tables() {
  psql_value "$1" "select count(*) from information_schema.tables where table_schema = 'public'"
}

wait_ready() {
  local tries=$((READY_TIMEOUT / 2)) i
  [[ $tries -ge 1 ]] || tries=1
  for ((i = 0; i < tries; i++)); do
    if compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# API и Caddy запущены. Caddy с ошибкой в Caddyfile или битым образом перезапускается по кругу:
# поэтому смотрим дважды с паузой — оба раза он должен быть в running
services_running() {
  local running i
  for i in 1 2; do
    running="$(compose ps --status running --services 2>/dev/null)" || return 1
    grep -qx api <<<"$running" && grep -qx caddy <<<"$running" || return 1
    [[ $i -eq 2 ]] || sleep 5
  done
}

# Дамп восстанавливается во временную базу — так проверяется, что из него можно подняться,
# а не только что он записан. Совпасть должны число миграций и таблиц
verify_dump() {
  local dump="$1" migrations="$2" tables="$3" ok=0
  compose exec -T postgres dropdb -U averra --if-exists averra_verify >/dev/null 2>&1 || return 1
  compose exec -T postgres createdb -U averra averra_verify >/dev/null 2>&1 || return 1
  if compose exec -T postgres pg_restore -U averra -d averra_verify --no-owner --exit-on-error \
    <"$dump" >/dev/null 2>&1; then
    [[ "$(count_migrations averra_verify 2>/dev/null)" == "$migrations" ]] &&
      [[ "$(count_tables averra_verify 2>/dev/null)" == "$tables" ]] && ok=1
  fi
  compose exec -T postgres dropdb -U averra --if-exists averra_verify >/dev/null 2>&1 || true
  [[ $ok -eq 1 ]]
}

verify_media() { gzip -t "$1" 2>/dev/null && tar -tzf "$1" >/dev/null 2>&1; }

# ── Внешнее хранилище (rclone, crypt поверх s3) ────────────────────────────────────────────

remote_enabled() { [[ -n "$(env_get BACKUP_S3_BUCKET)" ]]; }

# Секреты — переменными окружения: в контейнер rclone они уходят через -e VAR без значения,
# поэтому их нет ни в аргументах docker, ни в списке процессов
prepare_remote() {
  local bucket prefix passphrase
  bucket="$(env_get BACKUP_S3_BUCKET)"
  prefix="$(env_get BACKUP_S3_PREFIX)"
  [[ -n "$prefix" ]] || prefix="averra/$(env_get SITE_DOMAIN)"
  passphrase="$(env_get BACKUP_PASSPHRASE)"
  [[ -n "$passphrase" ]] || return 1
  [[ -n "$(env_get BACKUP_S3_ACCESS_KEY_ID)" && -n "$(env_get BACKUP_S3_SECRET_ACCESS_KEY)" ]] ||
    return 1
  export RCLONE_CONFIG_AVERRAS3_ACCESS_KEY_ID RCLONE_CONFIG_AVERRAS3_SECRET_ACCESS_KEY
  RCLONE_CONFIG_AVERRAS3_ACCESS_KEY_ID="$(env_get BACKUP_S3_ACCESS_KEY_ID)"
  RCLONE_CONFIG_AVERRAS3_SECRET_ACCESS_KEY="$(env_get BACKUP_S3_SECRET_ACCESS_KEY)"
  # Пароль crypt rclone принимает только «затемнённым» (rclone obscure); сам пароль — через stdin
  export RCLONE_CONFIG_AVERRA_PASSWORD
  RCLONE_CONFIG_AVERRA_PASSWORD="$(printf '%s\n' "$passphrase" |
    docker run --rm -i --cap-drop ALL "$RCLONE_IMAGE" obscure -)" || return 1
  [[ -n "$RCLONE_CONFIG_AVERRA_PASSWORD" ]] || return 1
  REMOTE_TARGET="averras3:$bucket/$prefix"
  REMOTE_ENDPOINT="$(env_get BACKUP_S3_ENDPOINT)"
  [[ -n "$REMOTE_ENDPOINT" ]] || REMOTE_ENDPOINT='https://storage.yandexcloud.net'
  REMOTE_REGION="$(env_get BACKUP_S3_REGION)"
  [[ -n "$REMOTE_REGION" ]] || REMOTE_REGION='ru-central1'
}

rclone_run() {
  # rclone_run [-v том] -- <аргументы rclone>
  local mounts=()
  while [[ $# -gt 0 && "$1" != '--' ]]; do
    mounts+=("$1")
    shift
  done
  shift
  docker run --rm --cap-drop ALL --security-opt no-new-privileges:true "${mounts[@]}" \
    -e RCLONE_CONFIG_AVERRAS3_TYPE=s3 \
    -e RCLONE_CONFIG_AVERRAS3_PROVIDER=Other \
    -e "RCLONE_CONFIG_AVERRAS3_ENDPOINT=$REMOTE_ENDPOINT" \
    -e "RCLONE_CONFIG_AVERRAS3_REGION=$REMOTE_REGION" \
    -e RCLONE_CONFIG_AVERRAS3_NO_CHECK_BUCKET=true \
    -e RCLONE_CONFIG_AVERRAS3_ACCESS_KEY_ID \
    -e RCLONE_CONFIG_AVERRAS3_SECRET_ACCESS_KEY \
    -e RCLONE_CONFIG_AVERRA_TYPE=crypt \
    -e "RCLONE_CONFIG_AVERRA_REMOTE=$REMOTE_TARGET" \
    -e RCLONE_CONFIG_AVERRA_PASSWORD \
    "$RCLONE_IMAGE" --config '' "$@"
}

# Копия бэкапа в хранилище. Код 1 — не выгрузилась
upload_backup() {
  rclone_run -v "$BACKUP_DIR/$1:/backup:ro" -- copy /backup "averra:$1"
}

# Чистка хранилища: столько же и не дольше, чем локально — keep последних и не старше keep дней.
# Код 1 — список или удаление не прошли: старые копии с персональными данными остались, это
# должно быть видно в состоянии, а не теряться
cleanup_remote() {
  local keep="$1" protect="$2" list total cutoff old failed=0
  list="$(rclone_run -- lsf --dirs-only averra:)" || return 1
  list="$(printf '%s\n' "$list" | tr -d '/' | grep -E "$BACKUP_NAME_RE" | sort || true)"
  total="$(printf '%s\n' "$list" | grep -c . || true)"
  cutoff="$(cutoff_stamp "$keep")" || return 1
  while read -r old; do
    [[ -n "$old" && "$old" != "$protect" ]] || continue
    rclone_run -- purge "averra:$old" || failed=1
  done < <(expired_names "$list" "$total" "$keep" "$cutoff")
  return $failed
}

# Что удалить из отсортированного списка бэкапов: лишние сверх keep (самые старые) и все старше
# границы срока. По одному разу, по порядку
expired_names() {
  local list="$1" total="$2" keep="$3" cutoff="$4"
  {
    [[ $total -le $keep ]] || printf '%s\n' "$list" | head -n $((total - keep))
    printf '%s\n' "$list" | awk -v cutoff="$cutoff" '$0 != "" && $0 < cutoff'
  } | sort -u
}

# ── Бэкап ──────────────────────────────────────────────────────────────────────────────────

backup_keep() {
  local keep
  keep="$(env_get BACKUP_KEEP)"
  [[ -n "$keep" ]] || keep=7
  [[ "$keep" =~ ^[0-9]+$ && $keep -ge 1 && $keep -le 365 ]] ||
    fail "BACKUP_KEEP=$keep в .env — число от 1 до 365"
  printf '%s' "$keep"
}

# Срок хранения (152-ФЗ). Локально — keep последних удачных и ни одного старше keep дней, брошенные
# временные папки; служебные базы (откат обновления, неудачное восстановление) старше keep дней.
# Идёт после каждого бэкапа — и удачного, и нет: если бэкапы падают неделями, старые копии всё равно уходят по сроку.
# Бэкап protect (только что сделанный) не удаляется никогда. Пока обновление не доведено (есть
# отметка .update-run), не удаляются и его бэкап, и отложенная им база: из них повтор update
# откатывает (ночной бэкап после перезагрузки посреди обновления их не тронет)
rotate_backups() {
  local keep="$1" protect="$2" all total name cutoff db pending='' pending_db=''
  cutoff="$(cutoff_stamp "$keep")" || return 1
  if [[ -f "$UPDATE_RUN" ]]; then
    pending="$(run_get BACKUP)"
    pending_db="$(run_get KEPT)"
  fi
  all="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null |
    grep -E "$BACKUP_NAME_RE" | sort || true)"
  total="$(printf '%s\n' "$all" | grep -c . || true)"
  while read -r name; do
    [[ -n "$name" && "$name" != "$protect" && "$name" != "$pending" ]] || continue
    rm -rf "${BACKUP_DIR:?}/$name"
  done < <(expired_names "$all" "$total" "$keep" "$cutoff")
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '.tmp-*' -exec rm -rf {} + 2>/dev/null || true
  # Базы averra нет — рабочие данные, возможно, лежат под служебным именем: откат обновления
  # оборвался между переименованиями и кончился rollback-failed, отметки .update-run уже нет.
  # Тогда служебные базы по сроку не удаляются, пока человек не вернёт рабочую на место: удалить
  # единственную копию рабочих данных хуже, чем подержать копию дольше срока
  if [[ "$(db_exists averra 2>/dev/null || true)" == 0 ]]; then
    say 'Базы averra нет: служебные базы (averra_rolled_back_*, averra_failed_restore_*) по сроку не удаляются — в одной из них могут быть рабочие данные. Верните рабочую базу на место (averra.sh status, update-last.json)'
    return 0
  fi
  # Служебные базы с копиями данных (откат обновления, неудачное восстановление): имя несёт время.
  # База не ответила — в следующий раз
  while read -r db; do
    db="${db//[[:space:]]/}"
    [[ "$db" =~ $SERVICE_DB_RE && "$db" != "$pending_db" ]] || continue
    # Время — последние 15 знаков имени: ГГГГММДД_ЧЧММСС
    name="${db: -15}"
    [[ "${name/_/-}" < "$cutoff" ]] || continue
    if compose exec -T postgres dropdb -U averra --if-exists "$db" >/dev/null 2>&1; then
      say "Удалена база $db: срок хранения ($keep дн.) вышел"
    fi
  done < <(compose exec -T postgres psql -U averra -d postgres -tAc \
    "select datname from pg_database where datname ~ '^averra_(rolled_back|failed_restore)_'" 2>/dev/null || true)
}

backup_state() {
  # backup_state <имя> <вид> <начало> <ok> <проверен> <байт базы> <байт медиа> <копия> <причина>
  printf '{"name":%s,"kind":%s,"startedAt":%s,"finishedAt":%s,"ok":%s,"verified":%s,"dbBytes":%s,"mediaBytes":%s,"remote":%s,"error":%s}' \
    "$(json_str "$1")" "$(json_str "$2")" "$(json_str "$3")" "$(json_str "$(now_iso)")" \
    "$4" "$5" "$(num_or_null "$6")" "$(num_or_null "$7")" "$(json_str "$8")" "$(json_or_null "$9")"
}

# Чистка внешнего хранилища, когда новой копии нет (бэкап не удался): срок хранения соблюдается
# и так. Печатает итог для состояния: off или cleanup-failed
cleanup_remote_only() {
  local keep="$1"
  if ! remote_enabled; then
    printf 'off'
  elif prepare_remote && cleanup_remote "$keep" '' >/dev/null 2>&1; then
    printf 'off'
  else
    printf 'cleanup-failed'
  fi
}

# Делает бэкап; имя — в BACKUP_NAME. Код 1 — бэкап не удался (состояние записано).
# defer=1 — без внешней копии, ротации и состояния: их делает finish_backup позже (обновление
# выгружает копию, когда сервис снова работает, а не держит его остановленным)
do_backup() {
  local kind="$1" defer="${2:-0}" keep started name tmp error='' migrations='' tables=''
  local db_bytes='' media_bytes='' state remote
  started="$(now_iso)"
  name="$(stamp)-$kind"
  # Два бэкапа в одну секунду (обновление сразу после ручного) — ждём следующую
  while [[ -e "$BACKUP_DIR/$name" || -e "$BACKUP_DIR/.tmp-$name" ]]; do
    sleep 1
    name="$(stamp)-$kind"
  done
  BACKUP_NAME="$name"
  # do_backup зовут под if и ||, где set -e не действует: каждый сбой проверяется явно.
  # Кривой BACKUP_KEEP — бэкапа нет, и это видно в состоянии сразу, а не через двое суток
  if ! keep="$(backup_keep)"; then
    state="$(backup_state "$name" "$kind" "$started" false false '' '' off 'BACKUP_KEEP в .env неверный: нужно число от 1 до 365')"
    write_state backup-last.json "$state"
    return 1
  fi
  tmp="$BACKUP_DIR/.tmp-$name"
  (umask 077 && mkdir -p "$BACKUP_DIR" && mkdir "$tmp") || {
    say "Не создать папку бэкапа в $BACKUP_DIR"
    return 1
  }

  step "Бэкап $name"
  # Файлы с персональными данными (заявки) — только root
  umask 077
  if ! compose exec -T postgres pg_dump -U averra -d averra -Fc >"$tmp/db.dump" 2>/dev/null ||
    [[ ! -s "$tmp/db.dump" ]]; then
    error='pg_dump не прошёл: база не ответила'
  fi
  if [[ -z "$error" ]]; then
    migrations="$(count_migrations averra 2>/dev/null || true)"
    tables="$(count_tables averra 2>/dev/null || true)"
    [[ "$migrations" =~ ^[0-9]+$ && "$tables" =~ ^[0-9]+$ ]] ||
      error='не удалось прочитать число миграций и таблиц базы'
  fi
  # Медиатека — отдельным контейнером с тем же томом: бэкап идёт и при остановленном API
  # (обновление останавливает его перед бэкапом, а ещё API может просто лежать). Служебные папки
  # восстановления (media/.averra-*) — не медиатека: в архиве они удвоили бы его
  if [[ -z "$error" ]] &&
    ! compose run --rm --no-deps -T --entrypoint tar api '--exclude=media/.averra-*' -C /data -czf - media \
      </dev/null >"$tmp/media.tar.gz" 2>/dev/null; then
    error='архив медиатеки не записался'
  fi
  if [[ -z "$error" ]]; then
    say 'Проверяю: дамп восстанавливается во временную базу, архив медиа читается'
    if ! verify_dump "$tmp/db.dump" "$migrations" "$tables"; then
      error='дамп не восстановился во временную базу'
    elif ! verify_media "$tmp/media.tar.gz"; then
      error='архив медиатеки не читается'
    fi
  fi
  if [[ -z "$error" ]]; then
    db_bytes="$(wc -c <"$tmp/db.dump" | tr -d ' ')"
    media_bytes="$(wc -c <"$tmp/media.tar.gz" | tr -d ' ')"
    if ! (cd "$tmp" && sha256sum db.dump media.tar.gz >SHA256SUMS) ||
      ! printf '{"name":%s,"kind":%s,"version":%s,"siteId":%s,"createdAt":%s,"migrations":%s,"tables":%s,"dbBytes":%s,"mediaBytes":%s,"verified":true}\n' \
        "$(json_str "$name")" "$(json_str "$kind")" "$(json_str "$(env_get AVERRA_VERSION)")" \
        "$(json_or_null "$(env_get SITE_ID)")" "$(json_str "$started")" "$migrations" "$tables" \
        "$db_bytes" "$media_bytes" >"$tmp/manifest.json" ||
      ! mv "$tmp" "$BACKUP_DIR/$name"; then
      error='файлы бэкапа не записались: нет места на диске?'
    fi
  fi
  if [[ -n "$error" ]]; then
    # Неполный бэкап не хранится: в нём те же персональные данные, а восстановиться из него нельзя
    rm -rf "$tmp"
    say "Бэкап не удался: $error"
    rotate_backups "$keep" '' || true
    remote="$(cleanup_remote_only "$keep")"
    state="$(backup_state "$name" "$kind" "$started" false false '' '' "$remote" "$error")"
    write_state backup-last.json "$state"
    return 1
  fi
  say "Бэкап записан и проверен: $BACKUP_DIR/$name"
  BACKUP_DONE=("$name" "$kind" "$started" "$keep" "$db_bytes" "$media_bytes")
  [[ "$defer" == 1 ]] || finish_backup
}

# Удачный бэкап (BACKUP_DONE от do_backup): копия во внешнее хранилище, срок хранения, состояние
finish_backup() {
  local name="${BACKUP_DONE[0]}" kind="${BACKUP_DONE[1]}" started="${BACKUP_DONE[2]}"
  local keep="${BACKUP_DONE[3]}" remote='off' state
  if remote_enabled; then
    if ! prepare_remote || ! upload_backup "$name"; then
      remote='failed'
      say 'Копия во внешнее хранилище не выгрузилась (локальный бэкап цел). Проверьте BACKUP_S3_* в .env'
      # Срок хранения старых копий там соблюдается и без новой
      cleanup_remote "$keep" "$name" >/dev/null 2>&1 || true
    elif ! cleanup_remote "$keep" "$name"; then
      remote='cleanup-failed'
      say 'Зашифрованная копия — во внешнем хранилище, но старые копии там не удалились: проверьте право ключа на удаление'
    else
      remote='uploaded'
      say 'Зашифрованная копия — во внешнем хранилище'
    fi
  fi
  rotate_backups "$keep" "$name" || true
  state="$(backup_state "$name" "$kind" "$started" true true "${BACKUP_DONE[4]}" "${BACKUP_DONE[5]}" "$remote" '')"
  write_state backup-last.json "$state"
  write_state backup-last-ok.json "$state"
}

cmd_backup() {
  local kind='manual'
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --kind)
        [[ $# -ge 2 && "$2" =~ ^(manual|scheduled)$ ]] || fail '--kind: manual или scheduled'
        kind="$2"
        shift 2
        ;;
      *) fail "непонятный аргумент: $1" ;;
    esac
  done
  take_lock
  do_backup "$kind" || exit 1
}

cmd_backups() {
  local name manifest
  [[ -d "$BACKUP_DIR" ]] || { say 'Бэкапов нет'; return; }
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E "$BACKUP_NAME_RE" | sort |
    while read -r name; do
      manifest="$BACKUP_DIR/$name/manifest.json"
      if [[ -f "$manifest" ]]; then
        say "$name  версия $(grep -oE '"version":"[^"]*"' "$manifest" | cut -d'"' -f4)  $(du -sh "$BACKUP_DIR/$name" | cut -f1)"
      else
        say "$name  (без манифеста — неполный)"
      fi
    done
}

backup_path() {
  local name="$1"
  [[ "$name" =~ $BACKUP_NAME_RE ]] || fail "«$name» — не имя бэкапа (список: averra.sh backups)"
  [[ -f "$BACKUP_DIR/$name/manifest.json" && -f "$BACKUP_DIR/$name/db.dump" ]] ||
    fail "нет бэкапа $name в $BACKUP_DIR"
  printf '%s' "$BACKUP_DIR/$name"
}

manifest_number() { grep -oE "\"$2\":[0-9]+" "$1/manifest.json" | cut -d: -f2; }

check_sums() { (cd "$1" && sha256sum -c --quiet SHA256SUMS >/dev/null 2>&1); }

cmd_verify() {
  local dir
  [[ $# -eq 1 ]] || fail 'нужно имя бэкапа: averra.sh verify <бэкап>'
  dir="$(backup_path "$1")"
  take_lock
  check_sums "$dir" || fail 'контрольные суммы не сошлись: файлы бэкапа повреждены'
  verify_media "$dir/media.tar.gz" || fail 'архив медиатеки не читается'
  verify_dump "$dir/db.dump" "$(manifest_number "$dir" migrations)" "$(manifest_number "$dir" tables)" ||
    fail 'дамп не восстановился во временную базу'
  say "Бэкап $1 в порядке: суммы сходятся, дамп восстанавливается, архив медиа читается"
}

# ── Восстановление ─────────────────────────────────────────────────────────────────────────

# База из дампа: сначала в новую базу averra_restore (рабочая не тронута, если дамп не встанет),
# потом API останавливается и базы меняются именами. Прежняя рабочая база отходит под именем aside
# и не удаляется здесь: в ней всё, что изменилось после бэкапа. Если база aside уже есть (прошлое
# восстановление не разобрано) — отказ, молча её не удаляем.
# Код 1 — рабочая база на месте под именем averra (API мог остаться остановленным). Код 2 — базы
# averra нет: прежняя лежит под именем aside, а вернуть её не вышло (что делать — напечатано)
restore_database() {
  local dir="$1" aside="$2" exists
  exists="$(db_exists "$aside" 2>/dev/null || true)"
  if [[ "$exists" != 0 ]]; then
    say "На сервере уже есть база $aside (или Postgres не ответил): в ней могут быть нужные данные прошлого восстановления или отката. Разберитесь и, если она не нужна, удалите (docker compose exec postgres dropdb -U averra $aside), потом повторите"
    return 1
  fi
  compose exec -T postgres dropdb -U averra --if-exists averra_restore >/dev/null 2>&1 || return 1
  compose exec -T postgres createdb -U averra averra_restore >/dev/null 2>&1 || return 1
  if ! compose exec -T postgres pg_restore -U averra -d averra_restore --no-owner --exit-on-error \
    <"$dir/db.dump" >/dev/null 2>&1; then
    compose exec -T postgres dropdb -U averra --if-exists averra_restore >/dev/null 2>&1 || true
    say 'Дамп не восстановился — рабочая база не тронута'
    return 1
  fi
  compose stop api || return 1
  psql_value postgres "ALTER DATABASE averra RENAME TO $aside" >/dev/null || return 1
  if ! psql_value postgres 'ALTER DATABASE averra_restore RENAME TO averra' >/dev/null; then
    # Первое переименование прошло, второе нет: без возврата базы averra не было бы вовсе
    if psql_value postgres "ALTER DATABASE $aside RENAME TO averra" >/dev/null; then
      compose exec -T postgres dropdb -U averra --if-exists averra_restore >/dev/null 2>&1 || true
      say 'Восстановленная база не встала на место — рабочая база возвращена, она не тронута'
      return 1
    fi
    say "Рабочей базы averra сейчас нет: прежняя лежит под именем $aside, восстановленная — averra_restore. Верните прежнюю: docker compose --project-directory $AVERRA_DIR exec postgres psql -U averra -d postgres -c 'ALTER DATABASE $aside RENAME TO averra'"
    return 2
  fi
}

# Не поднялось — вернуть прежнюю базу (aside) на место; неподнявшаяся отходит под именем failed
undo_restore_database() {
  local aside="$1" failed="$2"
  compose stop api || true
  psql_value postgres "ALTER DATABASE averra RENAME TO $failed" >/dev/null || return 1
  psql_value postgres "ALTER DATABASE $aside RENAME TO averra" >/dev/null || return 1
}

# Медиатека из бэкапа распаковывается во временную папку на том же томе, пока всё работает, а
# подменяет рабочую, пока API остановлен: после переименования баз и до запуска. API при старте
# сразу собирает опубликованные сайты заново и берёт картинки из медиатеки — к этой минуте она
# уже должна быть восстановленной (на новом сервере она пуста, и сборка без картинок упала бы).
# Прежняя медиатека не удаляется, а отходит в соседнюю папку на том же томе (переименование — без
# копирования и места): API не поднялся — она возвращается на место, поднялся — удаляется
MEDIA_STAGE='/data/media/.averra-restore'
MEDIA_BEFORE='/data/media/.averra-before-restore'

# Код 3 — в томе уже лежит прежняя медиатека от прошлого восстановления, которое не дошло до конца:
# молча её не удаляем, как и базу averra_before_restore
stage_media() {
  compose run --rm --no-deps -T --entrypoint sh api -c \
    "if [ -e $MEDIA_BEFORE ]; then exit 3; fi && rm -rf $MEDIA_STAGE && mkdir $MEDIA_STAGE && tar -C $MEDIA_STAGE -xzf -" <"$1"
}

drop_media_stage() {
  compose run --rm --no-deps -T --entrypoint sh api -c "rm -rf $MEDIA_STAGE" </dev/null \
    >/dev/null 2>&1 || true
}

# Что в корне тома пришло из бэкапа: имена записываются до подмены. Возврат прежней медиатеки
# удаляет в корне только их — прежнее, что не успело переехать, не тронет
MEDIA_RESTORED_NAMES='/data/media/.averra-restore-names'

# Подмена в две фазы, mv по find с «+»: сбой любого переноса — ненулевой код (с «\;» find его бы
# проглотил).
# 1. Прежнее содержимое тома — в .averra-before-restore. Не переехало целиком (кончилось место,
#    сбой) — уже перенесённое сразу возвращается в корень, в корне ничего не удаляется: код 4.
#    Вернуть не вышло — код 5, прежние картинки частью в корне, частью в .averra-before-restore.
# 2. Распакованное — на место прежнего. Сбой — код 1: прежняя медиатека целиком в
#    .averra-before-restore, вернёт её unswap_media
SWAP_MEDIA_SCRIPT='cd /data/media || exit 1
if [ -d .averra-restore/media ]; then ls -A .averra-restore/media; fi >.averra-restore-names || exit 1
mkdir .averra-before-restore || exit 1
if ! find . -mindepth 1 -maxdepth 1 ! -name .averra-restore ! -name .averra-before-restore ! -name .averra-restore-names -exec mv -t .averra-before-restore {} +; then
  rm -rf .averra-restore .averra-restore-names
  find .averra-before-restore -mindepth 1 -maxdepth 1 -exec mv -t . {} + && rmdir .averra-before-restore || exit 5
  exit 4
fi
if [ -d .averra-restore/media ]; then find .averra-restore/media -mindepth 1 -maxdepth 1 -exec mv -t . {} + || exit 1; fi
rm -rf .averra-restore'

swap_media() {
  compose run --rm --no-deps -T --entrypoint sh api -c "$SWAP_MEDIA_SCRIPT" </dev/null
}

# Вернуть прежнюю медиатеку на место (подмена не прошла или API не поднялся). В корне удаляется
# только пришедшее из бэкапа (оно и так есть в архиве) — по списку имён; списка нет — не удаляется
# ничего, и прежнее, не уместившись рядом, останется в .averra-before-restore (ненулевой код)
UNSWAP_MEDIA_SCRIPT='cd /data/media || exit 1
if [ -d .averra-before-restore ]; then
  if [ -f .averra-restore-names ]; then
    while IFS= read -r name; do [ -z "$name" ] || rm -rf "./$name" || exit 1; done <.averra-restore-names
  fi
  find .averra-before-restore -mindepth 1 -maxdepth 1 -exec mv -t . {} + && rmdir .averra-before-restore || exit 1
fi
rm -rf .averra-restore .averra-restore-names'

unswap_media() {
  compose run --rm --no-deps -T --entrypoint sh api -c "$UNSWAP_MEDIA_SCRIPT" </dev/null
}

drop_media_before() {
  compose run --rm --no-deps -T --entrypoint sh api -c "rm -rf $MEDIA_BEFORE $MEDIA_RESTORED_NAMES" </dev/null
}

# Собранные сайты — производные данные: API при старте соберёт опубликованные сайты без версии на
# диске заново из той базы и медиатеки, на которых поднимется
clear_sites() {
  compose run --rm --no-deps -T --entrypoint sh api -c 'find /data/sites -mindepth 1 -maxdepth 1 -exec rm -rf {} +' </dev/null ||
    true
}

download_backup() {
  local name="$1" tmp
  [[ "$name" =~ $BACKUP_NAME_RE ]] || fail "«$name» — не имя бэкапа"
  remote_enabled || fail 'внешнее хранилище не задано (BACKUP_S3_BUCKET в .env)'
  prepare_remote || fail 'не хватает настроек хранилища или BACKUP_PASSPHRASE в .env'
  [[ ! -e "$BACKUP_DIR/$name" ]] || return 0
  tmp="$BACKUP_DIR/.tmp-download-$name"
  (umask 077 && mkdir -p "$tmp")
  step "Скачиваю и расшифровываю $name из хранилища"
  rclone_run -v "$tmp:/restore" -- copy "averra:$name" /restore ||
    { rm -rf "$tmp"; fail 'не скачалось из хранилища'; }
  mv "$tmp" "$BACKUP_DIR/$name"
}

cmd_restore() {
  local name='' from_s3=0 yes=0 dir answer code=0 site previous_site failed
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from-s3) from_s3=1; shift ;;
      --yes | -y) yes=1; shift ;;
      -*) fail "непонятный аргумент: $1" ;;
      *) name="$1"; shift ;;
    esac
  done
  [[ -n "$name" ]] || fail 'нужно имя бэкапа: averra.sh restore <бэкап> (список: averra.sh backups)'
  take_lock
  [[ $from_s3 -eq 0 ]] || download_backup "$name"
  dir="$(backup_path "$name")"
  if [[ $yes -eq 0 ]]; then
    [[ -t 0 ]] || fail 'нет терминала для подтверждения: добавьте --yes'
    read -r -p "Всё, что изменилось после $name (заявки, страницы, картинки), пропадёт. Восстановить? [да/нет] " answer
    [[ "$answer" == 'да' ]] || fail 'отменено'
  fi
  step 'Проверяю бэкап'
  check_sums "$dir" || fail 'контрольные суммы не сошлись: файлы бэкапа повреждены, ничего не менялось'
  verify_media "$dir/media.tar.gz" || fail 'архив медиатеки не читается, ничего не менялось'
  step 'Распаковываю медиатеку во временную папку (рабочая пока не тронута)'
  stage_media "$dir/media.tar.gz" || code=$?
  if [[ $code -ne 0 ]]; then
    [[ $code -ne 3 ]] || fail "в томе медиатеки уже есть папка .averra-before-restore — прежние картинки от прошлого восстановления, которое не дошло до конца. Разберитесь (docker compose --project-directory $AVERRA_DIR run --rm --no-deps --entrypoint sh api, папка $MEDIA_BEFORE) и, если они не нужны, удалите её, потом повторите; ничего не менялось"
    drop_media_stage
    fail 'медиатека из бэкапа не распаковалась, ничего не менялось'
  fi
  step 'Восстанавливаю базу (сначала во временную)'
  restore_database "$dir" averra_before_restore || code=$?
  if [[ $code -ne 0 ]]; then
    drop_media_stage
    [[ $code -ne 2 ]] || fail 'база не восстановлена, и рабочая база не на своём месте — что сделать, написано выше'
    # API мог остановиться перед переименованием баз
    compose up -d api >/dev/null 2>&1 || true
    fail 'база не восстановлена; рабочая база и медиатека не тронуты'
  fi
  # Неподнявшаяся база — с временем в имени: её удалит срок хранения бэкапов (в ней их данные)
  failed="${FAILED_RESTORE_PREFIX}$(date -u +%Y%m%d_%H%M%S)"
  # API остановлен (restore_database): до запуска ничего не собирается, медиатека и сайты меняются
  # без него
  step 'Подменяю медиатеку восстановленной (прежняя — рядом, пока API не поднимется)'
  code=0
  swap_media || code=$?
  if [[ $code -ne 0 ]]; then
    # 5 — прежняя медиатека не переехала целиком и не вернулась: ничего не удалено, но она
    # разделена. Базу не трогаем: API без медиатеки не запустить, пусть разбирается человек
    [[ $code -ne 5 ]] ||
      fail "медиатека не подменилась: прежние картинки не перенеслись целиком и не вернулись — часть в томе медиатеки на месте, часть в папке $MEDIA_BEFORE. Ничего не удалено: верните содержимое $MEDIA_BEFORE в /data/media. База восстановлена, прежняя — averra_before_restore, API остановлен: разберитесь руками"
    # 4 — прежняя медиатека не переехала целиком, но уже вернулась на место: возвращать нечего.
    # Иначе (сбой второй фазы или сама команда) — вернуть по списку из бэкапа
    if [[ $code -ne 4 ]] && ! unswap_media; then
      fail "медиатека не подменилась и прежнюю вернуть не вышло: прежние картинки — в томе медиатеки, папка $MEDIA_BEFORE (что не переехало — на месте). База восстановлена, прежняя — averra_before_restore, API остановлен: разберитесь руками"
    fi
    undo_restore_database averra_before_restore "$failed" ||
      fail "медиатека не подменилась (прежняя на месте), и прежнюю базу вернуть не вышло: на сервере базы $failed (или averra) и averra_before_restore, разберитесь руками"
    compose up -d
    fail "медиатека не подменилась — прежние база и медиатека на месте. Восстановленная база — $failed, она удалится со старыми бэкапами (BACKUP_KEEP дней)"
  fi
  step 'Очищаю собранные сайты: API соберёт их заново из восстановленных базы и медиатеки'
  clear_sites
  # Сайт на домене сайта — тот, что в бэкапе: на новом сервере установщик завёл бы свой SITE_ID
  previous_site="$(env_get SITE_ID)"
  site="$(grep -oE '"siteId":"[0-9a-f-]{36}"' "$dir/manifest.json" | cut -d'"' -f4 || true)"
  if [[ -n "$site" && "$site" != "$previous_site" ]]; then
    env_set SITE_ID "$site"
    say "SITE_ID в .env теперь $site, как в бэкапе: этот сайт Caddy отдаёт на домене сайта"
  fi
  compose up -d
  if ! wait_ready; then
    [[ "$(env_get SITE_ID)" == "$previous_site" ]] || env_set SITE_ID "$previous_site"
    # undo_restore_database сначала останавливает API: медиатека и сайты возвращаются без него
    undo_restore_database averra_before_restore "$failed" ||
      fail "API не поднялся, и прежнюю базу вернуть не вышло: на сервере базы $failed (или averra) и averra_before_restore, разберитесь руками. Прежние картинки — в томе медиатеки, папка $MEDIA_BEFORE"
    if ! unswap_media; then
      compose up -d
      fail "API не поднялся на восстановленной базе. Прежняя база на месте, а прежнюю медиатеку вернуть не вышло: она в томе медиатеки, папка $MEDIA_BEFORE — верните руками. Неподнявшаяся база — $failed"
    fi
    # Неподнявшийся API мог успеть собрать сайты из восстановленной базы: прежний соберёт свои
    clear_sites
    compose up -d
    fail "API не поднялся на восстановленной базе — прежние база и медиатека на месте. Неподнявшаяся база — $failed: в ней данные бэкапа, она удалится со старыми бэкапами (BACKUP_KEEP дней)"
  fi
  # Восстановление на месте человек подтвердил: всё после бэкапа ему не нужно
  drop_media_before ||
    say "Прежняя медиатека не удалилась: она в томе медиатеки, папка $MEDIA_BEFORE (в бэкапы не попадает). Удалите её, иначе следующее восстановление откажет"
  compose exec -T postgres dropdb -U averra --if-exists averra_before_restore >/dev/null 2>&1 || true
  say "Готово: восстановлено из $name. Опубликованные сайты собираются заново из восстановленных базы и медиатеки — итог сборки на экране сайта в админке"
}

# ── Обновление ─────────────────────────────────────────────────────────────────────────────
# Обновление идёт отдельным процессом, отвязанным от терминала и SSH (update-worker): обрыв SSH,
# Ctrl+C у студии или закрытый терминал не бросают установку на полпути. Команда update запускает
# его и показывает его лог (update.log), пока он не кончится; её код — его код. Ход обновления
# записан в отметке .update-run (с какой версии, на какую, шаг, бэкап, число миграций): если
# процесс всё же оборвался (перезагрузка, kill -9), следующий update сначала доводит прерванное —
# проверяет новую версию и либо заканчивает обновление, либо откатывает

run_get() { kv_get "$UPDATE_RUN" "$1"; }
run_set() { kv_set "$UPDATE_RUN" "$1" "$2"; }

update_state() {
  # update_state <итог> <база восстановлена> <причина> [<отложенная база>]; с, на и начало — из
  # отметки. Итог in-progress — обновление идёт, времени конца нет
  local finished=null
  [[ "$1" == in-progress ]] || finished="$(json_str "$(now_iso)")"
  write_state update-last.json "$(printf '{"from":%s,"to":%s,"startedAt":%s,"finishedAt":%s,"result":%s,"dbRestored":%s,"keptDatabase":%s,"error":%s}' \
    "$(json_str "$(run_get FROM)")" "$(json_str "$(run_get TO)")" "$(json_str "$(run_get STARTED)")" \
    "$finished" "$(json_str "$1")" "$2" "$(json_or_null "${4:-}")" "$(json_or_null "$3")")"
}

# Бэкап перед обновлением из отметки: его внешняя копия выгружается в самом конце
resume_backup() {
  local saved
  saved="$(run_get BACKUP_DONE)"
  [[ -n "$saved" ]] || return 1
  read -r -a BACKUP_DONE <<<"$saved"
}

# Итог: состояние для API, внешняя копия бэкапа перед обновлением, отметка снята. Оборвётся на
# выгрузке — следующий update доделает только её (шаг finishing)
update_finish() {
  # update_finish <итог> <база восстановлена> <причина> [<отложенная база>]
  run_set PHASE finishing
  run_set RESULT "$1"
  update_state "$@"
  if resume_backup; then finish_backup || true; fi
  rm -f "$UPDATE_RUN"
}

# Новая версия прошла проверку: новый averra.sh на место
complete_update() {
  local next="$AVERRA_DIR/.next"
  if [[ -s "$next/averra.sh" ]]; then
    install -m 700 "$next/averra.sh" "$AVERRA_DIR/averra.sh.new"
    mv -f "$AVERRA_DIR/averra.sh.new" "$AVERRA_DIR/averra.sh"
  else
    say 'averra.sh новой версии не нашёлся (.next): оставлен прежний'
  fi
  rm -rf "$next"
  say "Готово: версия $(run_get TO). Бэкап перед обновлением — $(run_get BACKUP)"
  update_finish updated false ''
}

# Откат на прежние .env и compose.yaml; база — из бэкапа, если миграции новой версии прошли.
# Рабочая база при этом не удаляется: новая версия могла успеть принять заявки. Выходит из
# процесса: 1 — откат удался, 2 — нет (нужен человек)
rollback_update() {
  local from to backup before after kept db_restored=false code=0
  from="$(run_get FROM)"
  to="$(run_get TO)"
  backup="$(run_get BACKUP)"
  before="$(run_get BEFORE)"
  kept="$(run_get KEPT)"
  [[ "$(run_get RESTORED)" != 1 ]] || db_restored=true
  run_set PHASE rollback
  step "Версия $to не прошла проверку (API или Caddy не работают) — откатываю на $from"
  # Сначала остановить новый API: пока он перезапускается по кругу, он может применить миграции
  # сразу после подсчёта, и прежний образ встал бы на новую схему без восстановления базы
  compose stop api || true
  env_set AVERRA_VERSION "$from"
  # compose.yaml.prev — только копия этого обновления (PREV_SAVED): файл от прошлого обновления
  # вернул бы конфигурацию позапрошлой версии
  [[ "$(run_get PREV_SAVED)" != 1 || ! -f "$AVERRA_DIR/compose.yaml.prev" ]] ||
    cp -p "$AVERRA_DIR/compose.yaml.prev" "$AVERRA_DIR/compose.yaml"
  # Откат повторяемый: прошлый мог оборваться посреди восстановления базы. Отложенная база есть —
  # значит, первое переименование (averra → kept) прошло
  if [[ -n "$kept" && "$(db_exists "$kept" 2>/dev/null || true)" == 1 ]]; then
    if [[ "$(db_exists averra 2>/dev/null || true)" == 0 ]]; then
      # Оборвался между переименованиями: рабочая база — под именем kept. Сначала вернуть её, потом
      # восстановление заново
      say "Прошлый откат оборвался между переименованиями баз: возвращаю рабочую базу $kept на место"
      if ! psql_value postgres "ALTER DATABASE $kept RENAME TO averra" >/dev/null; then
        update_finish rollback-failed "$db_restored" 'база не восстановилась из бэкапа, рабочая база не на своём месте' "$kept"
        printf "Ошибка: откат не удался — базы averra нет, рабочая лежит под именем %s. Верните её: docker compose --project-directory %s exec postgres psql -U averra -d postgres -c 'ALTER DATABASE %s RENAME TO averra'. Пока базы averra нет, срок хранения бэкапов её не удалит. Бэкап: %s\n" "$kept" "$AVERRA_DIR" "$kept" "$BACKUP_DIR/$backup" >&2
        exit 2
      fi
    else
      # Оборвался после обоих переименований: база уже из бэкапа, прежняя — в kept
      db_restored=true
      run_set RESTORED 1
    fi
  fi
  after="$(count_migrations averra 2>/dev/null || true)"
  if [[ "$db_restored" != true ]] && [[ ! "$before" =~ ^[0-9]+$ || "$after" != "$before" ]]; then
    if [[ -z "$kept" ]]; then
      kept="${ROLLED_BACK_PREFIX}$(date -u +%Y%m%d_%H%M%S)"
      run_set KEPT "$kept"
    fi
    say "Миграции новой версии успели примениться ($before → ${after:-?}): восстанавливаю базу из $backup"
    restore_database "$BACKUP_DIR/$backup" "$kept" || code=$?
    if [[ $code -ne 0 ]]; then
      rm -rf "$AVERRA_DIR/.next"
      if [[ $code -eq 2 ]]; then
        update_finish rollback-failed "$db_restored" 'база не восстановилась из бэкапа, рабочая база не на своём месте' "$kept"
        printf 'Ошибка: откат не удался — рабочая база под именем %s, верните её (команда выше); пока базы averra нет, срок хранения бэкапов её не удалит. Бэкап: %s\n' "$kept" "$BACKUP_DIR/$backup" >&2
      else
        update_finish rollback-failed "$db_restored" 'база не восстановилась из бэкапа перед обновлением'
        printf 'Ошибка: откат не удался — база не восстановилась. Бэкап: %s. Восстановите руками: averra.sh restore %s\n' "$BACKUP_DIR/$backup" "$backup" >&2
      fi
      exit 2
    fi
    db_restored=true
    run_set RESTORED 1
    say "Данные, которые новая версия успела принять после бэкапа $backup (заявки, правки), — в базе $kept. Она удалится вместе со старыми бэкапами (BACKUP_KEEP дней); посмотреть: docker compose --project-directory $AVERRA_DIR exec postgres psql -U averra -d $kept"
  fi
  [[ "$db_restored" == true ]] || kept=''
  rm -rf "$AVERRA_DIR/.next"
  if compose up -d && wait_ready && services_running; then
    update_finish rolled-back "$db_restored" "версия $to не прошла проверку готовности" "$kept"
    printf 'Ошибка: обновление до %s не прошло проверку — работает прежняя версия %s. Лог новой версии: docker compose logs api caddy\n' "$to" "$from" >&2
    exit 1
  fi
  update_finish rollback-failed "$db_restored" 'прежняя версия тоже не прошла проверку готовности' "$kept"
  printf 'Ошибка: откат не удался — прежняя версия %s не отвечает. Бэкап перед обновлением: %s. Лог: docker compose --project-directory %s logs api\n' "$from" "$backup" "$AVERRA_DIR" >&2
  exit 2
}

# Прошлое обновление оборвалось (есть отметка, а процесса нет — замок наш): довести его до конца.
# Возврат — можно продолжать; откат выходит из процесса сам
recover_update() {
  local phase from to result
  phase="$(run_get PHASE)"
  from="$(run_get FROM)"
  to="$(run_get TO)"
  step "Прошлое обновление $from → $to не завершилось (шаг «$phase»): довожу его до конца"
  case "$phase" in
    prepare | backup)
      # .env и compose.yaml ещё прежние; API мог остаться остановленным на время бэкапа
      rm -rf "$AVERRA_DIR/.next"
      if compose up -d && wait_ready && services_running; then
        say "Работает прежняя версия $from, ничего не менялось"
        update_finish failed false 'обновление прервалось до запуска новой версии'
      else
        update_finish rollback-failed false 'обновление прервалось, и прежняя версия не поднялась'
        printf 'Ошибка: прежняя версия %s не отвечает. Лог: docker compose --project-directory %s logs api\n' "$from" "$AVERRA_DIR" >&2
        exit 2
      fi
      ;;
    switch)
      # В .env ещё прежняя версия — оборвалось до её смены (compose.yaml мог стать новым): то, что
      # поднимется, — не новая версия, и «проверка» её ничего не значит. Тогда откат
      if [[ "$(env_get AVERRA_VERSION)" == "$to" ]] && compose up -d && wait_ready && services_running; then
        say "Версия $to работает и проходит проверку — заканчиваю обновление"
        complete_update
      else
        rollback_update
      fi
      ;;
    rollback) rollback_update ;;
    finishing)
      result="$(run_get RESULT)"
      if resume_backup; then finish_backup || true; fi
      rm -f "$UPDATE_RUN"
      case "$result" in
        rolled-back) fail "прошлое обновление до $to откатилось на $from: повторите, когда причина будет устранена" ;;
        rollback-failed)
          printf 'Ошибка: у прошлого обновления до %s откат не удался — нужен человек (averra.sh status)\n' "$to" >&2
          exit 2
          ;;
      esac
      ;;
    *) fail "непонятная отметка $UPDATE_RUN (шаг «$phase»): разберитесь руками" ;;
  esac
}

# Само обновление (в процессе update-worker, под замком)
update_run() {
  local target="$1" current api_image next before
  [[ ! -f "$UPDATE_RUN" ]] || recover_update
  current="$(env_get AVERRA_VERSION)"
  [[ -n "$current" ]] || fail "в $ENV_FILE нет AVERRA_VERSION: это папка установки?"
  if [[ "$current" == "$target" ]]; then
    say "Уже версия $target"
    return 0
  fi
  (umask 077 && : >"$UPDATE_RUN")
  run_set FROM "$current"
  run_set TO "$target"
  run_set STARTED "$(now_iso)"
  run_set PHASE prepare
  update_state in-progress false ''
  api_image="$(env_get AVERRA_API_IMAGE)"
  [[ -n "$api_image" ]] || api_image='ghcr.io/midhey/averra-api'

  # 1. Образы новой версии — пока всё работает. Не скачались — ничего не менялось
  step "Скачиваю образы $target"
  if ! AVERRA_VERSION="$target" compose pull api caddy; then
    update_finish failed false 'образы новой версии не скачались'
    fail 'образы не скачались, ничего не менялось'
  fi

  # 2. Конфигурация установки той же версии: compose.yaml и этот скрипт лежат в образе API
  next="$AVERRA_DIR/.next"
  rm -rf "$next"
  (umask 077 && mkdir -p "$next")
  if ! docker run --rm --entrypoint cat "$api_image:$target" /app/deploy/compose.yaml >"$next/compose.yaml" ||
    ! docker run --rm --entrypoint cat "$api_image:$target" /app/deploy/averra.sh >"$next/averra.sh" ||
    [[ ! -s "$next/compose.yaml" || ! -s "$next/averra.sh" ]]; then
    rm -rf "$next"
    update_finish failed false 'в образе нет compose.yaml или averra.sh'
    fail 'не удалось взять compose.yaml и averra.sh из образа новой версии, ничего не менялось'
  fi

  # 3. API останавливается до бэкапа: с этой минуты заявки и правки не принимаются, и бэкап —
  # последнее состояние базы. Иначе всё, что прежний API принял между дампом и запуском новой
  # версии, пропало бы при откате с восстановлением базы. Бэкап с проверкой; внешняя копия —
  # после обновления, чтобы не держать сервис остановленным на время выгрузки
  run_set PHASE backup
  step 'Останавливаю API на время бэкапа: сайт открыт, админка и приём заявок — нет'
  if ! compose stop api; then
    rm -rf "$next"
    compose up -d api >/dev/null 2>&1 || true
    update_finish failed false 'API не остановился перед бэкапом'
    fail 'API не остановился перед бэкапом, ничего не менялось'
  fi
  if ! do_backup pre-update 1; then
    rm -rf "$next"
    compose up -d api || true
    wait_ready || true
    update_finish failed false 'бэкап перед обновлением не удался'
    fail 'бэкап перед обновлением не удался, ничего не менялось: прежняя версия снова запущена'
  fi
  run_set BACKUP "$BACKUP_NAME"
  run_set BACKUP_DONE "${BACKUP_DONE[*]}"
  before="$(count_migrations averra 2>/dev/null || true)"
  run_set BEFORE "$before"

  # 4. Новая версия: .env и compose.yaml (прежние — рядом), API применит миграции при старте.
  # Копия прежнего compose.yaml — до шага switch и с отметкой: откат с этого шага берёт только её
  cp -p "$AVERRA_DIR/compose.yaml" "$AVERRA_DIR/compose.yaml.prev"
  run_set PREV_SAVED 1
  run_set PHASE switch
  step "Запускаю $target"
  install -m 644 "$next/compose.yaml" "$AVERRA_DIR/compose.yaml"
  env_set AVERRA_PREVIOUS_VERSION "$current"
  env_set AVERRA_VERSION "$target"
  # 5. Готов — админка новой версии (Caddy) и остальное по новому compose.yaml. Проверяются
  # и API, и Caddy: Caddy с ошибкой в конфигурации положил бы сайт при «удачном» обновлении
  if compose up -d api && wait_ready && compose up -d && wait_ready && services_running; then
    complete_update
    return 0
  fi
  # 6. Не готов — откат
  rollback_update
}

# Процесс обновления, отвязанный от терминала: вывод — в update.log, итог — код в .update-exit
cmd_update_worker() {
  [[ $# -eq 2 && "$1" == --version && "$2" =~ $VERSION_RE ]] || fail 'update-worker --version <версия>'
  # Терминала у процесса нет, но и случайный HUP или закрытый канал его не остановят
  trap '' HUP PIPE
  take_lock
  # Номер и итог пишет только процесс, взявший замок: второй, одновременный, не затирает их
  printf '%s\n' "$$" >"$UPDATE_PID"
  trap 'update_exit $?' EXIT
  update_run "$2"
}

update_exit() {
  printf '%s\n' "$1" >"$UPDATE_EXIT.tmp" && mv -f "$UPDATE_EXIT.tmp" "$UPDATE_EXIT"
}

# Чем отвязать процесс: transient-служба systemd (вне сессии SSH: её не убьёт и закрытие сессии
# с KillUserProcesses) или setsid (новая сессия без терминала), где systemd нет
detach_mode() {
  if [[ -n "${AVERRA_DETACH:-}" ]]; then
    printf '%s' "$AVERRA_DETACH"
  elif [[ -d /run/systemd/system ]] && command -v systemd-run >/dev/null 2>&1; then
    printf 'systemd-run'
  else
    printf 'setsid'
  fi
}

# Лог дописывается, запуски разделены чертой: лог прошлого обновления (в том числе оборвавшегося)
# остаётся выше. Больше мегабайта — прежний уходит в update.log.1
LOG_MAX_BYTES=1048576

start_worker() {
  local size
  rm -f "$UPDATE_EXIT" "$UPDATE_PID"
  size="$({ wc -c <"$UPDATE_LOG"; } 2>/dev/null | tr -d ' ' || true)"
  if [[ "$size" =~ ^[0-9]+$ ]] && ((size > LOG_MAX_BYTES)); then
    mv -f "$UPDATE_LOG" "$UPDATE_LOG.1"
  fi
  (umask 077 && printf '\n==== %s update --version %s ====\n' "$(now_iso)" "$1" >>"$UPDATE_LOG")
  LOG_OFFSET="$(last_run_offset)"
  if [[ "$(detach_mode)" == systemd-run ]]; then
    # Окружение службы systemd — своё: HOME нужен docker (вход в реестр образов), PATH — командам
    systemd-run --quiet --collect --unit="averra-update-$(stamp)" \
      --setenv="AVERRA_READY_TIMEOUT=$READY_TIMEOUT" \
      --setenv="HOME=${HOME:-/root}" --setenv="PATH=$PATH" \
      --property=StandardInput=null \
      --property="StandardOutput=append:$UPDATE_LOG" \
      --property="StandardError=append:$UPDATE_LOG" \
      "$BASH" "$AVERRA_DIR/averra.sh" update-worker --version "$1" >/dev/null
  else
    setsid "$BASH" "$AVERRA_DIR/averra.sh" update-worker --version "$1" \
      </dev/null >>"$UPDATE_LOG" 2>&1 &
  fi
}

# Номер идущего процесса обновления; код 1 — не идёт
update_worker_pid() {
  local pid
  pid="$(cat "$UPDATE_PID" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ && ! -f "$UPDATE_EXIT" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  # Номер мог достаться другому процессу: это должен быть наш update-worker
  tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q 'update-worker' || return 1
  printf '%s' "$pid"
}

LOG_OFFSET=0
# Где в логе начинается последний запуск (черта start_worker): показывается только он
last_run_offset() {
  local offset
  offset="$(grep -ab '^==== ' "$UPDATE_LOG" 2>/dev/null | tail -n 1 | cut -d: -f1 || true)"
  [[ "$offset" =~ ^[0-9]+$ ]] || offset=0
  printf '%s' "$offset"
}

print_new_log() {
  local size
  size="$({ wc -c <"$UPDATE_LOG"; } 2>/dev/null | tr -d ' ' || true)"
  [[ "$size" =~ ^[0-9]+$ ]] && ((size > LOG_OFFSET)) || return 0
  tail -c +$((LOG_OFFSET + 1)) "$UPDATE_LOG" | head -c $((size - LOG_OFFSET)) || true
  LOG_OFFSET=$size
}

# Показывать лог процесса обновления, пока он не кончится; код — его код. Оборвался без итога — 3
follow_update() {
  local pid code since=$SECONDS
  while :; do
    print_new_log
    if [[ -f "$UPDATE_EXIT" ]]; then
      print_new_log
      code="$(cat "$UPDATE_EXIT" 2>/dev/null || true)"
      [[ "$code" =~ ^[0-9]+$ ]] || code=1
      return "$code"
    fi
    pid="$(cat "$UPDATE_PID" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      if ! kill -0 "$pid" 2>/dev/null && [[ ! -f "$UPDATE_EXIT" ]]; then
        print_new_log
        printf 'Ошибка: процесс обновления оборвался, не дойдя до конца. Повторите ту же команду: averra.sh update сначала доведёт прерванное (закончит или откатит). Лог: %s\n' "$UPDATE_LOG" >&2
        return 3
      fi
    elif ((SECONDS - since > 60)); then
      printf 'Ошибка: процесс обновления не запустился. Лог: %s\n' "$UPDATE_LOG" >&2
      return 3
    fi
    sleep 1
  done
}

cmd_update() {
  local target='' yes=0 current answer running code=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        [[ $# -ge 2 ]] || fail 'у --version нет значения'
        target="$2"
        shift 2
        ;;
      --yes | -y) yes=1; shift ;;
      *) fail "непонятный аргумент: $1" ;;
    esac
  done
  [[ "$target" =~ $VERSION_RE ]] || fail 'нужна версия: averra.sh update --version 0.2.0'
  current="$(env_get AVERRA_VERSION)"
  [[ -n "$current" ]] || fail "в $ENV_FILE нет AVERRA_VERSION: это папка установки?"
  # Обновление уже идёт (например, его запустила оборвавшаяся SSH-сессия): показать его ход
  if update_worker_pid >/dev/null; then
    running="$(run_get TO)"
    [[ "$running" == "$target" ]] ||
      fail "уже идёт обновление до ${running:-другой версии}: дождитесь его (лог — $UPDATE_LOG)"
    say "Обновление до $target уже идёт — показываю его ход"
    LOG_OFFSET="$(last_run_offset)"
    follow_update || code=$?
    exit "$code"
  fi
  if [[ "$current" == "$target" && ! -f "$UPDATE_RUN" ]]; then
    say "Уже версия $target"
    return 0
  fi
  if [[ $yes -eq 0 && -t 0 ]]; then
    read -r -p "Обновить $current → $target? Админка и приём заявок будут недоступны около минуты. [да/нет] " answer
    [[ "$answer" == 'да' ]] || fail 'отменено'
  fi
  # Замок занят (идёт бэкап или восстановление) — отказ сразу: процесс обновления не запускается,
  # отметки и лог прошлого обновления не трогаются. Замок берёт сам процесс: отпускаем его, и
  # дескриптор с замком процессу не достаётся
  exec 9>"$LOCK_FILE"
  flock -n 9 || fail 'уже идёт бэкап, восстановление или обновление (замок .averra.lock). Подождите и повторите'
  exec 9>&-
  say "Обновление идёт в фоне на сервере: обрыв SSH или Ctrl+C его не прервут. Лог — $UPDATE_LOG"
  start_worker "$target" || fail 'не удалось запустить процесс обновления'
  follow_update || code=$?
  exit "$code"
}

# ── Состояние ──────────────────────────────────────────────────────────────────────────────

# Что с обновлением, если API не отвечает: идёт (API остановлен на время бэкапа и запуска новой
# версии — это нормально), оборвалось или нет
update_note() {
  if update_worker_pid >/dev/null; then
    printf 'running'
  elif [[ -f "$UPDATE_RUN" ]]; then
    printf 'interrupted'
  else
    printf 'none'
  fi
}

cmd_status() {
  local json=0 last update note
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json) json=1; shift ;;
      *) fail "непонятный аргумент: $1" ;;
    esac
  done
  local args=()
  [[ $json -eq 0 ]] || args=(--json)
  # Состояние собирает сам API (та же функция, что у владельца в админке): база, почта, сборки
  if compose exec -T api node dist/server/status.js "${args[@]}" 2>/dev/null; then return 0; fi
  # API лежит: говорим об этом и показываем то, что знаем без него
  last="$(cat "$STATE_DIR/backup-last.json" 2>/dev/null || true)"
  update="$(cat "$STATE_DIR/update-last.json" 2>/dev/null || true)"
  note="$(update_note)"
  if [[ $json -eq 1 ]]; then
    printf '{"apiDown":true,"configuredVersion":%s,"backupLast":%s,"updateLast":%s,"update":%s}\n' \
      "$(json_or_null "$(env_get AVERRA_VERSION)")" "${last:-null}" "${update:-null}" "$(json_str "$note")"
  else
    say "API не отвечает. Версия в .env: $(env_get AVERRA_VERSION)"
    case "$note" in
      running) say "Идёт обновление до $(run_get TO): API остановлен на его время. Лог — $UPDATE_LOG" ;;
      interrupted) say "Обновление до $(run_get TO) оборвалось на полпути: повторите averra.sh update --version $(run_get TO) — он доведёт или откатит прерванное" ;;
    esac
    say "Последний бэкап: ${last:-нет}"
    say "Лог: docker compose --project-directory $AVERRA_DIR logs api"
  fi
  return 1
}

# ── Команды ────────────────────────────────────────────────────────────────────────────────

[[ $# -ge 1 ]] || { usage; exit 1; }
command="$1"
shift
case "$command" in
  backup) cmd_backup "$@" ;;
  backups) cmd_backups "$@" ;;
  verify) cmd_verify "$@" ;;
  restore) cmd_restore "$@" ;;
  update) cmd_update "$@" ;;
  # Служебная: процесс обновления, который запускает update (см. start_worker)
  update-worker) cmd_update_worker "$@" ;;
  status) cmd_status "$@" ;;
  help | -h | --help) usage ;;
  *) fail "непонятная команда: $command. Справка: averra.sh help" ;;
esac
