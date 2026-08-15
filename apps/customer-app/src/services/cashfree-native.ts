import {
  CFPaymentGatewayService,
  type CFCallback,
  type CFErrorResponse,
} from 'react-native-cashfree-pg-sdk';
import { CFEnvironment, CFSession } from 'cashfree-pg-api-contract';

import { appConfig } from '../utils/app-config';

export type CashfreeNativeSignal = 'VERIFY' | 'ERROR';

export interface CashfreeNativeCheckoutInput {
  paymentSessionId: string;
  providerOrderId: string;
}

/**
 * Native Cashfree integration boundary.
 *
 * Provider callbacks are deliberately reduced to local signals. They never
 * establish payment success; callers must query MyPet's canonical payment API.
 * Keeping this SDK binding in its own lazily imported module also prevents
 * unrelated auth/service Jest suites from loading native Cashfree bindings.
 */
export async function openCashfreeNativeCheckout(
  input: CashfreeNativeCheckoutInput,
): Promise<CashfreeNativeSignal> {
  const environment = appConfig.environment === 'production'
    ? CFEnvironment.PRODUCTION
    : CFEnvironment.SANDBOX;
  const session = new CFSession(input.paymentSessionId, input.providerOrderId, environment);

  return new Promise<CashfreeNativeSignal>((resolve, reject) => {
    let settled = false;
    const removeCallback = () => {
      CFPaymentGatewayService.removeCallback();
    };
    const settle = (signal: CashfreeNativeSignal) => {
      if (settled) return;
      settled = true;
      removeCallback();
      resolve(signal);
    };
    const callback: CFCallback = {
      onVerify: () => settle('VERIFY'),
      onError: (_error: CFErrorResponse, _orderId: string) => settle('ERROR'),
    };

    try {
      CFPaymentGatewayService.setCallback(callback);
      CFPaymentGatewayService.doWebPayment(session);
    } catch (error) {
      removeCallback();
      reject(error);
    }
  });
}
