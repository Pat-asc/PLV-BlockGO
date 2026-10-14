-- Self-service email recovery is separate from the Registrar-managed
-- password_reset_requests workflow. Only hashes of short-lived codes are stored.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    used_at TIMESTAMP WITH TIME ZONE,
    requested_ip VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_password_reset_token_attempts CHECK (attempt_count BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created
    ON password_reset_tokens(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_tokens_active_user
    ON password_reset_tokens(user_id)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry
    ON password_reset_tokens(expires_at)
    WHERE used_at IS NULL;
