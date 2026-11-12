#!/usr/bin/env bash
# Подделка docker для tests/averra.test.ts: маленький «сервер» в папке FAKE_STATE. Базы — файлы
# db-<имя> с числом применённых миграций, running — запущенная версия API (stopped — остановлен),
# data/ — тома media и sites: tar и sh из «контейнера» API выполняются по-настоящему над ними
# (/data → FAKE_STATE/data). Запуск API «собирает» сайт: в builds.log — какие картинки были в
# медиатеке в эту минуту. Каждый вызов пишется в calls.log. Поведение задают переменные FAKE_*
# (см. Fakes в тесте).
# Внешняя база (AVERRA_DB_MODE=external): db-ext — её число миграций; клиент PostgreSQL — docker run
# образа postgres с переменными libpq (их значения — в pg-env.log, не в calls.log); временный
# контейнер проверки — файл container-<имя> с числом миграций восстановленного дампа и его анонимный
# том данных (VOLUME образа postgres) — файл volume-<имя>: docker rm -f удаляет только контейнер,
# том — лишь rm -fv
S="$FAKE_STATE"
args="$*"
printf 'docker %s\n' "$args" >> "$S/calls.log"
project=''
if [[ "$1" == compose && "$2" == --project-directory ]]; then project="$3"; fi
version() {
  if [[ -n "${AVERRA_VERSION:-}" ]]; then printf '%s' "$AVERRA_VERSION"; return; fi
  grep -E '^AVERRA_VERSION=' "$project/.env" | tail -n 1 | cut -d= -f2
}
db() { printf '%s/db-%s' "$S" "$1"; }
# Обрыв процесса обновления (kill -9 — как перезагрузка: ни trap, ни итога) и обрыв самого
# averra.sh (восстановление идёт не процессом обновления: kill -9 всех предков, которые выполняют
# averra.sh, — и подоболочки, и главного процесса)
kill_worker() {
  # Без --project-directory (docker run клиента базы) — папка установки рядом с папкой подделки
  kill -9 "$(cat "${project:-$S/../averra}/.update-pid")" 2>/dev/null
}
kill_self() {
  parent_of() {
    if [[ -r "/proc/$1/ppid" ]]; then cat "/proc/$1/ppid"; else awk '/^PPid:/ {print $2}' "/proc/$1/status"; fi
  }
  local victims=() pid=$PPID
  while [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] && tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q 'averra\.sh'; do
    victims+=("$pid")
    pid="$(parent_of "$pid")"
  done
  kill -9 "${victims[@]}" 2>/dev/null
}
# FAKE_KILL_ON / FAKE_KILL_SELF_ON: на первом вызове под это регулярное выражение bash обрыв до
# вызова — сам вызов не выполняется (транзакция не дошла до COMMIT)
if [[ -n "${FAKE_KILL_ON:-}" && "$args" =~ $FAKE_KILL_ON && ! -e "$S/killed" ]]; then
  : > "$S/killed"
  kill_worker
  exit 1
fi
if [[ -n "${FAKE_KILL_SELF_ON:-}" && "$args" =~ $FAKE_KILL_SELF_ON && ! -e "$S/killed" ]]; then
  : > "$S/killed"
  kill_self
  exit 1
fi
# FAKE_KILL_AFTER_ON / FAKE_KILL_SELF_AFTER_ON: вызов выполняется целиком (транзакция зафиксирована),
# обрыв — сразу после него
if [[ -n "${FAKE_KILL_AFTER_ON:-}" && "$args" =~ $FAKE_KILL_AFTER_ON && ! -e "$S/killed" ]]; then
  : > "$S/killed"
  trap kill_worker EXIT
fi
if [[ -n "${FAKE_KILL_SELF_AFTER_ON:-}" && "$args" =~ $FAKE_KILL_SELF_AFTER_ON && ! -e "$S/killed" ]]; then
  : > "$S/killed"
  trap kill_self EXIT
fi
opt() { # значение после флага: opt -d
  local flag="$1"; shift
  while [[ $# -gt 0 ]]; do [[ "$1" == "$flag" ]] && { printf '%s' "$2"; return; }; shift; done
}
case "$args" in
  "run --rm -i --cap-drop ALL --security-opt no-new-privileges:true -v "*":/run/averra-db:ro "*)
    # Клиент внешней базы: что он получил переменными окружения (пароль — только здесь)
    printf 'host=%s port=%s user=%s password=%s db=%s sslmode=%s rootcert=%s\n' "${PGHOST:-}" \
      "${PGPORT:-}" "${PGUSER:-}" "${PGPASSWORD:-}" "${PGDATABASE:-}" "${PGSSLMODE:-}" \
      "${PGSSLROOTCERT:-}" >> "$S/pg-env.log"
    if [[ -n "${FAKE_EXT_DOWN:-}" ]]; then
      echo 'psql: error: connection to server failed: Connection timed out' >&2
      exit 2
    fi
    case "$args" in
      *" pg_dump -Fc"*)
        [[ -z "${FAKE_DUMP_FAILS:-}" ]] || exit 1
        # umask процесса, в чей stdout пишется дамп: файл дампа создан с ним (на Windows права
        # файла не видны — видно, с какой маской его создавали)
        umask >> "$S/dump-umask.log"
        printf 'DUMP %s\n' "$(cat "$(db ext)")" ;;
      *"--single-transaction"*)
        dump="$(cat)"
        if [[ -n "${FAKE_LOAD_FAILS:-}" ]]; then
          echo 'pg_restore: connecting to database' >&2
          echo 'psql:/tmp/averra.sql:42: ERROR:  permission denied to create extension "pg_trgm"' >&2
          echo 'CONTEXT:  COPY leads, line 1: "Иван ivan@example.test"' >&2
          exit 3
        fi
        printf '%s\n' "${dump#DUMP }" > "$(db ext)" ;;
      *" psql "*)
        query="${*: -1}"
        case "$query" in
          *drizzle*) cat "$(db ext)" ;;
          'select 1') echo 1 ;;
          *server_version_num*) echo "${FAKE_EXT_SERVER_VERSION:-180006}" ;;
          *) echo 12 ;;
        esac ;;
    esac
    exit 0 ;;
  "run -d --rm --name averra-verify-"*)
    name="$(opt --name "$@")"
    : > "$S/container-$name"
    : > "$S/volume-$name"
    echo "id-$name" ;;
  "ps -aq --filter label=averra.verify=1")
    for file in "$S"/container-*; do [[ -e "$file" ]] && printf '%s\n' "${file##*/container-}"; done
    exit 0 ;;
  "rm -f "* | "rm -fv "*)
    volumes="$2"
    shift 2
    for name in "$@"; do
      rm -f "$S/container-$name"
      [[ "$volumes" != -fv ]] || rm -f "$S/volume-$name"
    done ;;
  "exec "*"averra-verify-"*)
    name="$(awk '{for (i = 1; i <= NF; i++) if ($i ~ /^averra-verify-/) print $i}' <<<"$args")"
    [[ -f "$S/container-$name" ]] || exit 1
    case "$args" in
      *pg_isready*) exit 0 ;;
      *pg_restore*)
        dump="$(cat)"
        [[ "${FAKE_RESTORE_FAILS_INTO:-}" != verify-container ]] || exit 1
        printf '%s\n' "${dump#DUMP }" > "$S/container-$name" ;;
      *drizzle*) cat "$S/container-$name" ;;
      *) echo 12 ;;
    esac ;;
  *"compose version"*|"info") exit 0 ;;
  *" pull "*) [[ -z "${FAKE_PULL_FAILS:-}" ]] || exit 1; exit 0 ;;
  *"exec -T postgres pg_dump"*)
    [[ -z "${FAKE_DUMP_FAILS:-}" ]] || exit 1
    printf 'DUMP %s\n' "$(cat "$(db averra)")" ;;
  *"exec -T postgres createdb"*) : > "$(db "${@: -1}")" ;;
  *"exec -T postgres dropdb"*) rm -f "$(db "${@: -1}")" ;;
  *"exec -T postgres pg_restore"*)
    target="$(opt -d "$@")"
    dump="$(cat)"
    [[ "${FAKE_RESTORE_FAILS_INTO:-}" != "$target" ]] || exit 1
    [[ -f "$(db "$target")" ]] || exit 1
    printf '%s' "${dump#DUMP }" > "$(db "$target")" ;;
  *"exec -T postgres psql"*)
    name="$(opt -d "$@")"
    query="${@: -1}"
    if [[ "$query" == *"from pg_database where datname = '"* ]]; then
      wanted="$(sed -E "s/.*datname = '([a-z0-9_]+)'.*/\1/" <<<"$query")"
      if [[ -f "$(db "$wanted")" ]]; then echo 1; else echo 0; fi
      exit 0
    fi
    if [[ "$query" == *"from pg_database where datname ~"* ]]; then
      for file in "$S"/db-averra_*; do
        [[ -e "$file" ]] && printf '%s\n' "${file##*/db-}"
      done
      exit 0
    fi
    if [[ "$query" == *"RENAME TO"* ]]; then
      from="$(sed -E 's/ALTER DATABASE ([a-z0-9_]+) RENAME TO ([a-z0-9_]+)/\1/' <<<"$query")"
      to="$(sed -E 's/ALTER DATABASE ([a-z0-9_]+) RENAME TO ([a-z0-9_]+)/\2/' <<<"$query")"
      [[ -f "$(db "$from")" && ! -f "$(db "$to")" ]] || exit 1
      [[ " ${FAKE_RENAME_FAILS_FROM:-} " != *" $from "* ]] || exit 1
      mv "$(db "$from")" "$(db "$to")"
      exit 0
    fi
    [[ -s "$(db "$name")" ]] || exit 1
    if [[ "$query" == *drizzle* ]]; then cat "$(db "$name")"; else echo 12; fi ;;
  *" run --rm --no-deps -T --entrypoint tar api "*)
    if [[ -n "${FAKE_BAD_MEDIA:-}" ]]; then echo 'не архив'; exit 0; fi
    # Аргументы tar — после имени сервиса; /data — папка томов подделки, шаблоны --exclude как есть
    set -f
    targs=()
    seen=''
    for arg in "$@"; do
      [[ -z "$seen" ]] || targs+=("${arg/#\/data/$S/data}")
      [[ "$arg" != api ]] || seen=1
    done
    set +f
    tar "${targs[@]}" ;;
  *" ps --status running --services"*)
    echo postgres
    running="$(cat "$S/running" 2>/dev/null)"
    [[ -z "$running" || "$running" == stopped ]] || echo api
    [[ " ${FAKE_CADDY_DOWN:-} " == *" $(version) "* ]] || echo caddy ;;
  *"exec -T api node dist/server/status.js"*)
    [[ "$(cat "$S/running" 2>/dev/null)" != stopped ]] || exit 1
    echo '{"version":"from-api"}' ;;
  *"exec -T api node -e"*)
    running="$(cat "$S/running" 2>/dev/null)"
    [[ -n "$running" && "$running" != stopped && " ${FAKE_UNHEALTHY:-} " != *" $running "* ]] ;;
  *" stop api"*) echo stopped > "$S/running" ;;
  *" up -d"*)
    v="$(version)"
    echo "$v" > "$S/running"
    printf 'compose.yaml=%s\n' "$(head -n 1 "$project/compose.yaml")" >> "$S/calls.log"
    # API при старте собирает опубликованные сайты из медиатеки — какая она в эту минуту
    printf 'build %s: %s\n' "$v" "$(cd "$S/data/media" && find . -path './.averra-*' -prune -o -type f -printf '%P\n' | sort | tr '\n' ' ')" >> "$S/builds.log"
    # Миграция применяется один раз на базу, как у настоящего мигратора
    working=averra
    [[ ! -f "$(db ext)" ]] || working=ext
    if [[ "$v" == "${FAKE_MIGRATES_ON:-}" && -f "$(db $working)" && "$(cat "$(db $working)")" == 15 ]]; then
      echo $(( $(cat "$(db $working)") + 1 )) > "$(db $working)"
    fi ;;
  *" run --rm --no-deps -T --entrypoint sh api -c "*)
    # Скрипт — последним аргументом, над папками томов подделки. FAKE_SH_FAILS_ON: скрипт с этой
    # подстрокой выполняется, но кончается сбоем (как упавший последний шаг)
    script="${*: -1}"
    bash -c "${script//\/data\//$S/data/}" || exit $?
    [[ -z "${FAKE_SH_FAILS_ON:-}" || "$script" != *"$FAKE_SH_FAILS_ON"* ]] || exit 1 ;;
  *" run --rm --no-deps"*) cat > /dev/null ;;
  *"--entrypoint cat"*)
    [[ -z "${FAKE_NO_DEPLOY_FILES:-}" ]] || exit 0
    image="$(awk '{for (i = 1; i <= NF; i++) if ($i ~ /averra-api:/) print $i}' <<<"$args")"
    case "$args" in
      *compose.external.yaml) echo "# compose external $image" ;;
      *compose.yaml) echo "# compose $image" ;;
      # averra.sh новой версии: запоминает, с какими командами его позвали (передача управления),
      # сколько раз к этой минуте поднимали сервисы и из какой папки его запустили
      *averra.sh)
        printf '#!/usr/bin/env bash\n# averra.sh %s\n' "$image"
        cat <<'NEXT'
printf '%s (up -d: %s, папка: %s)\n' "$*" "$(grep -c 'up -d' "$FAKE_STATE/calls.log" 2>/dev/null)" \
  "$(basename "$(dirname "$0")")" >> "$FAKE_STATE/next-averra.log"
NEXT
        ;;
    esac ;;
  "manifest inspect "*)
    # Образ версии в реестре; FAKE_NO_MANIFEST — образов этой версии там ещё нет
    [[ -z "${FAKE_NO_MANIFEST:-}" || "$args" != *":$FAKE_NO_MANIFEST" ]] || exit 1 ;;
  *"release-info.js"*)
    # Разбор ответа источника релизов в образе API: что пришло на stdin — в файл, ответ — из
    # FAKE_RELEASE_OUT (по умолчанию — релиз 0.7.0)
    cat > "$S/release-body"
    [[ -z "${FAKE_RELEASE_FAILS:-}" ]] || exit "$FAKE_RELEASE_FAILS"
    release='{"version":"0.7.0","publishedAt":"2026-10-20T10:00:00Z","notes":"Новое"}'
    printf '%s\n' "${FAKE_RELEASE_OUT:-$release}" ;;
  *"rclone/rclone"*" obscure -"*)
    read -r secret
    printf 'secret-on-stdin=%s\n' "$([[ -n "$secret" ]] && echo yes)" >> "$S/calls.log"
    echo OBSCURED ;;
  *"rclone/rclone"*)
    printf 'rclone-env key=%s secret=%s password=%s\n' "${RCLONE_CONFIG_AVERRAS3_ACCESS_KEY_ID:-}" \
      "${RCLONE_CONFIG_AVERRAS3_SECRET_ACCESS_KEY:+set}" "${RCLONE_CONFIG_AVERRA_PASSWORD:-}" >> "$S/calls.log"
    case "$args" in
      *" copy /backup "*)
        [[ -z "${FAKE_RCLONE_FAILS:-}" ]] || exit 1
        # Выгруженное «появляется» в хранилище: его увидит следующий lsf
        printf '%s/\n' "${args##*averra:}" >> "$S/remote.list" ;;
      *" copy averra:"*" /restore"*)
        # Скачивание: из «хранилища» $S/remote/<имя> в папку, смонтированную как /restore
        [[ -z "${FAKE_RCLONE_FAILS:-}" ]] || exit 1
        name="$(sed -E 's/.* copy averra:([^ ]+) \/restore.*/\1/' <<<"$args")"
        host="$(sed -E 's/.*-v (.+):\/restore .*/\1/' <<<"$args")"
        [[ -d "$S/remote/$name" ]] || exit 1
        cp -R "$S/remote/$name/." "$host/" ;;
      *" lsf "*)
        [[ -z "${FAKE_LSF_FAILS:-}" ]] || exit 1
        printf '%s\n' ${FAKE_REMOTE:-}
        cat "$S/remote.list" 2>/dev/null || true ;;
      *" purge "*)
        [[ -z "${FAKE_PURGE_FAILS:-}" ]] || exit 1 ;;
    esac ;;
  *) exit 0 ;;
esac
