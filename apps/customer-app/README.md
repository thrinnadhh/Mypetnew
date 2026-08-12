# MyPet Customer App

Expo React Native customer application for MyPet shopping, veterinary,
grooming, delivery, loyalty, support and recurring-order journeys.

## Requirements

- Node.js `20.19.x`
- npm
- an API base URL for the target MyPet environment
- Expo/EAS credentials only when producing native internal builds

## Install and validate

Use the committed lockfile. Do not run a broad dependency upgrade during a
feature change.

```bash
npm ci
npx --yes expo-doctor@1.20.1
npm run typecheck
npm run lint
npm run test:coverage
```

The package versions are aligned to Expo SDK 56. When Expo Doctor reports a
framework compatibility mismatch, regenerate both package files with Expo's
installer rather than editing `package-lock.json` manually:

```bash
npx expo install --fix --npm
npm ci
npx --yes expo-doctor@1.20.1
```

Review the generated `package.json` and `package-lock.json` together and rerun
all validation commands before committing them.

## Run locally

```bash
npm run start
```

Other targets:

```bash
npm run android
npm run ios
npm run web
```

A development client or signed internal build is required for device behavior
that Expo Go cannot faithfully reproduce, including production push handling,
native deep links and release permission flows.

## Release builds

`eas.json` defines the checked-in build profiles. The repository's manual
**Customer Internal Build** workflow validates the app and requests Android or
iOS internal-distribution artifacts. It fails closed unless the `internal-beta`
environment contains a valid `EXPO_TOKEN` and the Expo project has the required
signing credentials.

Native build completion does not replace physical-device QA. Record device,
OS, build identifier and evidence in the repository QA matrix before enabling
release distribution.
