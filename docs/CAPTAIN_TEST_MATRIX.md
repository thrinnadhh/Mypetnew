# MYPETNEW — CAPTAIN TEST ARCHITECTURE & PRODUCTION INVARIANT MATRIX (P7)

## Executive Summary
This document certifies the testing architecture, adversarial contracts, and server-authoritative invariants for the MyPet Captain application and distributed dispatch backend.

All false-positive tests, optimistic UI mocks, and unverified mock assumptions have been eliminated. Every operational mutation is verified across five distinct outcomes: **Success**, **Deterministic Rejection**, **Timeout / Network Loss**, **Retry with Key Invariance**, and **Concurrent Deduplication / Idempotency**.

---

## The 5-Level Test Pyramid

```
                      / \
                     / L5\     Mobile Flow & Negative E2E
                    /-----\    (Injected Timeouts, Truthful UI, Never-Fabricate)
                   /  L4   \   Backend Integration Contracts
                  /---------\  (Kotlin Spring Boot & TypeScript Adversarial Suits)
                 /    L3     \ Durable Command & Crash Recovery Tests
                /-------------\(Process Death, Reconciliation, Double-Tap Coalescing)
               /      L2       \API Client Contract Tests
              /-----------------\(HTTP Envelopes, Bearer Tokens, 401 Refresh, 409 Conflict)
             /        L1         \Pure Unit Tests
            /---------------------\(Domain State Machines, Hashing, Money, Validation)
```

---

## Production Invariant to Test Traceability Matrix

### Level 1: Pure Domain Unit Tests

| Invariant ID | Domain Subject | Invariant Description | Test Suite File | Key Assertions |
| :--- | :--- | :--- | :--- | :--- |
| **INV-U01** | Captain State | Evaluates unauthenticated state if session is missing or unauthenticated. | `level1-unit/state-machines/auth-state-machine.test.ts` | `computeCaptainState(false, ...) === 'UNAUTHENTICATED'` |
| **INV-U02** | Captain State | Suspended status overrides all active flags and enforces terminal lockdown. | `level1-unit/state-machines/auth-state-machine.test.ts` | `status === 'SUSPENDED' -> 'SUSPENDED'` |
| **INV-U03** | Captain State | Draft / incomplete onboarding prevents online operation. | `level1-unit/state-machines/auth-state-machine.test.ts` | `status === 'ONBOARDING' -> 'ONBOARDING_REQUIRED'` |
| **INV-U04** | Offer State | Offer validity strictly bounded by server ISO expiration timestamp. | `level1-unit/state-machines/offer-state-machine.test.ts` | `getRemainingSeconds(past) === 0` |
| **INV-U05** | Delivery State | Forward state transitions are strictly monotonic; backwards transitions are rejected. | `level1-unit/state-machines/delivery-state-machine.test.ts` | `canTransitionDelivery('DELIVERED', 'PICKED_UP') === false` |
| **INV-U06** | Delivery State | UNKNOWN state never regresses a confirmed business state. | `level1-unit/state-machines/delivery-state-machine.test.ts` | `isDeliveryStateMoreAdvanced('UNKNOWN', 'ASSIGNED') === false` |
| **INV-U07** | Command State | Payload fingerprinting uses deterministic 32-bit FNV-1a hashing. | `level1-unit/state-machines/command-state-machine.test.ts` | Hash matches identically across calls; differs across payloads. |
| **INV-U08** | Location State | Operating system permission posture maps safely to domain states. | `level1-unit/state-machines/location-state-machine.test.ts` | `computeLocationPermissionState` matches permission matrix. |
| **INV-U09** | Location State | Geographical coordinates validated within [-90..90, -180..180]; NaN/Infinity rejected. | `level1-unit/state-machines/location-state-machine.test.ts` | `isValidCoordinate` rejects invalid numbers and bounds. |
| **INV-U10** | Money / Currency | Currency calculations use integer paise; floating-point math prohibited. | `level1-unit/utils/money.test.ts` | `formatPaise(7550) === '₹75.50'`, handles zero/null. |
| **INV-U11** | Idempotency | Command keys remain stable across identical invocations; segregated across actions. | `level1-unit/utils/idempotency.test.ts` | `getOrCreateIdempotencyKey` generates and preserves keys. |
| **INV-U12** | Input Validation | Validates Indian mobiles (+91 prefix), 6-digit PIN codes, and 11-char IFSC codes. | `level1-unit/utils/validation.test.ts` | `isValidIndianMobile`, `isValidPinCode`, `isValidIfsc`. |
| **INV-U13** | Privacy Minimization | GPS coordinates, phone numbers, and addresses masked in standard logs. | `level1-unit/utils/privacy.test.ts` | Coordinates masked to 2 decimals; PII masked. |

---

### Level 2: API Client Contract Tests

| Invariant ID | Contract Subject | Invariant Description | Test Suite File | Verified Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **INV-C01** | Headers & Tracing | Every request includes `Accept: application/json` and propagated `X-Trace-Id`. | `level2-api-contracts/api-client-contracts.test.ts` | Verified header assertions on outgoing fetch requests. |
| **INV-C02** | Bearer Token | Bearer token automatically attached from active in-memory session. | `level2-api-contracts/api-client-contracts.test.ts` | `Authorization: Bearer <jwt>` present. |
| **INV-C03** | 401 Token Refresh | Single 401 triggers background refresh and exactly 1 retry with new token. | `level2-api-contracts/api-client-contracts.test.ts` | Retries once; subsequent request succeeds. |
| **INV-C04** | 401 Fail Closed | Refresh rejection (401/403) clears session and aborts pending requests. | `level2-api-contracts/api-client-contracts.test.ts` | Throws `AuthenticationExpired`; cleans memory/storage. |
| **INV-C05** | HTTP 400 / 422 | Client maps 400/422 to non-retryable `ValidationRejected` domain error. | `level2-api-contracts/api-client-contracts.test.ts` | `error.kind === 'ValidationRejected'`, `retryable === false`. |
| **INV-C06** | HTTP 403 | Client maps 403 to non-retryable `AuthorizationDenied` domain error. | `level2-api-contracts/api-client-contracts.test.ts` | `error.kind === 'AuthorizationDenied'`. |
| **INV-C07** | HTTP 404 | Client maps 404 to non-retryable `ResourceNotFound` domain error. | `level2-api-contracts/api-client-contracts.test.ts` | `error.kind === 'ResourceNotFound'`. |
| **INV-C08** | HTTP 408 / Timeout | Client maps 408 / AbortError to retryable `Timeout` domain error. | `level2-api-contracts/api-client-contracts.test.ts` | `error.kind === 'Timeout'`, `retryable === true`. |
| **INV-C09** | HTTP 409 Conflict | Client maps 409 to non-retryable `Conflict` domain error (offer lost). | `level2-api-contracts/api-client-contracts.test.ts` | `error.kind === 'Conflict'`, `retryable === false`. |
| **INV-C10** | HTTP 5xx Server Error | Client maps 500/502/503/504 to retryable `ServerFailure` domain error. | `level2-api-contracts/api-client-contracts.test.ts` | `error.kind === 'ServerFailure'`, `retryable === true`. |
| **INV-C11** | Dispatch Endpoints | Verifies `/offers`, `/respond`, `/:jobId/picked-up`, `/:jobId/delivered`. | `level2-api-contracts/dispatch-api-contract.test.ts` | Exact paths, HTTP methods, body envelopes, and idempotency headers. |
| **INV-C12** | Availability Endpoint | Verifies `/availability` PUT contract with GPS and online/offline payloads. | `level2-api-contracts/availability-api-contract.test.ts` | Accurate PUT serialization with optional headers. |

---

### Level 3: Durable Command & Crash Recovery Tests

| Invariant ID | Failure Mode | Architectural Protection | Test Suite File | Verified Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **INV-D01** | Double-Tap Race | Rapid user double-tap on Action buttons coalesces into 1 execution flight. | `level3-durable-commands/command-runner.test.ts` | Concurrent executions share exact same promise, commandId, and key. |
| **INV-D02** | Network Drop on Send | Unconfirmed mutations persist in durable storage with state `UNKNOWN`. | `level3-durable-commands/command-runner.test.ts` | Saved in `commandStore` before network send; marked `UNKNOWN` on error. |
| **INV-D03** | Key Invariance | 20 consecutive retries of a mutation use the exact same `idempotencyKey`. | `level3-durable-commands/command-runner.test.ts` | `uniqueKeys.size === 1` across 20 retry attempts. |
| **INV-D04** | Process Death (Pickup) | Server committed pickup + client response lost + app reboot -> reconciled. | `level3-durable-commands/reconciliation.test.ts` | Reconciliation detects server `PICKED_UP` and marks command `ACKNOWLEDGED`. |
| **INV-D05** | Process Death (Delivery) | Server committed delivery + client response lost + app reboot -> reconciled. | `level3-durable-commands/reconciliation.test.ts` | Reconciliation detects server `DELIVERED` and marks command `ACKNOWLEDGED`. |
| **INV-D06** | Incomplete Server Commit | Reconciler finds server still in previous state -> replays using same key. | `level3-durable-commands/reconciliation.test.ts` | Retries execution with original `idempotencyKey`. |
| **INV-D07** | Out-of-Order Packets | Slow network packets from earlier states cannot regress advanced state. | `level3-durable-commands/reconciliation.test.ts` | `isDeliveryStateMoreAdvanced('PICKED_UP', 'DELIVERED') === false`. |

---

### Level 4: Backend Integration Contracts

| Invariant ID | Security & Isolation Invariant | Backend Verification Method | Kotlin / TS Test Suite |
| :--- | :--- | :--- | :--- |
| **INV-B01** | Assignment Ownership | Captain can only access and query assignments assigned to their accountId. | Spring MockMvc / DispatchService | `CaptainDeliveryApiTest.kt` |
| **INV-B02** | Foreign Captain Address Isolation | Foreign Captain cannot view customer address or recipient contact. | Spring MockMvc / DispatchService | `CaptainDeliveryApiTest.kt` |
| **INV-B03** | Foreign Captain Mutation Block | Foreign Captain cannot mark another Captain's job as picked up or delivered. | 404 / RESOURCE_NOT_FOUND | `CaptainDeliveryApiTest.kt` & `backend-integration-contracts.test.ts` |
| **INV-B04** | Offer Race Condition | Dispatch offer race between Captains has exactly one winner; loser gets 409. | Postgres / InMemory mutex | `CaptainDeliveryApiTest.kt` & `backend-integration-contracts.test.ts` |
| **INV-B05** | Pickup Idempotency | Replaying pickup confirmation with same key returns identical 200 OK. | Spring MockMvc / DispatchService | `CaptainDeliveryApiTest.kt` & `backend-integration-contracts.test.ts` |
| **INV-B06** | Delivery Idempotency | Replaying delivery confirmation with same key returns identical 200 OK. | Spring MockMvc / DispatchService | `CaptainDeliveryApiTest.kt` & `backend-integration-contracts.test.ts` |
| **INV-B07** | Illegal State Jump Block | Job cannot transition from `ASSIGNED` directly to `DELIVERED` without `PICKED_UP`. | Domain Transition Guard | `backend-integration-contracts.test.ts` |
| **INV-B08** | Suspended Captain Lockdown | Suspended or unapproved Captain is blocked from availability and dispatch. | 403 / AUTHORIZATION_DENIED | `backend-integration-contracts.test.ts` |

---

### Level 5: Mobile Flow, Negative E2E & Mutation Coverage Matrix

#### 1. End-to-End Flow Scenarios
- **Positive E2E Flow** (`positive-delivery-flow.test.ts`):
  1. `login` -> Captain profile loaded (`ACTIVE`, `approved: true`).
  2. `grant location` -> Foreground GPS acquired.
  3. `go online` -> Server availability updated (`online: true`).
  4. `receive offer` -> Polling returns pending offer.
  5. `accept offer` -> Server assigns order, customer address decrypted and revealed.
  6. `navigate pickup` -> Captain arrives at outlet.
  7. `confirm pickup` -> Store PIN verified, job marked `PICKED_UP`.
  8. `navigate customer` -> Captain arrives at customer doorstep.
  9. `confirm delivery` -> Injected timeout after server commit; local state marked `UNKNOWN`.
  10. `reconciliation` -> Reconciler queries server, verifies `DELIVERED`, updates local command to `ACKNOWLEDGED` with 0 duplicate mutations.

- **Negative E2E & Server Authority Guarantee** (`negative-and-recovery-flow.test.ts`):
  - **REQUIRED TEST**: `"captain never fabricates successful business state on network failure"`
    - *Offer Acceptance Drop*: Network disconnects during offer accept -> Outcome is `UNKNOWN`, state remains unassigned, customer address is NEVER fabricated.
    - *Pickup Confirmation Drop*: Network disconnects during pickup -> Outcome is `UNKNOWN`, job remains unconfirmed, `PICKED_UP` is NEVER fabricated.
    - *Delivery Completion Drop*: Server 500 error during delivery -> Outcome is `UNKNOWN`, job remains unconfirmed, `DELIVERED` is NEVER fabricated.
    - *Offline Offer Response*: Tapping accept while offline queues command as `PENDING` without fabricating assignment.

#### 2. Mutation Coverage Matrix

| Mutation Type | Success (`ACKNOWLEDGED`) | Rejection (`REJECTED`) | Timeout / Drop (`UNKNOWN`) | Retry Invariance | Concurrency Deduplication |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `UPDATE_AVAILABILITY` | Verified | Verified (400/403) | Verified | Verified (Same key) | Verified (Coalesced) |
| `ACCEPT_OFFER` | Verified | Verified (409/404) | Verified | Verified (Same key) | Verified (Coalesced) |
| `REJECT_OFFER` | Verified | Verified (400/404) | Verified | Verified (Same key) | Verified (Coalesced) |
| `MARK_PICKED_UP` | Verified | Verified (400/404) | Verified | Verified (Same key) | Verified (Coalesced) |
| `MARK_DELIVERED` | Verified | Verified (400/404) | Verified | Verified (Same key) | Verified (Coalesced) |

---

## Conclusion & Certification
The Captain application and dispatch subsystem are certified against distributed-systems failures, network drops, server crashes, and concurrent race conditions. All business states are strictly server-authoritative.
