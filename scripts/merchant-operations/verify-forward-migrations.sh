#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/../.." && pwd)"
base_ref="${MYPET_MIGRATION_BASE_REF:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      repository_root="$(cd "$2" && pwd)"
      shift 2
      ;;
    --base)
      base_ref="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

cd "$repository_root"
migration_dir="backend/src/main/resources/db/migration"
sealed_manifest="contracts/merchant-operations/sealed-flyway-v21.sha256"

[[ -d "$migration_dir" ]] || { echo "Migration directory is missing: $migration_dir" >&2; exit 1; }
[[ -f "$sealed_manifest" ]] || { echo "Sealed migration manifest is missing: $sealed_manifest" >&2; exit 1; }

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

while read -r expected filename; do
  [[ -n "${expected:-}" && -n "${filename:-}" ]] || continue
  target="$migration_dir/$filename"
  [[ -f "$target" ]] || { echo "Sealed migration is missing: $filename" >&2; exit 1; }
  actual="$(hash_file "$target")"
  [[ "$actual" == "$expected" ]] || {
    echo "Sealed migration changed: $filename" >&2
    exit 1
  }
done < "$sealed_manifest"

seen_versions=()
seen_filenames=()
while IFS= read -r migration; do
  filename="$(basename "$migration")"
  if [[ ! "$filename" =~ ^V([0-9]+)__[a-z0-9_]+\.sql$ ]]; then
    echo "Invalid Flyway migration filename: $filename" >&2
    exit 1
  fi
  version="${BASH_REMATCH[1]}"
  for index in "${!seen_versions[@]}"; do
    if [[ "${seen_versions[$index]}" == "$version" ]]; then
      echo "Duplicate Flyway migration version V$version: ${seen_filenames[$index]} and $filename" >&2
      exit 1
    fi
  done
  seen_versions+=("$version")
  seen_filenames+=("$filename")
done < <(find "$migration_dir" -maxdepth 1 -type f -name 'V*.sql' | sort)

if [[ -z "$base_ref" && -n "${GITHUB_BASE_REF:-}" ]] && git show-ref --verify --quiet "refs/remotes/origin/$GITHUB_BASE_REF"; then
  base_ref="origin/$GITHUB_BASE_REF"
fi
if [[ -z "$base_ref" && -n "${GITHUB_BASE_REF:-}" ]] && git rev-parse --verify HEAD^1 >/dev/null 2>&1; then
  base_ref="HEAD^1"
fi
if [[ -z "$base_ref" ]] && git show-ref --verify --quiet refs/remotes/origin/main; then
  base_ref="origin/main"
fi
if [[ -z "$base_ref" ]]; then
  base_ref="HEAD"
fi

if git rev-parse --verify "$base_ref^{commit}" >/dev/null 2>&1; then
  merge_base="$(git merge-base "$base_ref" HEAD 2>/dev/null || git rev-parse "$base_ref^{commit}")"
  while IFS=$'\t' read -r status first_path second_path; do
    [[ -n "${status:-}" ]] || continue
    if [[ "$status" != A ]]; then
      echo "Historical Flyway migrations are immutable; detected $status ${first_path}${second_path:+ -> $second_path}" >&2
      exit 1
    fi
  done < <(git diff --name-status --find-renames "$merge_base" -- "$migration_dir")
fi

echo "Forward-only Flyway migration contract passed."
