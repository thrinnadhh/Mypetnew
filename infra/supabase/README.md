# Supabase Sprint 1 boundary

Flyway owns the private `mypet` application schema. Customer, Merchant, Captain, and Admin clients receive no database password or Supabase service-role/secret key and must call the Spring API only.

For each environment, create separate migration and runtime database identities in the Supabase connection topology intended for persistent servers, require TLS, and bound the application pool. The migration identity may apply committed Flyway migrations. The runtime identity receives only the minimum DML/sequence privileges required inside `mypet`; neither identity receives privileges on Supabase-owned `auth` or `storage` schemas. Do not expose `mypet` through the Data API schema allowlist.

Private merchant-verification evidence uses the server-only `SupabasePrivateDocumentStore` adapter. It validates tenant, purpose, content type, size, and object key, uploads under an opaque key, stores metadata in PostgreSQL, compensates failed metadata writes, and returns only short-lived signed access. The adapter and its in-memory contract tests are present; the real-bucket abuse and authorization matrix remains `NOT RUN` until exercised in isolated staging.

Record grants, exposed-schema enumeration, clean migration, drift, reconnect, backup/restore, and direct-client denial results in the Sprint 1 evidence pack without credentials or real customer data.
