ALTER TABLE mypet.user_session
    ADD COLUMN rotated_from_session_id UUID REFERENCES mypet.user_session(id);

CREATE INDEX idx_session_account_active
    ON mypet.user_session(account_id, revoked_at, expires_at);

CREATE INDEX idx_session_rotation_lineage
    ON mypet.user_session(rotated_from_session_id);
