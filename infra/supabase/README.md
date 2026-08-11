# Supabase Sprint 1 boundary

Flyway owns the private `mypet` application schema. Customer, Merchant, Captain, and Admin clients receive no database password or Supabase service-role/secret key and must call the Spring API only.

For each environment, create separate migration and runtime database identities in the Supabase connection topology intended for persistent servers, require TLS, and bound the application pool. The migration identity may apply committed Flyway migrations. The runtime identity receives only the minimum DML/sequence privileges required inside `mypet`; neither identity receives privileges on Supabase-owned `auth` or `storage` schemas. Do not expose `mypet` through the Data API schema allowlist.

Private merchant-verification evidence requires a deliberately private bucket and a server-only `DocumentStore` adapter that validates tenant, purpose, content type, size, and object key before returning short-lived access. The repository currently contains the port and an in-memory test implementation only, so the storage and staging boundary gates remain `NOT RUN`.

Record grants, exposed-schema enumeration, clean migration, drift, reconnect, backup/restore, and direct-client denial results in the Sprint 1 evidence pack without credentials or real customer data.
