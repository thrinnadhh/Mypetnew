# MyPetNew Legacy Migration Report

## Baseline

MyPetNew baseline commit:

ba55ef5037ff4ab5344dd3e4bc869635e21d7a51

Discovery branch:

migration/legacy-reuse-matrix

Legacy repositories inspected:

- MyPet
- nearby

No legacy application code has been copied into MyPetNew during LR01.

## Pre-Migration Verification

### Backend notification-focused tests

PASS

Covered:

- FirebaseNotificationProviderContractTest
- NotificationDeliveryWorkerContractTest
- PosLoyaltyNotificationContractTest

### Full backend tests

PASS

### Customer app

TypeScript typecheck:

PASS

Lint:

PASS

Jest:

39 / 39 suites passed

231 / 231 tests passed

Snapshots:

0

## Notification Comparison Result

MyPetNew already contains the majority of desirable legacy notification
hardening.

Existing MyPetNew capabilities include:

- provider abstraction
- FCM HTTP v1
- encrypted token persistence
- notification deduplication
- outbox
- retry
- dead-letter handling
- invalid token handling
- stale claim recovery
- concurrent worker claim protection
- role/session-safe device registrations

Therefore the legacy notification service must not be copied.

## Discovered Integration Gap

The existing automated tests do not currently detect an API contract drift
between the Customer application and backend.

Customer application currently uses:

POST /api/v1/notifications/push-tokens

Backend canonical API uses:

POST /api/v1/devices/registrations

The Customer application also obtains an Expo push token while the backend
delivery provider is designed for native Firebase/FCM device tokens.

Explicit registration revoke/disable behaviour on logout also requires a
canonical backend contract.

Classification:

CURRENT PASSING:
- backend notification unit/contract tests
- customer app test suite
- retry/dead-letter infrastructure
- notification persistence

CURRENT FAILING / DRIFTED:
- Customer-to-backend push registration contract

MISSING:
- canonical explicit device/installation revoke API
- tests proving Customer app uses the canonical registration API
- real Android development-build push evidence

LEGACY AVAILABLE:
- explicit push-token unregister behaviour

JUSTIFICATION:
Reuse the behavioural invariant only. Do not reuse legacy architecture.

## nearby

nearby contains useful future reference implementations for:

- Redis/location/dispatch-related realtime flows
- Socket.IO order rooms
- GPS tracking
- FCM helper concepts
- assignment notification UI

These remain deferred and are not eligible for Sprint-1 implementation.

## LR01 Result

Application code imported:

0 files

Premature later-sprint functionality imported:

0

Legacy notification service copied:

No

Recommended next implementation:

Sprint-1 notification device-registration contract repair.
