const fs = require('node:fs');
const path = require('node:path');

const environment = process.env.EXPO_PUBLIC_APP_ENV?.trim().toLowerCase() || 'development';
const configuredGoogleServicesFile = process.env.GOOGLE_SERVICES_JSON?.trim();
const localGoogleServicesFile = './google-services.json';
const hasLocalGoogleServicesFile = fs.existsSync(path.join(__dirname, 'google-services.json'));
const googleServicesFile =
  configuredGoogleServicesFile || (hasLocalGoogleServicesFile ? localGoogleServicesFile : undefined);

if (process.env.EAS_BUILD === 'true' && environment === 'production' && !googleServicesFile) {
  throw new Error(
    'GOOGLE_SERVICES_JSON must point to the Captain Firebase configuration for a production EAS build',
  );
}

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
});
