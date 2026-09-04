# MI-5 Production Data Platform Certification

## Objective
MI-5 converts the repository's backup, PostgreSQL isolation, and Supabase Storage configuration into executable recovery evidence without mutating the PetShop staging database during CI.

## Certified architecture
- PostgreSQL remains the canonical application data store.
- Flyway remains the sole application-schema migration history.
- PostGIS is installed in the Supabase-compatible `extensions` schema.
- `scripts/supabase/export-free-tier-backup.sh` remains the operator-facing staging backup command.
- `scripts/postgres/mi5-backup-restore-drill.sh` proves custom-format dump, archive inspection, SHA-256 verification, restore, and schema-history equivalence on disposable PostgreSQL.
- The exact backend is booted against the restored database and must report healthy.
- `scripts/supabase/verify-storage-readonly.mjs` verifies Storage bucket policy using GET-only requests; it is intentionally separate from the mutating provisioner.

## Recovery drill
The CI drill starts with `postgis/postgis:17-3.5-alpine`, aligns PostGIS to `extensions`, and boots the backend so the source database is migrated by the real Flyway runtime.

The drill then:
1. captures source Flyway/schema invariants;
2. creates a compressed custom-format `mypet` dump;
3. inspects the archive with `pg_restore --list`;
4. writes and verifies SHA-256 checksums;
5. creates a separate restore database;
6. aligns PostGIS in the restore database;
7. restores with `pg_restore --exit-on-error`;
8. compares Flyway version/history, table, sequence, constraint, and index counts;
9. verifies restored PostGIS remains in `extensions`;
10. boots the exact backend against the restored target and health-checks it.

## Storage policy
Expected staging buckets are:

| Bucket | Exposure | Size limit | MIME types |
|---|---|---:|---|
| `catalog-media` | public | 5 MiB | JPEG, PNG, WebP |
| `provider-verification-private` | private | 10 MiB | PDF, JPEG, PNG, WebP |

The read-only verifier contains no POST, PUT, PATCH, or DELETE operation. Provisioning remains a separate explicit mutation workflow.

## Staging evidence captured during MI-5
A read-only Supabase inspection on 2026-09-04 observed PetShop as `ACTIVE_HEALTHY`, PostgreSQL 17.6.1, both expected Storage buckets with the exact policy above, PostGIS in `extensions`, and application Flyway at V31 with zero failed migrations.

No staging DDL was applied as part of this inspection. Repository migrations V32/V33 therefore remain pending a separately controlled staging deployment.

## Truth boundary
The disposable drill measures observed CI backup, restore, and restored-runtime boot duration. Those measurements are recovery evidence for the repository and tooling only.

MI-5 **does not certify production RPO** because no production backup cadence or loss window is exercised by the disposable drill.

MI-5 **does not certify production RTO** because CI timing is not a production incident restoration SLA.

MI-5 **does not certify PITR**, Supabase plan-level retention, regional disaster recovery, or a production cutover.

Production readiness for those capabilities requires environment-specific plan configuration, operator procedures, and a controlled production/staging restore exercise with approved credentials and backup retention evidence.

## Merge gate
MI-5 may merge only when its dedicated workflow and all inherited PostgreSQL, Supabase, backend, Merchant, Customer, Captain, Merchant Operations, M13, and MI-2/MI-3/MI-4 regression workflows are green on the exact final head, with no unresolved review blocker.
