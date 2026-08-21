let sequence = 0;

export interface MerchantTestIdentity {
  accountId: string;
  organizationId: string;
  outletId: string;
  deviceId: string;
}

export function merchantTestIdentity(overrides: Partial<MerchantTestIdentity> = {}): MerchantTestIdentity {
  sequence += 1;
  const suffix = sequence.toString().padStart(4, "0");
  return {
    accountId: `00000000-0000-4000-8000-00000000${suffix}`,
    organizationId: `10000000-0000-4000-8000-00000000${suffix}`,
    outletId: `20000000-0000-4000-8000-00000000${suffix}`,
    deviceId: `m0-device-${suffix}`,
    ...overrides
  };
}

export function resetMerchantFixtureSequence(): void {
  sequence = 0;
}
