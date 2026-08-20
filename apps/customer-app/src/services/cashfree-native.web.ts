export type CashfreeNativeSignal = 'VERIFY' | 'ERROR';

export interface CashfreeNativeCheckoutInput {
  paymentSessionId: string;
  providerOrderId: string;
}

/**
 * Cashfree's React Native SDK is not a web dependency for the MyPet customer
 * client. Keeping an explicit web module prevents Expo Router web/SSR bundling
 * from resolving react-native-cashfree-pg-sdk.
 */
export async function openCashfreeNativeCheckout(
  _input: CashfreeNativeCheckoutInput,
): Promise<CashfreeNativeSignal> {
  throw new Error('Cashfree checkout is not supported by the MyPet web client.');
}
