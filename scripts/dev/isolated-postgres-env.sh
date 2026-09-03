#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_ROOT="$ROOT/.mypet-env"
MIGRATIONS="$ROOT/backend/src/main/resources/db/migration"

: "${POSTGIS_IMAGE:=postgis/postgis:17-3.5}"
: "${FLYWAY_IMAGE:=flyway/flyway:11.3.4}"

usage() {
  echo "Usage: $0 <create|migrate|boot|status|certify|stop|destroy> <env_name>" >&2
  exit 2
}

command_name="${1:-}"
env_name="${2:-}"
[[ -n "$command_name" && -n "$env_name" ]] || usage
[[ "$env_name" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || {
  echo "Environment name must match ^[a-z0-9][a-z0-9-]{0,30}$." >&2
  exit 2
}

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required." >&2
  exit 2
}
command -v openssl >/dev/null 2>&1 || {
  echo "openssl is required." >&2
  exit 2
}

safe_name="${env_name//-/_}"
container="mypet-${env_name}-postgres"
network="mypet-${env_name}-net"
db_name="mypet_${safe_name}"
state_dir="$STATE_ROOT/$env_name"
state_file="$state_dir/environment.env"
pid_file="$state_dir/backend.pid"
log_file="$state_dir/backend.log"

checksum="$(printf '%s' "$env_name" | cksum | awk '{print $1}')"
db_port="$((15432 + checksum % 500))"
backend_port="$((18080 + checksum % 500))"

platform_args=()
case "$(uname -m 2>/dev/null || true)" in
  arm64|aarch64) platform_args=(--platform linux/amd64) ;;
esac

validate_state_path_safety() {
  if [[ -L "$state_dir" ]]; then
    echo "State directory '$state_dir' is a symlink; refusing operation for safety." >&2
    exit 2
  fi
  if [[ -e "$state_file" && -L "$state_file" ]]; then
    echo "State file '$state_file' is a symlink; refusing operation for safety." >&2
    exit 2
  fi
  if [[ -e "$state_dir/environment.sh" && -L "$state_dir/environment.sh" ]]; then
    echo "State file '$state_dir/environment.sh' is a symlink; refusing operation for safety." >&2
    exit 2
  fi
  if [[ -e "$pid_file" && -L "$pid_file" ]]; then
    echo "PID file '$pid_file' is a symlink; refusing operation for safety." >&2
    exit 2
  fi
  if [[ -e "$log_file" && -L "$log_file" ]]; then
    echo "Log file '$log_file' is a symlink; refusing operation for safety." >&2
    exit 2
  fi
}

load_state() {
  validate_state_path_safety
  if [[ ! -f "$state_file" && -f "$state_dir/environment.sh" ]]; then
    state_file="$state_dir/environment.sh"
  fi
  [[ -f "$state_file" ]] || {
    echo "Isolated environment '$env_name' does not exist. Run create first." >&2
    exit 2
  }
  local file_uid
  if stat -c '%u' "$state_file" >/dev/null 2>&1; then
    file_uid="$(stat -c '%u' "$state_file")"
  else
    file_uid="$(stat -f '%u' "$state_file" 2>/dev/null || true)"
  fi
  if [[ -n "$file_uid" && "$file_uid" != "$(id -u)" ]]; then
    echo "State file '$state_file' is owned by UID $file_uid, expected current UID $(id -u)." >&2
    exit 2
  fi
  local mode
  if stat -c '%a' "$state_file" >/dev/null 2>&1; then
    mode="$(stat -c '%a' "$state_file")"
  else
    mode="$(stat -f '%Lp' "$state_file" 2>/dev/null || true)"
  fi
  if [[ -n "$mode" && "$mode" =~ [2367]$|[2367][0-9]$ ]]; then
    echo "State file '$state_file' has unsafe permissions '$mode'; must not be group/world writable." >&2
    exit 2
  fi

  local seen_keys=" "
  local line_no=0

  PARSED_DB_PASSWORD=""
  PARSED_TOKEN_SECRET=""
  PARSED_SYNC_CURSOR_SECRET=""
  PARSED_DEVICE_TOKEN_KEY=""
  PARSED_SERVICE_ROLE_KEY=""
  PARSED_DB_PORT=""
  PARSED_BACKEND_PORT=""
  PARSED_DB_NAME=""
  PARSED_CONTAINER=""
  PARSED_NETWORK=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    line_no=$((line_no + 1))
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]] || "$line" =~ [[:space:]]$ ]]; then
      echo "State file '$state_file' line $line_no contains forbidden whitespace: '$line'." >&2
      exit 2
    fi

    if [[ ! "$line" =~ ^([A-Z0-9_]+)=(.*)$ ]]; then
      echo "State file '$state_file' line $line_no is not a valid KEY=VALUE pair: '$line'." >&2
      exit 2
    fi

    local key="${BASH_REMATCH[1]}"
    local val="${BASH_REMATCH[2]}"

    if [[ "$seen_keys" == *" $key "* ]]; then
      echo "State file '$state_file' contains duplicate key: '$key'." >&2
      exit 2
    fi
    seen_keys="${seen_keys}${key} "

    # Value character allowlist: strictly letters, digits, and safe delimiters: _ . / @ : = + -
    if [[ ! "$val" =~ ^[a-zA-Z0-9_./@:=+-]*$ ]]; then
      echo "State file '$state_file' key '$key' contains invalid characters in value: '$val'." >&2
      exit 2
    fi

    case "$key" in
      DB_PASSWORD)        PARSED_DB_PASSWORD="$val" ;;
      TOKEN_SECRET)       PARSED_TOKEN_SECRET="$val" ;;
      SYNC_CURSOR_SECRET) PARSED_SYNC_CURSOR_SECRET="$val" ;;
      DEVICE_TOKEN_KEY)   PARSED_DEVICE_TOKEN_KEY="$val" ;;
      SERVICE_ROLE_KEY)   PARSED_SERVICE_ROLE_KEY="$val" ;;
      DB_PORT)            PARSED_DB_PORT="$val" ;;
      BACKEND_PORT)       PARSED_BACKEND_PORT="$val" ;;
      DB_NAME)            PARSED_DB_NAME="$val" ;;
      CONTAINER)          PARSED_CONTAINER="$val" ;;
      NETWORK)            PARSED_NETWORK="$val" ;;
      BACKEND_PID|BACKEND_PROCESS_TOKEN|BACKEND_START_TIME) ;;
      *)
        echo "State file '$state_file' contains unknown key: '$key'." >&2
        exit 2
        ;;
    esac
  done <"$state_file"

  for required in DB_PASSWORD TOKEN_SECRET SYNC_CURSOR_SECRET DEVICE_TOKEN_KEY DB_PORT BACKEND_PORT DB_NAME CONTAINER NETWORK; do
    if [[ "$seen_keys" != *" $required "* ]]; then
      echo "State file '$state_file' is missing required key: '$required'." >&2
      exit 2
    fi
  done

  DB_PASSWORD="$PARSED_DB_PASSWORD"
  TOKEN_SECRET="$PARSED_TOKEN_SECRET"
  SYNC_CURSOR_SECRET="$PARSED_SYNC_CURSOR_SECRET"
  DEVICE_TOKEN_KEY="$PARSED_DEVICE_TOKEN_KEY"
  SERVICE_ROLE_KEY="$PARSED_SERVICE_ROLE_KEY"
  DB_PORT="$PARSED_DB_PORT"
  BACKEND_PORT="$PARSED_BACKEND_PORT"
  DB_NAME="$PARSED_DB_NAME"
  CONTAINER="$PARSED_CONTAINER"
  NETWORK="$PARSED_NETWORK"
}

write_state() {
  validate_state_path_safety
  umask 077
  mkdir -p "$state_dir"
  chmod 700 "$state_dir"
  {
    echo "DB_PASSWORD=$DB_PASSWORD"
    echo "TOKEN_SECRET=$TOKEN_SECRET"
    echo "SYNC_CURSOR_SECRET=$SYNC_CURSOR_SECRET"
    echo "DEVICE_TOKEN_KEY=$DEVICE_TOKEN_KEY"
    echo "SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY"
    echo "DB_PORT=$db_port"
    echo "BACKEND_PORT=$backend_port"
    echo "DB_NAME=$db_name"
    echo "CONTAINER=$container"
    echo "NETWORK=$network"
  } >"$state_file"
  chmod 600 "$state_file"
}

wait_for_postgres() {
  for _ in $(seq 1 60); do
    local status
    status="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo "missing")"
    if [[ "$status" == "exited" || "$status" == "dead" ]]; then
      echo "PostgreSQL container '$container' unexpectedly stopped (status: $status)." >&2
      docker logs --tail 60 "$container" >&2 || true
      return 1
    fi

    if docker logs "$container" 2>&1 | grep -q "PostgreSQL init process complete; ready for start up"; then
      if [[ "$status" == "running" ]] && \
         docker exec "$container" pg_isready -h 127.0.0.1 -U mypet -d "$db_name" >/dev/null 2>&1 && \
         docker exec "$container" psql -h 127.0.0.1 -U mypet -d "$db_name" -X -A -t -c "SELECT 1;" >/dev/null 2>&1; then
        return 0
      fi
    elif docker logs "$container" 2>&1 | grep -q "database system is ready to accept connections" && \
         ! docker logs "$container" 2>&1 | grep -q "running bootstrap script"; then
      if [[ "$status" == "running" ]] && \
         docker exec "$container" pg_isready -h 127.0.0.1 -U mypet -d "$db_name" >/dev/null 2>&1 && \
         docker exec "$container" psql -h 127.0.0.1 -U mypet -d "$db_name" -X -A -t -c "SELECT 1;" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "PostgreSQL did not become ready for '$env_name'." >&2
  docker logs --tail 60 "$container" >&2 || true
  return 1
}

ensure_supabase_postgis_layout() {
  PGHOST=127.0.0.1 PGPORT="$db_port" PGUSER=mypet PGPASSWORD="$DB_PASSWORD" PGDATABASE="$db_name" \
    bash "$ROOT/scripts/postgres/prepare-supabase-postgis.sh" --container "$container"
}

is_mypet_backend_process() {
  local check_pid="$1"
  if [[ ! "$check_pid" =~ ^[0-9]+$ ]] || ! kill -0 "$check_pid" 2>/dev/null; then
    return 1
  fi

  local exp_token="" exp_lstart="" exp_cwd=""
  if [[ -f "$pid_file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
        PROCESS_TOKEN=*) exp_token="${line#PROCESS_TOKEN=}" ;;
        START_TIME=*)    exp_lstart="${line#START_TIME=}" ;;
        EXPECTED_CWD=*)  exp_cwd="${line#EXPECTED_CWD=}" ;;
      esac
    done <"$pid_file"
  fi

  if [[ -n "$exp_lstart" ]]; then
    local cur_lstart
    cur_lstart="$(ps -p "$check_pid" -o lstart= 2>/dev/null | tr -s ' ' | sed -e 's/^[ ]*//' -e 's/[ ]*$//' || true)"
    if [[ "$cur_lstart" != "$exp_lstart" ]]; then
      return 1
    fi
  fi

  local cmd
  cmd="$(ps -p "$check_pid" -o args= 2>/dev/null || ps -p "$check_pid" -o command= 2>/dev/null || true)"
  if [[ -n "$exp_token" ]]; then
    if [[ "$cmd" != *"mypet.process.token=$exp_token"* && "$cmd" != *"$exp_token"* ]]; then
      return 1
    fi
  else
    if [[ ! "$cmd" =~ :backend:bootRun && ! "$cmd" =~ in\.mypetnew ]]; then
      return 1
    fi
  fi

  local proc_cwd=""
  if command -v lsof >/dev/null 2>&1; then
    proc_cwd="$(lsof -p "$check_pid" -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
  elif [[ -d "/proc/$check_pid" ]]; then
    proc_cwd="$(readlink "/proc/$check_pid/cwd" 2>/dev/null || true)"
  fi
  local target_cwd="${exp_cwd:-$ROOT}"
  if [[ -n "$proc_cwd" && "$proc_cwd" != "$target_cwd"* ]]; then
    return 1
  fi

  return 0
}

stop_backend() {
  validate_state_path_safety
  if [[ -f "$pid_file" ]]; then
    local pid=""
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^PID=([0-9]+)$ ]]; then
        pid="${BASH_REMATCH[1]}"
        break
      elif [[ "$line" =~ ^[0-9]+$ ]]; then
        pid="$line"
        break
      fi
    done <"$pid_file"

    if [[ -n "$pid" ]] && is_mypet_backend_process "$pid"; then
      kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      if kill -0 "$pid" 2>/dev/null && is_mypet_backend_process "$pid"; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
    elif [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      echo "PID $pid in $pid_file does not match MyPet backend identity token/start-time; leaving unrelated process untouched." >&2
    fi
    rm -f "$pid_file"
  fi
}

case "$command_name" in
  create)
    [[ ! -e "$state_file" && ! -e "$state_dir/environment.sh" && ! -d "$state_dir" ]] || {
      echo "Environment '$env_name' already exists." >&2
      exit 2
    }
    if docker inspect "$container" >/dev/null 2>&1; then
      echo "Container '$container' already exists; refusing to adopt it." >&2
      exit 2
    fi
    if docker network inspect "$network" >/dev/null 2>&1; then
      echo "Network '$network' already exists; refusing to adopt it." >&2
      exit 2
    fi
    if command -v lsof >/dev/null 2>&1; then
      if lsof -nP -iTCP:"$db_port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "Loopback DB port $db_port is already in use; choose another environment name." >&2
        exit 2
      fi
      if lsof -nP -iTCP:"$backend_port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "Backend port $backend_port is already in use; choose another environment name." >&2
        exit 2
      fi
    fi

    DB_PASSWORD="$(openssl rand -hex 24)"
    TOKEN_SECRET="$(openssl rand -hex 32)"
    SYNC_CURSOR_SECRET="$(openssl rand -hex 32)"
    DEVICE_TOKEN_KEY="$(openssl rand -base64 32 | tr -d '\n')"
    SERVICE_ROLE_KEY="$(openssl rand -hex 32)"

    rollback_create() {
      docker rm -f "$container" >/dev/null 2>&1 || true
      docker network rm "$network" >/dev/null 2>&1 || true
      [[ ! -L "$state_dir" ]] && rm -rf "$state_dir"
    }

    docker network create "$network" >/dev/null
    if ! docker run -d "${platform_args[@]}" \
      --name "$container" \
      --network "$network" \
      -p "127.0.0.1:${db_port}:5432" \
      -e POSTGRES_USER=mypet \
      -e POSTGRES_PASSWORD="$DB_PASSWORD" \
      -e POSTGRES_DB="$db_name" \
      "$POSTGIS_IMAGE" >/dev/null; then
      rollback_create
      exit 1
    fi
    if ! wait_for_postgres; then
      rollback_create
      exit 1
    fi
    if ! ensure_supabase_postgis_layout; then
      rollback_create
      exit 1
    fi
    write_state
    echo "Created isolated PostgreSQL '$env_name' on 127.0.0.1:${db_port} with Supabase-compatible PostGIS layout."
    ;;

  migrate)
    load_state
    docker start "$CONTAINER" >/dev/null 2>&1 || true
    wait_for_postgres
    ensure_supabase_postgis_layout
    docker run --rm "${platform_args[@]}" \
      --network "$NETWORK" \
      -v "$MIGRATIONS:/flyway/sql:ro" \
      -e FLYWAY_URL="jdbc:postgresql://${CONTAINER}:5432/${DB_NAME}" \
      -e FLYWAY_USER=mypet \
      -e FLYWAY_PASSWORD="$DB_PASSWORD" \
      "$FLYWAY_IMAGE" \
      -connectRetries=15 \
      -schemas=mypet \
      -defaultSchema=mypet \
      -createSchemas=true \
      -cleanDisabled=true \
      -validateMigrationNaming=true \
      migrate
    docker run --rm "${platform_args[@]}" \
      --network "$NETWORK" \
      -v "$MIGRATIONS:/flyway/sql:ro" \
      -e FLYWAY_URL="jdbc:postgresql://${CONTAINER}:5432/${DB_NAME}" \
      -e FLYWAY_USER=mypet \
      -e FLYWAY_PASSWORD="$DB_PASSWORD" \
      "$FLYWAY_IMAGE" \
      -schemas=mypet -defaultSchema=mypet -cleanDisabled=true validate
    echo "Flyway migration/validation passed for '$env_name'."
    ;;

  boot)
    load_state
    docker start "$CONTAINER" >/dev/null 2>&1 || true
    wait_for_postgres
    if [[ -f "$pid_file" ]]; then
      existing_pid=""
      while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^PID=([0-9]+)$ ]]; then
          existing_pid="${BASH_REMATCH[1]}"
          break
        elif [[ "$line" =~ ^[0-9]+$ ]]; then
          existing_pid="$line"
          break
        fi
      done <"$pid_file"
      if [[ -n "$existing_pid" ]] && is_mypet_backend_process "$existing_pid"; then
        echo "Backend is already running for '$env_name' (PID: $existing_pid)."
        exit 0
      fi
    fi

    if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Backend port $BACKEND_PORT is already in use by another process." >&2
      exit 2
    fi

    BACKEND_PROCESS_TOKEN="$(openssl rand -hex 16)"
    : >"$log_file"
    (
      cd "$ROOT"
      export DATABASE_URL="jdbc:postgresql://127.0.0.1:${DB_PORT}/${DB_NAME}"
      export DATABASE_USERNAME=mypet
      export DATABASE_PASSWORD="$DB_PASSWORD"
      export SERVER_PORT="$BACKEND_PORT"
      export MYPET_SYNC_CURSOR_SECRET="$SYNC_CURSOR_SECRET"
      export MYPET_TOKEN_SECRET="$TOKEN_SECRET"
      export MYPET_TOKEN_ISSUER="mypetnew-local-${env_name}"
      export MYPET_TOKEN_AUDIENCE="mypetnew-local-${env_name}"
      export MYPET_DEVICE_TOKEN_KEY="$DEVICE_TOKEN_KEY"
      export SPRING_PROFILES_ACTIVE=local-isolated
      export MYPET_ENVIRONMENT=development
      export FIREBASE_PROJECT_ID="mypetnew-local-${env_name}"
      export NOTIFICATION_DELIVERY_ENABLED=false
      export CASHFREE_ENABLED=false
      export MANAGEMENT_HEALTH_REDIS_ENABLED=false
      exec ./gradlew :backend:bootRun -Dmypet.process.token="$BACKEND_PROCESS_TOKEN" --no-daemon --no-configuration-cache
    ) >>"$log_file" 2>&1 &
    backend_pid=$!
    backend_lstart="$(ps -p "$backend_pid" -o lstart= 2>/dev/null | tr -s ' ' | sed -e 's/^[ ]*//' -e 's/[ ]*$//' || true)"
    {
      echo "PID=$backend_pid"
      echo "PROCESS_TOKEN=$BACKEND_PROCESS_TOKEN"
      echo "START_TIME=$backend_lstart"
      echo "EXPECTED_CWD=$ROOT"
    } >"$pid_file"
    chmod 600 "$pid_file"

    for _ in $(seq 1 90); do
      if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/actuator/health" >/dev/null 2>&1; then
        echo "Backend '$env_name' is healthy on http://127.0.0.1:${BACKEND_PORT}."
        exit 0
      fi
      if ! kill -0 "$backend_pid" 2>/dev/null; then
        echo "Backend exited before becoming healthy." >&2
        tail -n 120 "$log_file" >&2 || true
        rm -f "$pid_file"
        exit 1
      fi
      sleep 1
    done
    echo "Backend health check timed out for '$env_name'." >&2
    tail -n 120 "$log_file" >&2 || true
    stop_backend
    exit 1
    ;;

  status)
    load_state
    container_state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
    backend_state=stopped
    if [[ -f "$pid_file" ]]; then
      status_pid=""
      while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^PID=([0-9]+)$ ]]; then
          status_pid="${BASH_REMATCH[1]}"
          break
        elif [[ "$line" =~ ^[0-9]+$ ]]; then
          status_pid="$line"
          break
        fi
      done <"$pid_file"
      if [[ -n "$status_pid" ]] && is_mypet_backend_process "$status_pid"; then
        backend_state=running
      fi
    fi
    echo "name=$env_name db=$container_state db_port=$DB_PORT backend=$backend_state backend_port=$BACKEND_PORT"
    ;;

  certify)
    "$0" migrate "$env_name"
    "$0" boot "$env_name"
    load_state
    PGHOST=127.0.0.1 PGPORT="$DB_PORT" PGUSER=mypet PGPASSWORD="$DB_PASSWORD" PGDATABASE="$DB_NAME" \
      DATABASE_URL="jdbc:postgresql://127.0.0.1:${DB_PORT}/${DB_NAME}" \
      bash "$ROOT/scripts/postgres/verify-ephemeral-db.sh" postflight
    echo "Isolated environment '$env_name' certified: migration validated, backend healthy, PostGIS in extensions, and zero transactional seed data."
    ;;

  stop)
    load_state
    stop_backend
    docker stop "$CONTAINER" >/dev/null 2>&1 || true
    echo "Stopped isolated environment '$env_name'."
    ;;

  destroy)
    validate_state_path_safety
    load_state
    stop_backend
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
    [[ ! -L "$state_dir" ]] && rm -rf "$state_dir"
    echo "Destroyed only isolated environment '$env_name'."
    ;;

  *) usage ;;
esac
