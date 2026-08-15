# T2E Customer Order Detail, Status History & Cancellation

T2E migrates the active Customer order-detail route to customer-owned Spring endpoints for the Sprint-1 pickup lifecycle.

Canonical read: `GET /api/v1/customer/orders/{orderId}`. The authenticated Spring principal must be `CUSTOMER`, and a foreign/guessed order ID returns the same unavailable-resource boundary rather than exposing another customer's order.

Canonical cancel: `POST /api/v1/customer/orders/{orderId}/cancel` with `{ "reason": "..." }` plus `Idempotency-Key`. The server re-checks ownership and delegates to the canonical order transition state machine with actor role `CUSTOMER`; Sprint 1 therefore permits customer cancellation only from `PLACED`. Inventory release and replay/concurrency behavior remain owned by `OrderService`.

The response exposes only canonical Sprint-1 pickup truth needed by the Customer detail screen: order/outlet identity, item IDs/names/quantities, server grand total and platform fee, `STORE_PICKUP`, `PAY_ON_FULFILMENT`, payment status, order status, placed timestamp, and ordered status-history events. The screen does not infer delivery/captain state and does not launch Cashfree for a product order.

The existing broad Orders-tab list query still depends on the restored legacy tracking route because the transaction persistence port currently has no customer-list query primitive. T2E intentionally does not bypass the domain/persistence boundary with ad-hoc SQL. That remaining list-query migration is an explicit integration-gate blocker rather than hidden as fake completion.
