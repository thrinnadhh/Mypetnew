export interface CustomerAuthUser {
  id: string;
  phone: string;
  displayName: string | null;
}

export interface CustomerAuthSession {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  role: 'CUSTOMER';
  mobile: string;
}

export interface PersistedRefreshState {
  refreshToken: string;
  refreshTokenExpiresAt: string;
  accountId: string;
  mobile: string;
  role: 'CUSTOMER';
  deviceId: string;
}
