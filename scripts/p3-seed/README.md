# P3 staging marketplace seed

These scripts create deterministic, idempotent **staging-only** marketplace fixtures in dependency order:

1. `01-providers.sql` — three active Tirupati providers, verified capabilities and service PIN codes.
2. `02-catalog.sql` — four purchasable products, one view-only medicine item and authoritative inventory balances.
3. `03-services.sql` — two grooming services, two veterinary services and eight rolling future slots.

The fixture IDs are derived from stable `md5('mypet:p3:...')::uuid` names so reruns update the same rows instead of multiplying data.

Customer-owned data is intentionally excluded. Pets, addresses, authenticated sessions and transaction records must be created through the customer flow in P5+ rather than fabricated directly in P3.

Run only against the isolated PetShop staging database. These are data fixtures, not Flyway schema migrations.
