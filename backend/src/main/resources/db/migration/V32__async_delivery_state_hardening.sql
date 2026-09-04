-- MI-3 — transactional outbox / notification delivery lifecycle hardening.
-- The existing Spring-owned outbox/inbox architecture remains authoritative; PGMQ is intentionally not introduced.

ALTER TABLE mypet.outbox_event
    ADD CONSTRAINT chk_outbox_event_status
    CHECK (status IN ('PENDING', 'PROCESSING', 'RETRY', 'DELIVERED', 'DEAD_LETTER'))
    NOT VALID;

ALTER TABLE mypet.outbox_event
    VALIDATE CONSTRAINT chk_outbox_event_status;

ALTER TABLE mypet.notification_attempt
    ADD CONSTRAINT chk_notification_attempt_status
    CHECK (status IN ('PENDING', 'PROCESSING', 'RETRY', 'DELIVERED', 'DEAD_LETTER'))
    NOT VALID;

ALTER TABLE mypet.notification_attempt
    VALIDATE CONSTRAINT chk_notification_attempt_status;
