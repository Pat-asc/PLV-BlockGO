-- Bind student visibility to an explicitly released finalized grade version.
-- Existing releases refer to legacy finalized version 1 without rewriting Fabric.
ALTER TABLE grade_releases
    ADD COLUMN IF NOT EXISTS grade_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'grade_releases'::regclass
          AND conname = 'grade_releases_pkey'
    ) THEN
        ALTER TABLE grade_releases DROP CONSTRAINT grade_releases_pkey;
    END IF;
END $$;

ALTER TABLE grade_releases
    ADD CONSTRAINT grade_releases_pkey PRIMARY KEY (record_id, grade_version);

CREATE INDEX IF NOT EXISTS idx_grade_releases_record_version
    ON grade_releases(record_id, grade_version);
