export type CashfreeNativeSignal = 'VERIFY' | 'ERROR';

export interface CashfreeNativeCheckoutInput {
  paymentSessionId: string;
  providerOrderId: string;
}

/**
 * Non-native fallback for environments such as TypeScript/Jest/server tooling.
 *
 * The real Cashfree React Native SDK binding lives in cashfree-native.native.ts.
 * Keeping the generic module free of the native package prevents Expo web/SSR
 * resolution from walking into Cashfree's native-only published artifacts.
 */
export async function openCashfreeNativeCheckout(
  _input: CashfreeNativeCheckoutInput,
): Promise<CashfreeNativeSignal> {
  throw new Error('Cashfree native checkout is only available on Android and iOS.');
}
