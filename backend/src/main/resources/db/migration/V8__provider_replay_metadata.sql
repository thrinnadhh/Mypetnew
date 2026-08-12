ALTER TABLE mypet.merchant_organization
    ADD COLUMN owner_actor_id UUID;

CREATE UNIQUE INDEX uq_merchant_organization_owner
    ON mypet.merchant_organization (owner_actor_id)
    WHERE owner_actor_id IS NOT NULL;

ALTER TABLE mypet.provider_outlet
    ADD COLUMN submitted_by_actor_id UUID,
    ADD COLUMN submission_idempotency_key VARCHAR(128),
    ADD COLUMN submission_request_fingerprint VARCHAR(64),
    ADD COLUMN approval_idempotency_key VARCHAR(128),
    ADD COLUMN approval_request_fingerprint VARCHAR(64),
    ADD COLUMN approved_by_actor_id UUID;

CREATE UNIQUE INDEX uq_provider_submit_actor_key
    ON mypet.provider_outlet (submitted_by_actor_id, submission_idempotency_key)
    WHERE submitted_by_actor_id IS NOT NULL AND submission_idempotency_key IS NOT NULL;
