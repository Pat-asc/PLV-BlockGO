-- Direct Faculty -> Registrar grade workflow, Faculty academic access controls,
-- and authoritative non-regular subject loads.

ALTER TABLE studentprofiles
    ADD COLUMN IF NOT EXISTS is_irregular BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE pending_grade_records
    ADD COLUMN IF NOT EXISTS submission_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pending_grade_records
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE pending_grade_records
    ADD COLUMN IF NOT EXISTS returned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE pending_grade_records
    ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE pending_grade_records
    ADD COLUMN IF NOT EXISTS return_reason TEXT;
ALTER TABLE pending_grade_records
    ADD COLUMN IF NOT EXISTS before_submission_grade TEXT;
ALTER TABLE pending_grade_records
    ADD COLUMN IF NOT EXISTS submitted_grade_snapshot TEXT;

CREATE TABLE IF NOT EXISTS grade_submission_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    record_id VARCHAR(255) NOT NULL,
    assignment_cycle_id VARCHAR(100) NOT NULL DEFAULT '',
    submission_version INTEGER NOT NULL DEFAULT 1,
    student_id VARCHAR(100) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    course VARCHAR(255) NOT NULL,
    subject_code VARCHAR(100) NOT NULL,
    subject_name VARCHAR(255) NOT NULL,
    school_year VARCHAR(50) NOT NULL,
    semester VARCHAR(50) NOT NULL,
    term VARCHAR(20) NOT NULL DEFAULT 'finals',
    year_level VARCHAR(50) NOT NULL,
    section VARCHAR(100) NOT NULL,
    academic_section_id INTEGER,
    faculty_id VARCHAR(255) NOT NULL,
    before_grade TEXT,
    submitted_grade TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'SubmittedToRegistrar',
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    returned_at TIMESTAMP WITH TIME ZONE,
    return_reason TEXT,
    finalized_at TIMESTAMP WITH TIME ZONE,
    transaction_id VARCHAR(255),
    UNIQUE (record_id, submission_version)
);

CREATE INDEX IF NOT EXISTS idx_grade_submission_snapshots_record
    ON grade_submission_snapshots (record_id, submission_version DESC);
CREATE INDEX IF NOT EXISTS idx_grade_submission_snapshots_scope
    ON grade_submission_snapshots (LOWER(course), school_year, semester, term);

CREATE TABLE IF NOT EXISTS faculty_access_controls (
    faculty_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    department VARCHAR(255) NOT NULL,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    block_reason TEXT,
    blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    blocked_at TIMESTAMP WITH TIME ZONE,
    unblocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    unblocked_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_faculty_access_block_reason CHECK (
        NOT is_blocked OR NULLIF(BTRIM(block_reason), '') IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_faculty_access_controls_department
    ON faculty_access_controls (LOWER(department), is_blocked);

CREATE TABLE IF NOT EXISTS faculty_access_events (
    event_id BIGSERIAL PRIMARY KEY,
    faculty_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department VARCHAR(255) NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('BLOCKED', 'UNBLOCKED')),
    reason TEXT,
    acted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    acted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_faculty_access_events_faculty
    ON faculty_access_events (faculty_user_id, acted_at DESC);

CREATE TABLE IF NOT EXISTS student_non_regular_subjects (
    non_regular_subject_id BIGSERIAL PRIMARY KEY,
    student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrollment_id BIGINT NOT NULL REFERENCES student_enrollments(enrollment_id) ON DELETE CASCADE,
    school_year VARCHAR(20) NOT NULL,
    semester VARCHAR(20) NOT NULL CHECK (semester IN ('FIRST', 'SECOND', 'MIDYEAR')),
    source_program_id INTEGER NOT NULL REFERENCES academic_programs(program_id) ON DELETE RESTRICT,
    source_curriculum_id BIGINT NOT NULL REFERENCES curriculums(curriculum_id) ON DELETE RESTRICT,
    subject_id BIGINT NOT NULL REFERENCES curriculum_subjects(subject_id) ON DELETE RESTRICT,
    subject_code VARCHAR(80) NOT NULL,
    faculty_section_id INTEGER REFERENCES facultysections(id) ON DELETE SET NULL,
    classification VARCHAR(30) NOT NULL DEFAULT 'NON_REGULAR'
        CHECK (classification = 'NON_REGULAR'),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'DROPPED')),
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    override_reason TEXT,
    CONSTRAINT uq_non_regular_student_subject_period
        UNIQUE (student_user_id, school_year, semester, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_non_regular_subjects_student_period
    ON student_non_regular_subjects (student_user_id, school_year, semester);
CREATE INDEX IF NOT EXISTS idx_non_regular_subjects_faculty_section
    ON student_non_regular_subjects (faculty_section_id)
    WHERE faculty_section_id IS NOT NULL;

UPDATE pending_grade_records
SET submitted_at = COALESCE(submitted_at, recorded_at, CURRENT_TIMESTAMP),
    before_submission_grade = COALESCE(before_submission_grade, grade),
    submitted_grade_snapshot = COALESCE(submitted_grade_snapshot, grade)
WHERE LOWER(BTRIM(COALESCE(status, ''))) IN
      ('submittedtoregistrar', 'submittedtochairperson', 'chairpersonapproved', 'departmentapproved')
  AND (submitted_at IS NULL OR submitted_grade_snapshot IS NULL);
