#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_ROOT="$ROOT/.mypet-env"
POSTGIS_IMAGE="${MYPET_POSTGIS_IMAGE:-postgis/postgis:17-3.5-alpine}"
FLYWAY_IMAGE="${MYPET_FLYWAY_IMAGE:-flyway/flyway:12.4.0}"
MIGRATIONS="$ROOT/backend/src/main/resources/db/migration"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/dev/isolated-postgres-env.sh <create|migrate|boot|status|certify|stop|destroy> <name>
EOF
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
state_file="$state_dir/environment.sh"
pid_file="$state_dir/backend.pid"
log_file="$state_dir/backend.log"

checksum="$(printf '%s' "$env_name" | cksum | awk '{print $1}')"
db_port="$((15432 + checksum % 500))"
backend_port="$((18080 + checksum % 500))"

platform_args=()
case "$(uname -m 2>/dev/null || true)" in
  arm64|aarch64) platform_args=(--platform linux/amd64) ;;
esac

load_state() {
  [[ -f "$state_file" ]] || {
    echo "Isolated environment '$env_name' does not exist. Run create first." >&2
    exit 2
  }
  # shellcheck disable=SC1090
  source "$state_file"
}

write_state() {
  mkdir -p "$state_dir"
  chmod 700 "$state_dir"
  umask 077
  {
    printf 'DB_PASSWORD=%q\n' "$DB_PASSWORD"
    printf 'TOKEN_SECRET=%q\n' "$TOKEN_SECRET"
    printf 'SYNC_CURSOR_SECRET=%q\n' "$SYNC_CURSOR_SECRET"
    printf 'DEVICE_TOKEN_KEY=%q\n' "$DEVICE_TOKEN_KEY"
    printf 'DB_PORT=%q\n' "$db_port"
    printf 'BACKEND_PORT=%q\n' "$backend_port"
    printf 'DB_NAME=%q\n' "$db_name"
    printf 'CONTAINER=%q\n' "$container"
    printf 'NETWORK=%q\n' "$network"
  } >"$state_file"
  chmod 600 "$state_file"
}

wait_for_postgres() {
  for _ in $(seq 1 40); do
    if docker exec "$container" pg_isready -U mypet -d "$db_name" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL did not become ready for '$env_name'." >&2
  docker logs --tail 60 "$container" >&2 || true
  return 1
}

stop_backend() {
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

case "$command_name" in
  create)
    [[ ! -e "$state_file" ]] || {
      echo "Environment '$env_name' already exists." >&2
      exit 2
    }
    if docker inspect "$container" >/dev/null 2>&1; then
      echo "Container '$container' already exists; refusing to adopt it." >&2
      exit 2
    fi
    if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$db_port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Loopback DB port $db_port is already in use; choose another environment name." >&2
      exit 2
    fi

    DB_PASSWORD="$(openssl rand -hex 24)"
    TOKEN_SECRET="$(openssl rand -hex 32)"
    SYNC_CURSOR_SECRET="$(openssl rand -hex 32)"
    DEVICE_TOKEN_KEY="$(openssl rand -base64 32 | tr -d '\n')"

    docker network create "$network" >/dev/null
    if ! docker run -d "${platform_args[@]}" \
      --name "$container" \
      --network "$network" \
      -p "127.0.0.1:${db_port}:5432" \
      -e POSTGRES_USER=mypet \
      -e POSTGRES_PASSWORD="$DB_PASSWORD" \
      -e POSTGRES_DB="$db_name" \
      "$POSTGIS_IMAGE" >/dev/null; then
      docker network rm "$network" >/dev/null 2>&1 || true
      exit 1
    fi
    if ! wait_for_postgres; then
      docker rm -f "$container" >/dev/null 2>&1 || true
      docker network rm "$network" >/dev/null 2>&1 || true
      exit 1
    fi
    write_state
    echo "Created isolated PostgreSQL '$env_name' on 127.0.0.1:${db_port}."
    ;;

  migrate)
    load_state
    docker start "$CONTAINER" >/dev/null 2>&1 || true
    wait_for_postgres
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
    if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
      echo "Backend is already running for '$env_name'."
      exit 0
    fi
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
      export MYPET_ENVIRONMENT=local-isolated
      export NOTIFICATION_DELIVERY_ENABLED=false
      export CASHFREE_ENABLED=false
      exec ./gradlew :backend:bootRun --no-daemon --no-configuration-cache
    ) >>"$log_file" 2>&1 &
    echo "$!" >"$pid_file"
    for _ in $(seq 1 90); do
      if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/actuator/health" >/dev/null 2>&1; then
        echo "Backend '$env_name' is healthy on http://127.0.0.1:${BACKEND_PORT}."
        exit 0
      fi
      if ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
        echo "Backend exited before becoming healthy." >&2
        tail -n 100 "$log_file" >&2 || true
        rm -f "$pid_file"
        exit 1
      fi
      sleep 1
    done
    echo "Backend health check timed out for '$env_name'." >&2
    tail -n 100 "$log_file" >&2 || true
    stop_backend
    exit 1
    ;;

  status)
    load_state
    container_state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
    backend_state=stopped
    if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
      backend_state=running
    fi
    echo "name=$env_name db=$container_state db_port=$DB_PORT backend=$backend_state backend_port=$BACKEND_PORT"
    ;;

  certify)
    "$0" migrate "$env_name"
    "$0" boot "$env_name"
    echo "Isolated environment '$env_name' certified: migration validated and backend healthy."
    ;;

  stop)
    load_state
    stop_backend
    docker stop "$CONTAINER" >/dev/null 2>&1 || true
    echo "Stopped isolated environment '$env_name'."
    ;;

  destroy)
    load_state
    stop_backend
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
    rm -rf "$state_dir"
    echo "Destroyed only isolated environment '$env_name'."
    ;;

  *) usage ;;
esac
