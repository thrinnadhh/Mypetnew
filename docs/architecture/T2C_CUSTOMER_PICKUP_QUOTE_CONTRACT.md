# T2C — Customer Pickup Quote Runtime Contract

Status: implementation contract for `trial/t2c-customer-quote`.

## Scope

T2C migrates the active Customer quote request from the restored MyPet checkout quote protocol to the canonical MyPetNew Sprint-1 pickup quote API. It does not redesign backend quote semantics and does not migrate order creation, order history/detail/cancellation, loyalty, delivery, online payment, recurring orders, grooming, or veterinary flows.

T2D owns canonical order creation and the remaining checkout control-surface cleanup. Until T2D is merged, the legacy order-creation function is intentionally unchanged; T2C must not make the quote itself depend on that legacy request contract.

## Canonical endpoint

Authenticated Customer request:

`POST /api/v1/customer/quotes/pickup`

Request body:

```json
{
  "outletId": "<uuid>",
  "lines": [
    { "listingId": "<uuid>", "quantity": 1 }
  ]
}
```

The Customer runtime must not send `customerId`, delivery address, city/coordinates, coupon, loyalty reward, payment-method choice, delivery-mode choice, or client prices to this endpoint. Customer identity comes only from the authenticated Spring principal. Listing price and stock come only from the Spring backend.

## Server authority

`CustomerCommerceApiController.quote` is authoritative for:

- authenticated `CUSTOMER` role;
- active pickup-enabled `PRODUCT_STORE` outlet eligibility;
- listing/outlet ownership match;
- `COMMERCE` listing mode;
- positive quantity;
- currently available inventory;
- duplicate-line rejection;
- quoted unit price from the current listing selling price.

`QuoteService` is authoritative for:

- quote ID;
- customer/outlet binding;
- cart signature;
- `STORE_PICKUP` fulfilment;
- `PAY_ON_FULFILMENT` payment;
- pricing snapshot in paise;
- Sprint-1 platform fee;
- zero delivery fee;
- currency/rule version;
- expiry.

The current Sprint-1 quote lifetime is five minutes. The Customer must treat `expiresAt` as server truth.

## Canonical response consumed by Customer

The runtime consumes the backend `Quote` fields:

- `id`
- `customerId`
- `outletId`
- `lines`
- `cartSignature`
- `fulfilmentMode`
- `paymentMethod`
- `pricing.itemSubtotalPaise`
- `pricing.itemDiscountPaise`
- `pricing.couponDiscountPaise`
- `pricing.loyaltyRewardPaise`
- `pricing.taxPaise`
- `pricing.platformFeePaise`
- `pricing.deliveryFeePaise`
- `pricing.merchantCommissionPaise`
- `pricing.grandTotalPaise`
- `pricing.currency`
- `pricing.ruleVersion`
- `expiresAt`

Paise-to-rupee conversion is presentation compatibility only. `grandTotalPaise` remains the authoritative payable total.

The restored checkout UI still consumes a compatibility-shaped quote view. T2C may project canonical pricing into that view, but it must not recalculate the total, invent discounts, or send compatibility-only fields back to the server.

## Fail-closed invariants

The Customer quote adapter must reject responses whose Sprint-1 contract claims anything other than:

- `fulfilmentMode === STORE_PICKUP`
- `paymentMethod === PAY_ON_FULFILMENT`
- `pricing.currency === INR`

Pricing values must be finite before presentation conversion.

Backend `ApiError` responses must propagate through the shared `apiClient`; T2C must not replace stable server error codes with a local success fallback.

## Explicitly deferred to T2D

T2C does **not** certify order placement. T2D must replace the legacy `/api/v1/orders` request with canonical:

`POST /api/v1/customer/orders`

using exactly the server-issued `quoteId`, `cartSignature`, and an idempotency key. T2D must also remove live delivery/UPI/card/coupon controls that are outside Sprint-1 pickup + `PAY_ON_FULFILMENT` semantics.

## Acceptance gates

T2C is acceptable only when all of the following are true:

1. Active Customer quote code calls `/api/v1/customer/quotes/pickup`.
2. Wire request contains only `outletId` and `{ listingId, quantity }` lines.
3. No client price, customer ID, delivery location, coupon, loyalty, or payment selection is sent to the quote API.
4. Quote ID and cart signature are retained for T2D.
5. Server pricing is mapped without recomputation; platform fee and grand total are preserved.
6. `STORE_PICKUP`, `PAY_ON_FULFILMENT`, and INR are fail-closed.
7. Shared `apiClient` owns authentication/error behavior.
8. Backend quote/order contracts and persistence are untouched.
9. Targeted tests prove canonical route, exact request shape, authoritative pricing conversion, and retained quote/signature.
10. Existing Customer typecheck/lint/Jest and backend verification remain green.
