#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATION_DIR="$ROOT/backend/src/main/resources/db/migration"
EXPECTED_LATEST_MIGRATION="${EXPECTED_LATEST_MIGRATION:-}"

if [[ ! -d "$MIGRATION_DIR" ]]; then
  echo "Migration directory not found: $MIGRATION_DIR" >&2
  exit 1
fi

mapfile -t migration_files < <(find "$MIGRATION_DIR" -maxdepth 1 -type f -name 'V*__*.sql' -print | sort -V)

if (( ${#migration_files[@]} == 0 )); then
  echo "No Flyway versioned migrations found." >&2
  exit 1
fi

versions=()
declare -A seen=()

for file in "${migration_files[@]}"; do
  base="$(basename "$file")"
  if [[ ! "$base" =~ ^V([0-9]+)__[A-Za-z0-9_]+\.sql$ ]]; then
    echo "Invalid migration filename: $base" >&2
    exit 1
  fi

  version="${BASH_REMATCH[1]}"
  version=$((10#$version))

  if [[ -n "${seen[$version]:-}" ]]; then
    echo "Duplicate Flyway version V${version}: ${seen[$version]} and $base" >&2
    exit 1
  fi

  seen[$version]="$base"
  versions+=("$version")
done

mapfile -t sorted_versions < <(printf '%s\n' "${versions[@]}" | sort -n)

expected=1
for version in "${sorted_versions[@]}"; do
  if (( version != expected )); then
    echo "Flyway migration gap/order error: expected V${expected}, found V${version}" >&2
    exit 1
  fi
  expected=$((expected + 1))
done

latest="${sorted_versions[-1]}"

if [[ -n "$EXPECTED_LATEST_MIGRATION" && "$latest" != "$EXPECTED_LATEST_MIGRATION" ]]; then
  echo "Repository latest migration mismatch: expected V${EXPECTED_LATEST_MIGRATION}, found V${latest}" >&2
  exit 1
fi

echo "Repository Flyway migration sequence verified: V1..V${latest} (${#sorted_versions[@]} migrations)."
