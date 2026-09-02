#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

output_dir="evidence/generated/engineering-toolkit-ci"
mkdir -p "$output_dir"

while IFS= read -r -d '' json_file; do
  node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$json_file"
done < <(find engineering -type f -name '*.json' -print0)

while IFS= read -r -d '' module_file; do
  node --check "$module_file"
done < <(find engineering -type f -name '*.mjs' -print0)

node engineering/bin/mypet-engineering.mjs contract validate \
  --contract engineering/examples/autonomous-engineering-foundation.sprint.json \
  --output "$output_dir/autonomous-engineering-foundation.contract.json"

node engineering/bin/mypet-engineering.mjs contract validate \
  --contract engineering/examples/merchant-barcode-pos.sprint.json \
  --output "$output_dir/merchant-barcode-pos.contract.json"

npm test --prefix engineering

git diff --check

echo "Engineering toolkit verification passed."
