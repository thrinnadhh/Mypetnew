ALTER TABLE mypet.notification_attempt
    ADD COLUMN claimed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX idx_notification_attempt_delivery
    ON mypet.notification_attempt(status, next_attempt_at, claimed_at, created_at);
