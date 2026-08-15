# P4 Delivery Data Inventory Addendum

Plan 4 adds only the data required for Captain delivery.

| Data | Purpose | Authority | Storage | Retention/minimisation |
|---|---|---|---|---|
| Saved Customer postal address | Delivery quote and handover | Authenticated Customer-owned address | Existing PostgreSQL Customer address tables | Existing P2/privacy retention rules |
| Delivery address snapshot | Preserve the exact address used for an order quote | Backend quote/order transaction | PostgreSQL `commerce_quote` | Transaction record; exposed only to owning Customer and assigned Captain |
| Outlet dispatch origin | Rank nearby Captains from the merchant store | Authorized Merchant | PostgreSQL `provider_outlet` | Current operational value only; not public |
| Captain approval/online/busy | Dispatch eligibility | Admin/Captain/backend | PostgreSQL `captain_delivery_state` | Current operational state |
| Captain last-location timestamp | Freshness/recovery metadata | Captain/backend | PostgreSQL `captain_delivery_state` | Timestamp only; no durable coordinates |
| Captain current coordinates | Candidate ranking and live delivery tracking | Captain device | Redis GEO + TTL freshness key | Ephemeral; short TTL; no coordinate history in PostgreSQL |
| Dispatch job/offer/assignment | Exactly-once assignment and recovery | Backend | PostgreSQL | Operational/audit record tied to canonical order |

## Prohibited in P4

- Customer precise latitude/longitude collection or location permission.
- Durable Captain coordinate history.
- Public exposure of outlet dispatch coordinates.
- Customer address/contact disclosure to unassigned Captain candidates.
- Client-authored delivery fee, ETA, order status, Captain identity or assignment state.
