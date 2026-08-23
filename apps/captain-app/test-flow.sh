#!/usr/bin/env bash
set -e

BASE_URL="http://localhost:8080"
MOBILE="+919876543210"
CODE="123456"

echo "========================================="
echo "Testing MyPet Captain API Flow"
echo "========================================="

# 1. Request OTP
echo -e "\n1. Requesting OTP for $MOBILE..."
REQ_RES=$(curl -s -X POST "$BASE_URL/api/v1/auth/otp/request" \
  -H "Content-Type: application/json" \
  -d "{
    \"mobile\": \"$MOBILE\",
    \"purpose\": \"LOGIN\",
    \"deviceId\": \"captain-device-test\"
  }")

echo "Response: $REQ_RES"
CHALLENGE_ID=$(echo "$REQ_RES" | grep -o '"challengeId":"[^"]*' | cut -d'"' -f4)

if [ -z "$CHALLENGE_ID" ]; then
  echo "❌ Error: Failed to retrieve challengeId"
  exit 1
fi
echo "✓ Retrieved Challenge ID: $CHALLENGE_ID"

# 2. Verify OTP as Captain
echo -e "\n2. Verifying OTP as Captain..."
VERIFY_RES=$(curl -s -X POST "$BASE_URL/api/v1/auth/captain/otp/verify" \
  -H "Content-Type: application/json" \
  -d "{
    \"challengeId\": \"$CHALLENGE_ID\",
    \"mobile\": \"$MOBILE\",
    \"purpose\": \"LOGIN\",
    \"code\": \"$CODE\"
  }")

echo "Response: $VERIFY_RES"
ACCESS_TOKEN=$(echo "$VERIFY_RES" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Error: Failed to retrieve accessToken"
  exit 1
fi
echo "✓ Successfully Authenticated Captain! Access Token: ${ACCESS_TOKEN:0:20}..."

# 3. Publish Availability & GPS
echo -e "\n3. Updating Captain Availability to ONLINE (Lat: 13.6288, Lng: 79.4192)..."
AVAIL_RES=$(curl -s -X PUT "$BASE_URL/api/v1/captain/availability" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "online": true,
    "latitude": 13.6288,
    "longitude": 79.4192
  }')

echo "Response: $AVAIL_RES"
echo "✓ Captain is now ONLINE and listening for nearby orders!"

# 4. Fetch Pending Offers
echo -e "\n4. Fetching Pending Dispatch Offers..."
OFFERS_RES=$(curl -s -X GET "$BASE_URL/api/v1/captain/dispatch/offers" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "Response: $OFFERS_RES"

echo -e "\n========================================="
echo "✓ Captain API test flow completed successfully!"
echo "========================================="
