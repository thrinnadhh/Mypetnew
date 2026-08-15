#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

source_paths=(backend/src/main apps packages)

if rg -n --glob '!**/*.test.*' --glob '!**/dist/**' --glob '!**/.next/**' \
  '(?i)(card(number|_number)|cvv|cvc|upi[_-]?pin|bank[_-]?password)[[:space:]]*[:=]' "${source_paths[@]}"; then
  echo "Raw payment credential field pattern found in production source." >&2
  exit 1
fi

if rg -n --glob '!**/*.test.*' --glob '!**/dist/**' --glob '!**/.next/**' \
  '(console\.log|System\.out\.print|println\()' "${source_paths[@]}"; then
  echo "Direct production logging bypasses the redaction boundary." >&2
  exit 1
fi

if rg -n --glob '!**/*.test.*' --glob '!**/dist/**' --glob '!**/.next/**' \
  '(?i)AsyncStorage.{0,120}(access.?token|refresh.?token|session|otp)' apps packages; then
  echo "Sensitive mobile authentication state may be stored outside protected native storage." >&2
  exit 1
fi

if rg -n --glob '!**/dist/**' --glob '!**/.next/**' \
  '(usesCleartextTraffic["'"'"'=:[:space:]]+true|android:usesCleartextTraffic="true")' apps; then
  echo "Android cleartext traffic is explicitly enabled." >&2
  exit 1
fi

if rg -n --glob '!**/*.test.*' --glob '!**/dist/**' --glob '!**/.next/**' \
  'EXPO_PUBLIC_.*(SECRET|PRIVATE|SERVICE_ROLE|DATABASE_PASSWORD)' apps packages; then
  echo "A privileged credential is exposed through public mobile configuration." >&2
  exit 1
fi

echo "Privacy/security source contract scan passed."
