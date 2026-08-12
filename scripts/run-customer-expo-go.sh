#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mac_ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [[ -z "$mac_ip" ]]; then
  mac_ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
fi
if [[ -z "$mac_ip" ]]; then
  echo "Unable to determine the Mac LAN IP. Connect the Mac to Wi-Fi and retry." >&2
  exit 1
fi

export APP_ENV="development"
export EXPO_PUBLIC_API_URL="http://${mac_ip}:8080"
export EXPO_PUBLIC_FIREBASE_PROJECT_ID="mypetnew-development"
export EXPO_PUBLIC_FIREBASE_APP_ID="development-expo-go"

echo "Customer API: ${EXPO_PUBLIC_API_URL}"
echo "Your phone must be able to reach ${EXPO_PUBLIC_API_URL}."
exec corepack pnpm --filter @mypet/customer-app exec expo start --go
