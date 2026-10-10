-- Durable, idempotent metadata for automatically generated finalized grading
-- sheets. Grade values remain authoritative on Fabric; this table stores only
-- the protected IPFS artifact association and retry state.

CREATE TABLE IF NOT EXISTS finalized_grade_archives (
    archive_id BIGSERIAL PRIMARY KEY,
    dataset_hash CHAR(64) NOT NULL,
    assignment_cycle_id VARCHAR(100) NOT NULL,
    academic_section_id INTEGER,
    program VARCHAR(255) NOT NULL DEFAULT '',
    section VARCHAR(100) NOT NULL,
    subject_code VARCHAR(100) NOT NULL,
    school_year VARCHAR(50) NOT NULL,
    semester VARCHAR(50) NOT NULL,
    term VARCHAR(20) NOT NULL,
    record_ids TEXT[] NOT NULL,
    record_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
    finalized_transaction_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    cid VARCHAR(255),
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL DEFAULT 'application/json',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    failure_code VARCHAR(50),
    failure_message VARCHAR(500),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at TIMESTAMPTZ,
    archived_by VARCHAR(255) NOT NULL,
    CONSTRAINT ck_finalized_grade_archives_status
        CHECK (status IN ('PENDING', 'AVAILABLE', 'FAILED')),
    CONSTRAINT ck_finalized_grade_archives_records
        CHECK (cardinality(record_ids) > 0),
    CONSTRAINT ux_finalized_grade_archives_dataset UNIQUE (dataset_hash)
);

CREATE INDEX IF NOT EXISTS idx_finalized_grade_archives_workload
    ON finalized_grade_archives (
        assignment_cycle_id,
        LOWER(subject_code),
        LOWER(school_year),
        LOWER(semester),
        LOWER(term)
    );

CREATE INDEX IF NOT EXISTS idx_finalized_grade_archives_record_ids
    ON finalized_grade_archives USING GIN (record_ids);

CREATE INDEX IF NOT EXISTS idx_finalized_grade_archives_available_cid
    ON finalized_grade_archives (cid)
    WHERE status = 'AVAILABLE' AND cid IS NOT NULL;
