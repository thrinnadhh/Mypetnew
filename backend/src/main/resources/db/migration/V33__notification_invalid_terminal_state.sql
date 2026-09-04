-- Forward repair for MI-3 notification lifecycle hardening.
-- INVALID is a legitimate terminal notification-attempt state used when a push token is rejected.

ALTER TABLE mypet.notification_attempt
    DROP CONSTRAINT chk_notification_attempt_status;

ALTER TABLE mypet.notification_attempt
    ADD CONSTRAINT chk_notification_attempt_status
    CHECK (status IN ('PENDING', 'PROCESSING', 'RETRY', 'DELIVERED', 'INVALID', 'DEAD_LETTER'))
    NOT VALID;

ALTER TABLE mypet.notification_attempt
    VALIDATE CONSTRAINT chk_notification_attempt_status;
