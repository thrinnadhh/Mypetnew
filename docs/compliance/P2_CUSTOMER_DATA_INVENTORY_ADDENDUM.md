# P2 Customer data inventory addendum

Status: engineering inventory for Customer Production Plan 2, 2026-08-15. This supplements `DATA_INVENTORY.md`; it is not a legal-compliance certification. Production region, backup, processor and access evidence remain subject to the existing compliance gates.

## New/activated personal-data categories

| Store / fields | Purpose | Collection/minimisation | Access boundary | Retention/deletion | Classification |
|---|---|---|---|---|---|
| `mypet.customer_pet`: `id`, `customer_id`, `name`, `species`, optional `breed`, optional `date_of_birth`, timestamps | Customer-owned pet profile; later grooming/veterinary booking reference | Customer supplies only data needed to identify/select a pet. No medical record, diagnosis, prescription, photo, microchip or owner location is collected in P2. Date of birth is optional and cannot be in the future. | Authenticated owning CUSTOMER only in P2. Merchant, Captain and Admin receive no P2 pet projection. Backend derives `customer_id` from authenticated principal. | Active until Customer edits/deletes the pet or deletes the account. Account deletion erases rows. Future appointment records may require a separately defined retained snapshot/legal basis; P2 does not create one. | Customer-linked pet data `CONFIDENTIAL`; veterinary/medical data remains absent and would be `RESTRICTED` if introduced later. |
| `mypet.customer_address`: `id`, `customer_id`, label, recipient name, delivery phone, address lines, city, state, six-digit PIN, default flag, timestamps | Saved address/contact foundation for future Captain delivery and bookings | P2 deliberately does **not** collect latitude/longitude or request OS location permission. Phone is normalized to Indian E.164. PIN is six digits. | Authenticated owning CUSTOMER only. Backend derives `customer_id`; foreign IDs return the same unavailable-resource boundary. P2 does not expose saved addresses to Merchant/Captain. | Active until Customer edits/deletes the address or deletes the account. Account deletion erases rows. Future fulfilled orders must use a purpose-limited transaction snapshot rather than depending on mutable profile data. | Recipient/contact/address `RESTRICTED`. Never log full address or phone. |
| Public serviceability request: `outletId`, six-digit `pincode`, mode | Determine whether an ACTIVE outlet advertises the requested fulfilment mode for a PIN | Request is not tied to Customer identity and does not transmit a saved address, phone, name or coordinates. | Public read-only projection returns only `serviceable`, fulfilment mode and reason code. Merchant service-PIN list remains backend/provider state. | No P2 persistence is introduced for serviceability queries. Ordinary infrastructure logs must not be repurposed into Customer location profiling. | PIN alone is coarse location context; treat request metadata under existing log minimisation rules. |

## P2 data-flow boundaries

```text
Customer app
  ├─ profile name/email ──> authenticated Customer API ──> existing customer_profile
  ├─ pet profile ─────────> authenticated Customer API ──> customer_pet
  └─ saved address ───────> authenticated Customer API ──> customer_address

Public outlet + PIN
  └─ serviceability ──────> read-only provider projection
```

Not present in P2:
- precise GPS coordinates or background location
- Captain location
- address sharing with Merchant/Captain
- veterinary medical records
- medicine checkout
- payment credentials
- recurring-order address copying

Those categories require their own inventory/purpose/retention review in the later plan that introduces them.

## Account deletion

`DELETE /api/v1/privacy/account` validates explicit deletion confirmation, erases Customer-owned pets and saved addresses, then invokes the existing privacy deletion flow that removes direct profile identifiers and revokes identity/device material. Source tests verify the P2 stores are empty after deletion. Production backup/tombstone replay remains governed by `DATA_RETENTION_SCHEDULE.md` and is still a deployment evidence gate.
