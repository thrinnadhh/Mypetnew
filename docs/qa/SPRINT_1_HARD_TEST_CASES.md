# Sprint 1 Hard Test Contract

Status: **Mandatory release gate; initially NOT RUN**  
Version: **1.0**  
Scope: Sprint 1 walking skeleton  
Applies to: backend, PostgreSQL migrations, Customer app, Merchant app, Captain shell, Admin web shell, workers, and connected E2E

## 1. Gate policy

Sprint 1 is not complete until every applicable Mandatory case below is `PASS` with evidence. `BLOCKED`, `NOT RUN`, flaky rerun, manual assumption, mock-only success, emulator substitution for a physical-device requirement, or disabled assertion is not a pass.

Allowed statuses:

| Status | Meaning |
|---|---|
| `PASS` | expected behavior was observed in the declared production-shaped environment with retained evidence |
| `FAIL` | behavior or invariant was violated |
| `BLOCKED` | test could not execute; blocking dependency and owner recorded |
| `NOT_RUN` | no evidence exists |
| `NOT_APPLICABLE` | Product + Engineering + QA documented why the requirement truly does not apply |

No integrity/security case may be waived into production by changing it to `NOT_APPLICABLE` after failure.

## 2. Evidence contract

Each test result records:

- test ID, commit SHA, UTC timestamp, environment, database migration version;
- test runner/device/app build identifier;
- setup/fixture IDs containing no secrets or real customer data;
- expected and observed result;
- logs/traces/queries/screenshots or video as relevant;
- cleanup/reconciliation result;
- issue/owner for failure or blocker.

Physical barcode evidence also records Android model, OS, camera permission state, orientation, network state, app build, barcode symbology, and lighting/focus condition.

## 3. Production-shaped test environment

- clean PostgreSQL created solely from committed Flyway migrations;
- repeat upgrade from the previous Sprint 1 schema checkpoint;
- Redis/worker/outbox configuration matching intended topology;
- real cryptographic signing and production code paths with sandbox OTP/provider adapters only at external boundaries;
- no direct database mutation during a business-flow test except fixture setup and explicit verification;
- separate Merchant A/outlet A, Merchant B/outlet B, Customers A/B, Staff A limited/full, Admin permissions, products, and view-only medicine fixtures;
- deterministic clock support for expiry tests without changing production semantics;
- network fault and process-restart controls;
- at least one physical Android device for Merchant scanner/permission/offline cases.

## 4. Architecture and repository gates

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-ARC-001 | Build the repository from a clean checkout with documented JDK/Node/package-manager versions. | One command path builds backend and all four clients; lockfiles/toolchains are honored; no uncommitted generated dependency is required. |
| S1-ARC-002 | Run module architecture fitness tests. | No cyclic domain dependency, cross-module repository/entity import, or forbidden dependency direction. |
| S1-ARC-003 | Scan public controller signatures and serialization. | No JPA entity, provider SDK object, OTP/proof secret, internal audit row, or unbounded generic map is returned. |
| S1-ARC-004 | Search compiled/source client bundles and configuration for service secrets, test credentials, production bypass flags, and real tokens. | No secret or privileged key is present; only intended public configuration exists. |
| S1-ARC-005 | Start production-profile clients/backend without required configuration. | Startup fails clearly; it does not fall back to mock API, demo identity, fixture catalog, fake scanner, in-memory database, or unsigned authorization. |
| S1-ARC-006 | Run formatting, lint, typecheck, Kotlin compile, backend tests, client tests, secret scan, dependency scan, and migration validation. | All required commands pass; warnings configured as blocking remain zero. |
| S1-ARC-007 | Inspect all monetary fields and calculations through static/contract tests. | Money is integer paise + INR; no float/double/JavaScript fractional arithmetic crosses a transaction contract. |
| S1-ARC-008 | Generate/compare API contracts and clients twice from the same source. | Deterministic output and no unexplained contract drift between apps. |
| S1-ARC-009 | Call collection endpoints without/with excessive page size. | Bounded default and maximum page size; stable pagination; no unbounded response. |
| S1-ARC-010 | Trigger a validation, conflict, unauthorized, forbidden, not-found, rate-limit, and internal failure. | Stable error envelope/code/trace ID; no stack trace, SQL, secret, or internal exception message exposed. |

## 5. Identity, OTP, sessions, roles, and permissions

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-AUTH-001 | Browse public catalog with no token. | Only active public DTO fields are returned; account/order/loyalty/private provider data remains inaccessible. |
| S1-AUTH-002 | Request OTP for existing and unknown mobile numbers and compare response/timing class. | Enumeration-resistant response; no account existence disclosure. |
| S1-AUTH-003 | Exceed OTP request/verification limits across mobile, device/session, and IP dimensions. | Bounded rate limit and retry response; no challenge flood or bypass. |
| S1-AUTH-004 | Submit wrong, expired, reused, wrong-purpose, or wrong-mobile OTP. | No session; generic safe failure; attempt/audit state updated without logging OTP. |
| S1-AUTH-005 | Race two verifications of one valid OTP. | At most one challenge consumption; session policy is deterministic; no duplicated onboarding side effect. |
| S1-AUTH-006 | Refresh a session, then replay the previous refresh token. | Rotation/reuse policy revokes or rejects as designed; no parallel unauthorized session chain. |
| S1-AUTH-007 | Sign out/revoke device, then reuse access/refresh tokens after allowed propagation. | Protected access rejected; app clears role data. |
| S1-AUTH-008 | Modify client route/state or token claim from CUSTOMER to MERCHANT/CAPTAIN/ADMIN. | Server denies protected operation; client guard is not relied on. |
| S1-AUTH-009 | Call each Sprint 1 command with every wrong canonical role. | Deny by default with no data mutation or target existence leak. |
| S1-AUTH-010 | Admin lacking specific permission attempts provider approval, sensitive read, and access-management action. | Forbidden; no partial state/audit spoof. Correct permission succeeds and is audited. |
| S1-AUTH-011 | Replay an old token after Merchant/Staff/Captain/Admin suspension or permission removal. | Newly protected command denied according to revocation policy; no stale authorization. |
| S1-AUTH-012 | Run automated log/crash/analytics scan after OTP/session tests. | No OTP, authorization header, refresh token, full mobile, or sensitive session payload appears. |

## 6. Merchant organization, outlet, and tenant isolation

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-TEN-001 | Merchant A guesses Merchant B organization/outlet/listing/stock/order/POS/loyalty UUIDs in read endpoints. | Not found/forbidden without foreign data or existence detail. |
| S1-TEN-002 | Merchant A sends Merchant B outlet ID in create/update request body. | Server derives ownership, rejects target, and creates nothing. |
| S1-TEN-003 | Limited Staff A attempts catalog, stock, POS, loyalty, or order command outside granted outlet/permission. | Each unauthorized action denied independently; permitted action remains scoped. |
| S1-TEN-004 | Batch endpoint mixes authorized and foreign IDs. | Entire command fails or returns explicitly safe per-item denials; no foreign mutation/data. |
| S1-TEN-005 | Merchant is `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `REJECTED`, or `SUSPENDED` and attempts transact/discover. | Only allowed onboarding/read actions; no public discovery, listing transaction, POS, order fulfilment, or loyalty grant. |
| S1-TEN-006 | Admin approves an application twice or replays approval after state changed. | One transition/audit/notification; replay returns same result or stable conflict. |
| S1-TEN-007 | Merchant changes service PIN codes while Customers hold quotes. | Existing quote invalidates/revalidates by version; stale quote cannot bypass current policy. |
| S1-TEN-008 | Enter invalid PIN codes: short/long, alphabetic, leading/trailing space, SQL/meta characters, duplicates. | Only normalized six-digit values stored; invalid entries get field errors; duplicates collapse safely. |
| S1-TEN-009 | Suspend outlet after listing browse and before quote/order/POS. | New transactional commands fail closed; existing records remain readable to authorized actors. |
| S1-TEN-010 | Attempt mass assignment of status, admin approval, merchant ID, outlet ID, staff permissions, fee rule, or audit actor. | Server ignores/rejects protected fields and derives authority from authenticated context. |

## 7. Barcode onboarding and scanner

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-BAR-001 | Validate known correct/incorrect GTIN-8, GTIN-12/UPC-A, GTIN-13/EAN-13, and GTIN-14 values. | Correct check digits accepted with preserved leading zeros; incorrect values rejected. |
| S1-BAR-002 | Scan codes containing permitted spaces/hyphens and codes containing control/unicode-confusable/overlong/HTML/SQL payloads. | Permitted separators normalize deterministically; dangerous/unsupported input is rejected and not executed/rendered unsafely. |
| S1-BAR-003 | Submit a numeric barcode through a path that could use floating-point/scientific notation. | Contract requires string; leading zeros retained; scientific notation rejected. |
| S1-BAR-004 | Submit unsupported symbology or an internal code as GTIN and vice versa. | Explicit type validation; no silent reinterpretation. |
| S1-BAR-005 | Scan one valid unknown barcode at active Outlet A and complete listing creation. | One merchant-owned listing/barcode/history created; price/stock not inferred from scan. |
| S1-BAR-006 | Scan existing Outlet A barcode. | Existing authorized listing returned; no duplicate draft/listing. |
| S1-BAR-007 | Send 20 rapid identical frames and concurrent resolve/create retries with same/different action keys. | Debounced client behavior plus database uniqueness/idempotency produce one listing; safe existing result/conflicts. |
| S1-BAR-008 | Create same normalized barcode again in Outlet A with alternate formatting/type alias. | Duplicate blocked at database/domain boundary. |
| S1-BAR-009 | Create the same normalized barcode at Merchant B Outlet B. | Independent listing succeeds; no Merchant A price, stock, sales, or identity leaks. |
| S1-BAR-010 | Unauthorized Staff, Customer, Captain, or wrong-outlet Merchant scans/resolves private barcode endpoint. | Access denied; no listing existence or fields leaked. |
| S1-BAR-011 | Unknown barcode listing creation times out after server commit and client retries. | Idempotency returns original listing; no duplicate. |
| S1-BAR-012 | Camera permission is accepted on physical Android. | Scanner opens, reads supported code, pauses after capture, resolves once, and exposes accessible feedback. |
| S1-BAR-013 | Camera permission denied once, denied permanently, and camera unavailable. | No crash/prompt loop; manual entry works; permanent denial offers settings recovery. |
| S1-BAR-014 | Background/foreground app, rotate screen, navigate away/back, and lock/unlock during scan. | Camera resources release/resume safely; no ghost scans, duplicate actions, or permission loop. |
| S1-BAR-015 | Scan under poor focus/low light/partial frames and rapidly alternate two barcodes. | No false listing creation; user can retry; distinct validated captures remain distinct. |
| S1-BAR-016 | Go offline after capture, queue authorized action, kill/restart app, then reconnect. | Bounded queue persists safely; one replay; expired auth requires re-auth; final server state reconciles. |
| S1-BAR-017 | While offline action waits, another device creates/updates the listing. | Replay returns existing/conflict and requires refresh; no overwrite or duplicate. |
| S1-BAR-018 | Try to create medicine barcode listing without capability, then with approved capability. | First denied; second forced to `VIEW_ONLY`; commerce flags cannot be mass-assigned. |

## 8. Listing and inventory integrity

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-INV-001 | Create product listing with negative price/stock, selling price over MRP, invalid tax, invalid manufacture/expiry order, expired active batch, or oversized text/media metadata. | Field-specific rejection; no partial listing/barcode. |
| S1-INV-002 | Receive stock once, then replay the same idempotency key/request. | One movement and one quantity increase; replay returns original result. |
| S1-INV-003 | Reuse same idempotency key with a different quantity/listing. | Fingerprint mismatch conflict; no second mutation. |
| S1-INV-004 | Attempt decrement/adjustment below zero through every command and direct API combination. | Domain/database invariant blocks negative available/on-hand stock. |
| S1-INV-005 | Run 50 concurrent pickup-order reservations for one remaining unit. | Exactly one succeeds; 49 stable stock conflicts; final stock/reservation ledger reconciles. |
| S1-INV-006 | Race final unit between POS completion and customer order reservation. | Exactly one consumer wins; other fails without sale/order/loyalty partial effect. |
| S1-INV-007 | Race two POS completions for final unit. | Exactly one completed sale/movement; loser has no receipt/star. |
| S1-INV-008 | Cancel/reject same reserved order concurrently/repeatedly. | Reservation releases once; stock does not over-increment. |
| S1-INV-009 | Start count, perform sale/reservation on another device, then submit count with stale expected version. | Defined conflict/snapshot policy; no silent overwrite of valid movement. |
| S1-INV-010 | Replay entire count batch after timeout/worker restart. | One adjustment set and same count result. |
| S1-INV-011 | Count includes duplicate listing lines, foreign listing, inactive listing, or omitted counted item. | Deterministic validation/variance policy; no foreign or unintended zeroing. |
| S1-INV-012 | Query stock history with pagination/filter/order boundaries. | Stable bounded ordering; movements include reason/source/actor/result and no foreign tenant rows. |
| S1-INV-013 | Inject failure between inventory aggregate write, history, and outbox in transaction. | All commit or all roll back; no balance without history/event. |
| S1-INV-014 | Inject outbox publication failure after database commit and restart worker. | Durable event eventually publishes once effectively; aggregate remains correct. |
| S1-INV-015 | Deactivate/suspend listing/outlet while reserved order and POS cart exist. | New POS/order action blocks; existing reservation follows explicit order policy; no disappearing history. |

## 9. Customer cart, quote, pickup order, and Merchant fulfilment

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-ORD-001 | Add first Outlet A listing, then Outlet B listing through normal UI. | Explicit merchant conflict; no silent split/merge/replacement. |
| S1-ORD-002 | Bypass UI and post mixed-outlet cart lines. | `CART_MULTIPLE_OUTLETS`; no partial cart mutation. |
| S1-ORD-003 | Merge guest and authenticated carts for same outlet with overlapping quantities beyond stock/limit. | Deterministic bounded merge or conflict; no oversize invalid cart. |
| S1-ORD-004 | Merge guest and authenticated carts from different outlets. | Explicit Customer choice; no server-selected merchant. |
| S1-ORD-005 | Put `VIEW_ONLY` medicine in cart using direct API, stale cart row, altered type, or copied product ID. | Every server path rejects/removes with clear non-commerce status; no quote/order/reservation. |
| S1-ORD-006 | Alter client price, discount, tax, ₹10 platform fee, ₹10 commission, total, merchant ID, or stock. | Server ignores/rejects client authority and uses canonical values. |
| S1-ORD-007 | Quote pickup for active pickup outlet outside Merchant delivery PIN codes. | Pickup quote succeeds without delivery fee/PIN serviceability. |
| S1-ORD-008 | Quote pickup when outlet pickup disabled/inactive/suspended. | Quote rejected; no stale browse state bypass. |
| S1-ORD-009 | Change price/stock/listing/merchant config after quote, then checkout. | Quote version/signature validation rejects or re-quotes; old total cannot transact. |
| S1-ORD-010 | Expire quote using controlled clock and attempt checkout. | `QUOTE_EXPIRED`; no order/reservation/instrument effect. |
| S1-ORD-011 | Submit checkout twice concurrently with same idempotency key and request. | One order/reservation/history; both callers converge on same result. |
| S1-ORD-012 | Submit same checkout key with different cart/quote/customer context. | Fingerprint mismatch conflict; no second order. |
| S1-ORD-013 | Inject database failure after order insert but before items/reservation/history/outbox. | Transaction rolls back fully or deterministic recovery produces complete aggregate; no orphan. |
| S1-ORD-014 | Verify pricing snapshot for representative discounts/tax boundaries and maximum supported amounts. | Exact paise reconciliation; customer total includes ₹10 platform fee; merchant settlement contains ₹10 commission; no overflow/rounding drift. |
| S1-ORD-015 | Merchant B or unauthorized Staff reads/transitions Outlet A order. | No access/existence leak or history mutation. |
| S1-ORD-016 | Perform every illegal lifecycle transition, skip, repeat, and backward move. | Stable conflict; state/history/outbox unchanged. |
| S1-ORD-017 | Race Customer cancellation with Merchant acceptance. | One deterministic winner; reservation/history/projections reconcile; loser refreshes canonical state. |
| S1-ORD-018 | Replay reject/cancel/accept/prepare/ready/pickup-complete command after timeout. | Same effect/result; no duplicate history, release, fee, or notification. |
| S1-ORD-019 | Fetch canonical Customer and Merchant order DTOs and compare source identifiers/history/pricing. | Same order truth, role-safe fields, no raw entity/internal/foreign/customer overexposure. |
| S1-ORD-020 | Restart backend/worker/apps at each state and resume. | Canonical server state restores; clients do not invent/reset progress; queued outbox effects converge. |

## 10. POS completion and receipt

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-POS-001 | Scan known active outlet barcode with stock. | Live canonical listing, price, stock, and variant returned; no cached foreign data. |
| S1-POS-002 | Scan unknown, inactive, foreign, expired-batch, out-of-stock, or view-only medicine barcode in POS. | Safe distinct error/action; no sale line or bypass. |
| S1-POS-003 | Alter POS line price/tax/discount/quantity/outlet/cashier in request. | Server authorizes and reprices; protected fields rejected/ignored. |
| S1-POS-004 | Complete anonymous eligible-value POS sale. | Sale/stock/receipt completes; no customer star or balance lookup. |
| S1-POS-005 | Associate Customer using valid short-lived consent challenge. | Association succeeds once with minimal data; eligible completion may award star. |
| S1-POS-006 | Associate by typed mobile without Customer proof or use expired/replayed/wrong-merchant challenge. | Association/loyalty denied; no account existence/balance leak. |
| S1-POS-007 | Complete CASH, EXTERNAL_UPI, and CARD_TERMINAL declaration paths. | Receipt labels declaration accurately; no Cashfree payment `SUCCEEDED` record fabricated. |
| S1-POS-008 | Complete sale twice concurrently/replay after response loss. | One sale, items, receipt, movement, and loyalty source. |
| S1-POS-009 | Reuse completion key with changed cart/customer/payment declaration. | Fingerprint conflict; no mutation. |
| S1-POS-010 | Inject failure before transaction commit. | No sale, movement, receipt, or loyalty effect. |
| S1-POS-011 | Inject failure after sale transaction commit but before loyalty consumer/notification, then restart. | Sale/stock remains; outbox replay creates exactly one eligible loyalty effect and notification. |
| S1-POS-012 | Void/refund endpoint is called before Sprint policy exists or by unauthorized staff. | Fail closed; no ad hoc stock/star mutation. |
| S1-POS-013 | Render/print/reload receipt. | Same immutable sale reference and exact paise/merchant/outlet/items/payment declaration/loyalty result; no secret/customer excess. |
| S1-POS-014 | POS app goes offline before live resolve/completion. | No unverified completion; UI explains offline. Only explicitly designed queued scan/count actions persist. |
| S1-POS-015 | Cashier session permission removed while POS cart open. | Completion denied at server; no stale-permission sale. |

## 11. Loyalty, onboarding star, minimum spend, and reward integrity

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-LOY-001 | Complete authenticated two-party onboarding challenge once. | Exactly one `ONBOARDING` star in customer/merchant ledger. |
| S1-LOY-002 | Replay, scan twice, use two outlets of same merchant, or race confirmations for onboarding. | Still one onboarding source/star per customer + merchant organization. |
| S1-LOY-003 | Merchant attempts phone-only/manual arbitrary star or direct balance edit. | No endpoint/authorization path; action denied/audited. |
| S1-LOY-004 | Use onboarding challenge for wrong customer, merchant, outlet, purpose, after expiry, or after use. | Rejected with no source/balance leak. |
| S1-LOY-005 | Customer receives onboarding stars at Merchant A and Merchant B. | Independent merchant-specific balances each allow one. |
| S1-LOY-006 | Complete associated POS sale at exactly ₹100 default minimum. | One star. |
| S1-LOY-007 | Complete associated POS sale at ₹99.99 and at ₹100.01. | Below threshold earns none with explanation; above earns exactly one. |
| S1-LOY-008 | Merchant changes minimum while sale/quote is open. | Effective configuration version is deterministic and snapshotted; no retroactive history change. |
| S1-LOY-009 | Complete multi-item/high-quantity sale above minimum. | One star per sale, not per item/quantity/value. |
| S1-LOY-010 | Replay POS/order completion event 100 times and concurrently. | One ledger source/effect due to inbox + database uniqueness. |
| S1-LOY-011 | Anonymous POS sale then later attach a phone/customer through an unsupported path. | No retroactive star unless an explicit future audited policy exists; Sprint 1 denies. |
| S1-LOY-012 | Build customer with 9 available stars and race two eligible completions. | Two source stars recorded; exactly one ten-star reward issued; one remainder star. |
| S1-LOY-013 | Race multiple workers/processes on the tenth source. | Ten stars consumed once and one reward; no negative/duplicate consumption. |
| S1-LOY-014 | Verify reward amount uses merchant flat-value config version and expires at exactly 90 days. | Immutable issued amount/version/expiry; boundary behavior uses server clock. |
| S1-LOY-015 | Full-reverse an unconsumed source star. | One reversal; repeated reversal is idempotent; balance correct. |
| S1-LOY-016 | Reverse a source whose star was consumed into unused/redeemed reward. | Explicit cancel/recompute or star-debt policy executes; no history rewrite or negative unexplained balance. |
| S1-LOY-017 | Customer/Merchant B/Admin without permission reads Merchant A detailed loyalty history. | Role-safe denial/redaction; Customer sees own explainable history only. |
| S1-LOY-018 | Sum ledger entries, derived balance, consumed stars, debt, and rewards after all above tests. | Conservation equation reconciles exactly; no orphan reward/source/debt. |

## 12. Security and privacy adversarial gates

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-SEC-001 | Automated IDOR matrix across all Sprint 1 resources and roles. | No unauthorized read/write/existence leakage. |
| S1-SEC-002 | Injection corpus against search, barcode, names, notes, reasons, PIN codes, idempotency keys, headers, and pagination. | Parameterized/safe handling; no SQL/command/template/log injection. |
| S1-SEC-003 | Stored/reflected XSS corpus rendered in Admin/Customer/Merchant web-capable surfaces. | Encoded/sanitized output; CSP/security headers as designed; no execution. |
| S1-SEC-004 | Oversized/deep JSON, huge quantities/money, integer overflow, negative/zero edge values, malformed content type. | Bounded rejection before resource exhaustion or arithmetic corruption. |
| S1-SEC-005 | Credential stuffing/rate tests for OTP, login/session, barcode resolve, checkout, POS, onboarding challenge, and Admin actions. | Purpose-appropriate layered limits and safe audit/alerts; legitimate recovery remains possible. |
| S1-SEC-006 | CORS/preflight and browser credential requests from unapproved origin; CSRF attempt against Admin web. | Origin/CSRF policy blocks unsafe request; no wildcard credential exposure. |
| S1-SEC-007 | Use expired/revoked/incorrect audience/issuer/signature token and unsigned token. | Authentication rejected; no unsafe development mode in production profile. |
| S1-SEC-008 | Inspect database/API/logs/traces/analytics/crash data for full mobile, OTP, token, sensitive documents, or unnecessary PII. | Minimization/redaction policy holds; secrets absent. |
| S1-SEC-009 | Attempt to enumerate customers through POS association, onboarding, loyalty lookup, OTP, or error differences. | No account/balance/profile disclosure before consent/auth. |
| S1-SEC-010 | Dependency, secret, SAST, container, and IaC scans. | No unaccepted Critical/High issue; suppressions have owner/rationale/expiry. |
| S1-SEC-011 | Admin sensitive command without step-up/reason/idempotency/audit context. | Denied; correct complete command succeeds and audits actor/permission/reason/target/trace. |
| S1-SEC-012 | Delete/deactivate customer/merchant while financial/audit records exist. | Retention/anonymization policy preserves legal/integrity records; no cascading loss/cross-tenant damage. |

## 13. Mobile, accessibility, offline, and low-network gates

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-MOB-001 | Run Customer/Merchant/Captain apps on supported Android versions and one low-memory device profile. | Launch/navigation/session restore without crash or role crossover. |
| S1-MOB-002 | Test 100%, 150%, and 200% font scaling on critical Sprint 1 screens. | No clipped critical value/action; scroll/focus remains usable. |
| S1-MOB-003 | Screen-reader pass for OTP, catalog, cart, quote, order, barcode scanner/manual entry, stock, POS, and loyalty. | Meaningful labels/roles/hints/order; status not conveyed only by color/icon. |
| S1-MOB-004 | Keyboard, focus, validation, and input-type pass on forms. | Focus reaches every control; field errors announced/associated; no keyboard-hidden primary action. |
| S1-MOB-005 | Verify 48dp targets, contrast, reduced motion, landscape/small screen, safe areas, and system dark mode policy. | Critical flows remain operable and legible. |
| S1-MOB-006 | Simulate slow, intermittent, offline, DNS failure, timeout, and response loss at each command boundary. | Explicit loading/offline/retry/conflict states; no duplicate business effect. |
| S1-MOB-007 | Kill app after command send but before response, then restart. | App reloads canonical result or retries idempotently; no fabricated failure/success. |
| S1-MOB-008 | Deep-link into protected Customer/Merchant/Captain/Admin route while signed out/wrong role. | Correct auth/role guard; destination resumes only after authorized login. |
| S1-MOB-009 | Remove camera permission in OS while scanner screen active. | Safe error/manual fallback; no crash or fake scan. |
| S1-MOB-010 | Fill device storage/trigger low-memory background termination during offline queue. | Bounded safe failure/recovery; no corrupted queue or duplicated replay. |
| S1-MOB-011 | Inspect network/cache/storage on device after logout. | Tokens use secure storage and are cleared/revoked; role/PII/business data not exposed in plain persistent cache beyond policy. |
| S1-MOB-012 | Measure critical screen/API payload and render performance under pilot dataset. | Meets declared budgets or has blocking evidence/issue; no unbounded list or UI freeze. |

## 14. Database, worker, audit, observability, and recovery gates

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-OPS-001 | Apply migrations to empty database. | Clean schema starts successfully with constraints/indexes/ownership. |
| S1-OPS-002 | Upgrade from prior Sprint 1 checkpoint, run twice as intended, and validate schema drift. | Deterministic supported upgrade; no destructive surprise or drift. |
| S1-OPS-003 | Verify unique/check/foreign-key/concurrency constraints directly with invalid writes in test database. | Database backs critical tenant/barcode/idempotency/stock/source invariants. |
| S1-OPS-004 | Stop worker after claim/before effect/after effect-before-ack and restart. | Inbox/idempotency converges to one effective side effect; retry/dead-letter visible. |
| S1-OPS-005 | Create poison event and backlog while transactions continue. | Bounded retry/dead letter; transaction path remains correct; alert fires. |
| S1-OPS-006 | Validate audit completeness for provider approval, listing/barcode, stock, order, POS, loyalty, Admin permission action. | Actor/role/source/target/reason/time/trace/idempotency recorded; secrets absent; audit immutable to ordinary roles. |
| S1-OPS-007 | Trace one connected E2E from OTP through POS loyalty and one through pickup order. | Trace/request/idempotency/source IDs connect safe logs, histories, outbox, and metrics. |
| S1-OPS-008 | Force stock conflict, OTP abuse, tenant attack, outbox backlog, duplicate loyalty source, and invalid medicine commerce. | Expected metrics/security/business alerts emit without customer PII. |
| S1-OPS-009 | Backup Sprint 1 database, restore to isolated environment, run reconciliation and smoke flow. | Restored aggregates/ledgers/history/idempotency/outbox are consistent and usable. |
| S1-OPS-010 | Reconcile orders/items/reservations/movements, POS/items/movements, and loyalty sources/ledger/rewards. | Zero unexplained mismatch; reconciliation query/report retained. |

## 15. Connected end-to-end certification

| ID | Scenario/action | Mandatory expected result |
|---|---|---|
| S1-E2E-001 | From clean install, Admin approves Merchant A outlet; Merchant scans unknown valid barcode, creates product, and receives stock. | All four authority/audit boundaries and physical scan evidence pass. |
| S1-E2E-002 | Guest Customer browses product, authenticates with OTP, retains compatible cart, gets pickup quote, and creates pay-on-fulfilment order. | One canonical order/reservation/fee snapshot; exact ₹10 customer platform fee and ₹10 merchant commission ledger component. |
| S1-E2E-003 | Merchant accepts, prepares, marks ready, verifies customer pickup/completion; Customer sees same history. | Legal transitions only; reservation/stock/receipt/fee/loyalty policy reconcile; no client-invented step. |
| S1-E2E-004 | Merchant performs customer-associated eligible POS sale by physical barcode. | One sale/receipt/movement and exactly one Merchant A loyalty star. |
| S1-E2E-005 | Customer and Merchant complete onboarding challenge repeatedly/across two Merchant A outlets. | Only one onboarding star for Merchant A; Merchant B relationship remains independent. |
| S1-E2E-006 | Merchant B creates same barcode and transacts own stock while attacking Merchant A IDs. | Independent data/economics; every foreign read/write denied. |
| S1-E2E-007 | At injected timeout/restart points, repeat checkout, Merchant transition, POS completion, stock adjustment, onboarding confirmation, and worker events. | Same final results as uninterrupted run; no duplicate or missing money/stock/order/sale/star/history. |
| S1-E2E-008 | Publish view-only medicine and attempt commerce through every Customer/Merchant direct path. | Discovery works; cart, quote, order, recurring placeholder, and POS are server-blocked and security-observed. |

## 16. Sprint 1 pass matrix

The CI/evidence summary must expose at least these independent gates:

| Gate | Blocking content |
|---|---|
| Backend clean build | compilation, unit/domain, architecture, static checks |
| Database integration | Flyway clean/upgrade, constraints, repositories, transaction/race tests |
| API contracts | DTO/error/auth/idempotency/pagination and generated-client drift |
| Customer app | typecheck/lint/tests/accessibility contracts/connected checkout |
| Merchant app | typecheck/lint/tests/scanner/POS/loyalty/offline contracts |
| Captain/Admin shells | typecheck/lint/role guards/no production mocks |
| Physical scanner QA | device permission, scanning, lifecycle, offline/restart evidence |
| Connected E2E | S1-E2E-001 through S1-E2E-008 |
| Security/privacy | S1-SEC matrix, scans, redaction, tenant/role tests |
| Recovery/observability | worker replay, backup restore, reconciliation, trace/metrics/alerts |
| Traceability | every Sprint 1 PRD ID/ticket/test/evidence link complete |

## 17. Final certification record

The Sprint 1 release-candidate record contains:

- commit and immutable build identifiers;
- all gate results and evidence links;
- zero open Critical/High integrity, security, privacy, tenant, barcode, stock, order, POS, or loyalty defect;
- explicitly documented lower-severity risks with owner/date;
- Product, Engineering, QA, and Security sign-off;
- clear statement: `SPRINT 1 CERTIFIED` or `SPRINT 1 NOT CERTIFIED`.

Anything else is informational, not certification.

