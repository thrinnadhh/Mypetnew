-- Allow a physical installation to be rebound to a different authenticated
-- account only after the previous binding has been explicitly revoked.
--
-- V1 used a global uniqueness key over installation + token fingerprint. That
-- correctly blocked duplicate bindings initially, but also made a revoked row
-- permanently reserve the same FCM token for the former account. FCM may keep
-- the token stable across logout/login, so a new account on the same phone
-- could otherwise fail with a uniqueness violation even after clean logout.
--
-- Active-ownership exclusion remains transactionally enforced by
-- JdbcDeviceRegistrationPersistence under a per-installation advisory lock.
-- Historical revoked rows are intentionally retained for audit/FK integrity.

DROP INDEX IF EXISTS mypet.uq_device_binding;

CREATE INDEX IF NOT EXISTS ix_device_binding_lookup
    ON mypet.device_registration(environment, app_kind, installation_id, token_fingerprint);
