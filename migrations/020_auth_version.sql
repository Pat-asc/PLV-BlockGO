-- Incrementing auth_version revokes every JWT issued before a password reset or
-- administrator-managed password replacement. Existing accounts and tokens begin at 1.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS ck_users_auth_version_positive;

ALTER TABLE users
    ADD CONSTRAINT ck_users_auth_version_positive CHECK (auth_version > 0);
