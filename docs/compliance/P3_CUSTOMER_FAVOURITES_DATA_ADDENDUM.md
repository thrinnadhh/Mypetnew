# P3 Customer favourites data addendum

Status: implementation evidence for the focused P3 listing-favourites slice.

## Data introduced

`mypet.customer_favourite_listing` stores only:

- authenticated Customer account UUID (`customer_id`)
- canonical merchant listing UUID (`listing_id`)
- server timestamp (`created_at`)

It does not store free text, phone/email, address, location, barcode, price, payment data, analytics identifiers, or a duplicate product snapshot.

Classification: `CONFIDENTIAL` Customer purchase/preference signal. The listing itself remains merchant-owned catalog data; the Customer↔listing association is Customer personal data.

## Purpose and authority

Purpose: allow a signed-in Customer to save and later retrieve product listings. Customer identity is derived exclusively from the authenticated Spring principal. The API does not accept `customerId` from the client.

The focused P3 server contract is listing-only:

- `GET /api/v1/customer/favourites?page&pageSize`
- `PUT /api/v1/customer/favourites/{listingId}`
- `DELETE /api/v1/customer/favourites/{listingId}`

`PUT` and `DELETE` are idempotent. Unknown listings and listings whose outlet is not active fail closed. Cross-Customer delete/list access is prevented by the composite `(customer_id, listing_id)` persistence key and authenticated-principal ownership.

## Retention and deletion

Retention: until the Customer removes the favourite or deletes the account. There is no independent legal-retention requirement for the preference record in the current product contract.

Account deletion calls `CustomerFavouriteService.eraseAll(customerId)` before the existing privacy deletion lifecycle disables the account, revokes sessions/devices and erases direct identifiers. The erasure operation is idempotent to keep deletion retries safe. After the server confirms account deletion, the Customer app removes both the current and legacy favourites AsyncStorage keys before finishing local sign-out; a local storage failure is logged while sign-out still proceeds because the server-side deletion is already irreversible.

## Client storage boundary

Guest product favourites may exist in Customer-app AsyncStorage as local preference state. On authenticated startup they are deterministically merged into the canonical server listing-favourites API with idempotent `PUT` calls. Successfully merged product favourites are removed from local preference storage; temporarily failed merges remain local for a later retry, while stale `404` listing references are discarded.

Shop/outlet favourites remain local in this focused slice because the approved roadmap defines only a listing-favourite server contract. They are not sent through the rejected legacy generic `{targetType,targetId}` API. A future canonical outlet-favourite contract requires its own data-inventory update before merge.

## Security/privacy constraints

- no client-supplied Customer identity
- CUSTOMER role required server-side
- no raw database entity returned
- bounded pagination (1..100 page size)
- no cross-merchant/global product identity introduced
- no precise location or additional consent purpose introduced
- no analytics/marketing use is authorized by this slice
- the Customer privacy summary explicitly includes favourites in its disclosed commerce-processing category

This addendum supplements `DATA_INVENTORY.md` and the retention schedule until the consolidated inventory is refreshed by the next compliance-doc maintenance pass.
