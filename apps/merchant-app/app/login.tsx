import { router } from "expo-router";
import { useState } from "react";
import { Button, SafeAreaView, Text, TextInput } from "react-native";
import { requestMerchantOtp, verifyMerchantOtp } from "../src/auth/session";

export default function MerchantLoginScreen() {
  const [mobile, setMobile] = useState("+91");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  async function continueLogin() {
    try {
      if (!challengeId) {
        const challenge = await requestMerchantOtp(mobile.trim());
        setChallengeId(challenge.challengeId);
        setMessage(challenge.message);
        return;
      }
      await verifyMerchantOtp(challengeId, mobile.trim(), code.trim());
      router.replace("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to continue");
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: "center", gap: 16 }}>
      <Text style={{ fontSize: 26, fontWeight: "700" }}>Merchant sign in</Text>
      <TextInput accessibilityLabel="Merchant mobile number" keyboardType="phone-pad" value={mobile} onChangeText={setMobile} style={{ minHeight: 48, borderWidth: 1, paddingHorizontal: 12 }} />
      {challengeId ? <TextInput accessibilityLabel="Verification code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} style={{ minHeight: 48, borderWidth: 1, paddingHorizontal: 12 }} /> : null}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      <Button title={challengeId ? "Verify and continue" : "Send verification code"} onPress={continueLogin} />
    </SafeAreaView>
  );
}
