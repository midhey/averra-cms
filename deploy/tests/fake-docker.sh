#!/usr/bin/env bash
# Подделка docker для tests/averra.test.ts: маленький «сервер» в папке FAKE_STATE. Базы — файлы
# db-<имя> с числом применённых миграций, running — запущенная версия API (stopped — остановлен),
# data/ — тома media и sites: tar и sh из «контейнера» API выполняются по-настоящему над ними
# (/data → FAKE_STATE/data). Запуск API «собирает» сайт: в builds.log — какие картинки были в
# медиатеке в эту минуту. Каждый вызов пишется в calls.log. Поведение задают переменные FAKE_*
# (см. Fakes в тесте)
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
# Обрыв процесса обновления: на первом вызове, подходящем под это регулярное выражение bash,
# процесс update-worker убивается (kill -9 — как перезагрузка: ни trap, ни итога), а сам вызов
# не выполняется
if [[ -n "${FAKE_KILL_ON:-}" && "$args" =~ $FAKE_KILL_ON && ! -e "$S/killed" ]]; then
  : > "$S/killed"
  kill -9 "$(cat "$project/.update-pid")" 2>/dev/null
  exit 1
fi
opt() { # значение после флага: opt -d
  local flag="$1"; shift
  while [[ $# -gt 0 ]]; do [[ "$1" == "$flag" ]] && { printf '%s' "$2"; return; }; shift; done
}
case "$args" in
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
    if [[ "$v" == "${FAKE_MIGRATES_ON:-}" && -f "$(db averra)" && "$(cat "$(db averra)")" == 15 ]]; then
      echo $(( $(cat "$(db averra)") + 1 )) > "$(db averra)"
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
      *compose.yaml) echo "# compose $image" ;;
      *averra.sh) printf '#!/usr/bin/env bash\n# averra.sh %s\n' "$image" ;;
    esac ;;
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
