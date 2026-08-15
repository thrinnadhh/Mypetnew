# MyPetNew Legacy Reuse Matrix

Status: Discovery baseline
Scope: MyPetNew Sprint 1
Authoritative codebase: MyPetNew
Legacy sources:
- MyPet
- nearby

## Reuse Rules

MyPetNew architecture, business rules, security boundaries, database model,
API contracts, and tests are authoritative.

Legacy implementation is reused only when:

1. MyPetNew is genuinely missing the behaviour.
2. The behaviour is compatible with the current Sprint.
3. The implementation is adapted to the Kotlin/Spring modular monolith.
4. Characterization and regression tests prove correctness.
5. Existing MyPetNew tests continue to pass.

No legacy repository is copied wholesale.

## Classification

- SAFE_TO_PORT
- PORT_WITH_ADAPTATION
- REFERENCE_ONLY
- OBSOLETE
- SECURITY_RISK
- ARCHITECTURE_CONFLICT
- BUSINESS_RULE_CONFLICT
- DO_NOT_USE

## Notification Domain

### MyPet notification-service

Classification: PORT_WITH_ADAPTATION / REFERENCE_ONLY

Useful legacy behaviours:

- explicit device-token unregister concept
- delivery-state tracking
- retry/backoff invariants
- dead-letter handling concepts
- duplicate-event/idempotency protection
- provider failure classification
- bounded retry behaviour

Do not port:

- notification microservice topology
- Kafka dependency
- ExpoPushClient
- legacy NotificationController
- legacy DevicePushToken entity
- legacy DevicePushTokenRepository
- legacy reminder implementation
- legacy appointment/vaccination/chat listeners

### Existing MyPetNew implementation

KEEP.

MyPetNew already provides:

- NotificationProvider abstraction
- Firebase HTTP v1 provider
- encrypted native device tokens
- environment-scoped registrations
- installation ownership protection
- registration rotation
- session/account validity checks
- persistent notification attempts
- persistent notification items
- retry with bounded backoff
- stale worker claim recovery
- FOR UPDATE SKIP LOCKED worker concurrency
- dead-letter persistence
- outbox integration
- notification deduplication
- invalid-registration handling
- safe routes
- notification inbox

### Discovered Sprint-1 gap

CURRENT FAILING INTEGRATION CONTRACT:

The Customer application still uses the legacy-style push registration contract:

POST /api/v1/notifications/push-tokens

and obtains an Expo push token.

The canonical MyPetNew backend currently expects:

POST /api/v1/devices/registrations

with:

- appKind
- environment
- installationId
- platform
- nativeToken
- permissionState

An explicit installation/device revoke operation for logout is also incomplete.

Decision:

Do not copy legacy notification code.

Create a focused Sprint-1 fix after LR01 to align the Customer app with the
canonical MyPetNew device-registration API and add explicit revoke behaviour.

## nearby realtime / notification code

Classification: REFERENCE_ONLY

Useful future references:

- backend/src/services/fcm.js
- backend/src/socket/gpsTracker.js
- backend/src/socket/orderRoom.js
- backend/src/socket/ioRegistry.js
- delivery assignment notification UI
- shop/customer realtime socket concepts

Do not port during Sprint 1.

These are primarily relevant to a future Captain/dispatch/delivery sprint.

## Deferred Domains

Payment/Cashfree:
REFERENCE_ONLY until an approved later sprint.

Captain dispatch:
REFERENCE_ONLY until an approved later sprint.

Grooming:
REFERENCE_ONLY until an approved later sprint.

Veterinary:
REFERENCE_ONLY until an approved later sprint.

Recurring orders:
REFERENCE_ONLY until an approved later sprint.
