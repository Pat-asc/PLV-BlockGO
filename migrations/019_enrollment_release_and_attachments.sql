-- Additive production migration for enrollment planning/finalization, section
-- capacity, grade publication, configurable NSTP data, and support attachments.

ALTER TABLE academicsections ADD COLUMN IF NOT EXISTS max_capacity INTEGER;
UPDATE academicsections SET max_capacity = 40 WHERE max_capacity IS NULL;
ALTER TABLE academicsections ALTER COLUMN max_capacity SET DEFAULT 40;
ALTER TABLE academicsections ALTER COLUMN max_capacity SET NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_academicsections_capacity') THEN
        ALTER TABLE academicsections ADD CONSTRAINT ck_academicsections_capacity
            CHECK (max_capacity BETWEEN 1 AND 500);
    END IF;
END $$;

ALTER TABLE student_enrollments
    ADD COLUMN IF NOT EXISTS enrollment_state VARCHAR(20),
    ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS finalized_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS nstp_option VARCHAR(100);

-- Existing rows predate the planning workflow and remain official. New rows
-- begin in PLANNING until the Registrar explicitly finalizes the period.
UPDATE student_enrollments
SET enrollment_state = 'FINALIZED',
    finalized_at = COALESCE(finalized_at, updated_at, enrolled_at)
WHERE enrollment_state IS NULL;
ALTER TABLE student_enrollments ALTER COLUMN enrollment_state SET DEFAULT 'PLANNING';
ALTER TABLE student_enrollments ALTER COLUMN enrollment_state SET NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_student_enrollment_state') THEN
        ALTER TABLE student_enrollments ADD CONSTRAINT ck_student_enrollment_state
            CHECK (enrollment_state IN ('PLANNING', 'FINALIZED'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_enrollments_planning_period
    ON student_enrollments(program_id, school_year, semester, enrollment_state, academic_section_id);

CREATE TABLE IF NOT EXISTS nstp_options (
    option_code VARCHAR(50) PRIMARY KEY,
    option_name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grade_releases (
    record_id VARCHAR(255) PRIMARY KEY,
    student_identifier VARCHAR(255) NOT NULL,
    school_year VARCHAR(20) NOT NULL,
    semester VARCHAR(20) NOT NULL,
    term VARCHAR(20),
    released_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_grade_releases_student_period
    ON grade_releases(LOWER(student_identifier), school_year, semester, term);

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
    attachment_id BIGSERIAL PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES support_tickets(ticket_id) ON DELETE CASCADE,
    original_file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    content BYTEA NOT NULL,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket
    ON support_ticket_attachments(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS academic_periods (
    academic_period_id BIGSERIAL PRIMARY KEY,
    school_year VARCHAR(20) NOT NULL,
    semester VARCHAR(20) NOT NULL CHECK (semester IN ('FIRST', 'SECOND', 'MIDYEAR')),
    term VARCHAR(20) NOT NULL CHECK (term IN ('midterm', 'finals')),
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
    opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE (school_year, semester, term),
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_academic_period_active
    ON academic_periods ((status)) WHERE status = 'ACTIVE';
