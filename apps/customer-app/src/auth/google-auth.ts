import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { OtpAuthError, normalizeOtpError } from '@/auth/otp-auth';
import { supabase } from '@/utils/supabase';

WebBrowser.maybeCompleteAuthSession();

function callbackParams(url: string): URLSearchParams {
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');
  const parts: string[] = [];
  if (queryIndex >= 0) {
    const end = hashIndex > queryIndex ? hashIndex : url.length;
    parts.push(url.slice(queryIndex + 1, end));
  }
  if (hashIndex >= 0) parts.push(url.slice(hashIndex + 1));
  return new URLSearchParams(parts.filter(Boolean).join('&'));
}

export async function signInWithGoogle() {
  const redirectTo = Linking.createURL('auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  });

  if (error) throw normalizeOtpError(error);
  if (!data.url) throw new OtpAuthError('UNKNOWN', 'Google sign-in could not be started.');

  const browserResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (browserResult.type === 'cancel' || browserResult.type === 'dismiss') {
    throw new OtpAuthError('CANCELLED', 'Google sign-in was cancelled.');
  }
  if (browserResult.type !== 'success' || !browserResult.url) {
    throw new OtpAuthError('UNKNOWN', 'Google sign-in could not be completed.');
  }

  const params = callbackParams(browserResult.url);
  const oauthError = params.get('error_description') || params.get('error');
  if (oauthError) throw new OtpAuthError('UNKNOWN', oauthError);

  const code = params.get('code');
  if (code) {
    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    if (exchanged.error) throw normalizeOtpError(exchanged.error);
    if (!exchanged.data.session) throw new OtpAuthError('UNKNOWN', 'Google session was not created.');
    return exchanged.data.session;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new OtpAuthError('UNKNOWN', 'Google returned an incomplete authentication response.');
  }

  const sessionResult = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (sessionResult.error) throw normalizeOtpError(sessionResult.error);
  if (!sessionResult.data.session) throw new OtpAuthError('UNKNOWN', 'Google session was not created.');
  return sessionResult.data.session;
}
