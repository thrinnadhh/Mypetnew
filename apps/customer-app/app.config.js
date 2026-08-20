const fs = require('node:fs');
const path = require('node:path');

const isDevelopment = process.env.EXPO_PUBLIC_APP_ENV === 'development';
const configuredGoogleServicesFile = process.env.GOOGLE_SERVICES_JSON?.trim();
const localGoogleServicesFile = './google-services.json';
const hasLocalGoogleServicesFile = fs.existsSync(path.join(__dirname, 'google-services.json'));
const googleServicesFile = configuredGoogleServicesFile
  || (hasLocalGoogleServicesFile ? localGoogleServicesFile : undefined);

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: isDevelopment,
        },
      },
    ],
  ],
  android: {
    ...config.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
});
