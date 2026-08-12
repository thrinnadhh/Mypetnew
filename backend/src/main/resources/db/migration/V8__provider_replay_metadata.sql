ALTER TABLE mypet.merchant_organization
    ADD COLUMN owner_actor_id UUID;

CREATE UNIQUE INDEX uq_merchant_organization_owner
    ON mypet.merchant_organization (owner_actor_id);

ALTER TABLE mypet.provider_outlet
    ADD COLUMN submitted_by_actor_id UUID;

ALTER TABLE mypet.provider_outlet
    ADD COLUMN submission_idempotency_key VARCHAR(128);

ALTER TABLE mypet.provider_outlet
    ADD COLUMN submission_request_fingerprint VARCHAR(64);

ALTER TABLE mypet.provider_outlet
    ADD COLUMN approval_idempotency_key VARCHAR(128);

ALTER TABLE mypet.provider_outlet
    ADD COLUMN approval_request_fingerprint VARCHAR(64);

ALTER TABLE mypet.provider_outlet
    ADD COLUMN approved_by_actor_id UUID;

CREATE UNIQUE INDEX uq_provider_submit_actor_key
    ON mypet.provider_outlet (submitted_by_actor_id, submission_idempotency_key);
