import { router } from "expo-router";
import { useState } from "react";
import { Button, SafeAreaView, Text, TextInput } from "react-native";
import { requestMerchantOtp, verifyMerchantOtp } from "../src/auth/session";

function displayError(error: unknown): string {
  if (error instanceof TypeError || (error instanceof Error && /network|fetch/i.test(error.message))) {
    return "Unable to reach MyPet. Check your connection and try again.";
  }
  if (!(error instanceof Error)) return "Unable to continue";
  switch (error.message) {
    case "MOBILE_INVALID":
      return "Enter a valid Indian mobile number.";
    case "OTP_INVALID":
      return "The verification code is invalid or expired.";
    case "OTP_RATE_LIMITED":
      return "Too many attempts. Try again later.";
    case "SESSION_INVALID":
      return "This mobile number is not authorized for an active Merchant account.";
    default:
      return "Unable to continue. Try again.";
  }
}

export default function MerchantLoginScreen() {
  const [mobile, setMobile] = useState("+91");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const normalizedMobile = mobile.trim();
  const canRequest = /^\+91[6-9][0-9]{9}$/.test(normalizedMobile);
  const canVerify = challengeId !== null && /^[0-9]{6}$/.test(code.trim());

  async function continueLogin() {
    if (busy || (!challengeId && !canRequest) || (challengeId && !canVerify)) return;
    setBusy(true);
    setMessage("");
    try {
      if (!challengeId) {
        const challenge = await requestMerchantOtp(normalizedMobile);
        setChallengeId(challenge.challengeId);
        setMessage(challenge.message);
        return;
      }
      await verifyMerchantOtp(challengeId, normalizedMobile, code.trim());
      router.replace("/");
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  function changeMobile() {
    if (busy) return;
    setChallengeId(null);
    setCode("");
    setMessage("");
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: "center", gap: 16 }}>
      <Text style={{ fontSize: 26, fontWeight: "700" }}>Merchant sign in</Text>
      <TextInput
        accessibilityLabel="Merchant mobile number"
        keyboardType="phone-pad"
        autoComplete="tel"
        editable={!busy && !challengeId}
        value={mobile}
        onChangeText={setMobile}
        style={{ minHeight: 48, borderWidth: 1, paddingHorizontal: 12 }}
      />
      {challengeId ? (
        <>
          <TextInput
            accessibilityLabel="Verification code"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            editable={!busy}
            value={code}
            onChangeText={setCode}
            style={{ minHeight: 48, borderWidth: 1, paddingHorizontal: 12 }}
          />
          <Button title="Use a different mobile number" disabled={busy} onPress={changeMobile} />
        </>
      ) : null}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      <Button
        title={busy ? "Please wait…" : challengeId ? "Verify and continue" : "Send verification code"}
        disabled={busy || (!challengeId && !canRequest) || Boolean(challengeId && !canVerify)}
        onPress={() => void continueLogin()}
      />
    </SafeAreaView>
  );
}
