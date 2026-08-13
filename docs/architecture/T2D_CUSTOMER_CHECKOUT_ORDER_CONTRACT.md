# T2D Customer Checkout + Order Creation

T2D makes the active live Customer checkout match the Sprint-1 Spring contract.

Live flow: obtain the canonical T2C pickup quote, require its `quoteId` and `cartSignature`, then `POST /api/v1/customer/orders` with only those two fields. Send the authenticated bearer token and `Idempotency-Key: checkout:<quoteId>`. Retrying the same quote reuses that key.

Spring remains authoritative for identity, quote ownership/expiry/signature, outlet state, listing price and availability, inventory reservation, totals, order status, and idempotent replay. The client accepts only `STORE_PICKUP`, `PAY_ON_FULFILMENT`, and initial `PLACED` order responses.

Sprint-1 live checkout exposes store pickup and pay on fulfilment only. Delivery checkout, address gating, UPI/card/Cashfree flows, and client coupon mutation are not active. Demo mode may simulate locally but never sends a demo order.

On failure the cart is retained and a fresh quote is requested. On canonical success the cart is cleared and navigation uses the server-returned order ID. T2E owns order detail/history/cancellation; T2F owns loyalty projection.
