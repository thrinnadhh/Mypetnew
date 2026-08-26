-- Allow a physical installation to be rebound to a different authenticated
-- account only after the previous binding has been explicitly revoked.
--
-- V1 defined uq_device_binding as a UNIQUE TABLE CONSTRAINT over installation
-- + token fingerprint. PostgreSQL therefore owns the backing index through the
-- constraint; dropping the index directly is invalid. Remove the constraint
-- instead, which drops its backing unique index transactionally.
--
-- Active-ownership exclusion remains transactionally enforced by
-- JdbcDeviceRegistrationPersistence under a per-installation advisory lock.
-- Historical revoked rows are intentionally retained for audit/FK integrity.

ALTER TABLE mypet.device_registration
    DROP CONSTRAINT IF EXISTS uq_device_binding;

CREATE INDEX IF NOT EXISTS ix_device_binding_lookup
    ON mypet.device_registration(environment, app_kind, installation_id, token_fingerprint);
