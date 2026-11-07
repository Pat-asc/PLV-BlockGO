-- A new FacultySections row is a new workflow cycle. Historical staged and
-- finalized grades remain intact, but cannot be mistaken for that new cycle.
ALTER TABLE pending_grade_records
    ADD COLUMN IF NOT EXISTS assignment_cycle_id VARCHAR(100) NOT NULL DEFAULT 'legacy';

CREATE TABLE IF NOT EXISTS grade_assignment_cycles (
    record_id VARCHAR(255) PRIMARY KEY,
    assignment_cycle_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO grade_assignment_cycles (record_id, assignment_cycle_id)
SELECT id, assignment_cycle_id FROM pending_grade_records
ON CONFLICT (record_id) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_grade_entry_section') THEN
        ALTER TABLE pending_grade_records DROP CONSTRAINT unique_grade_entry_section;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_grade_entry_assignment_cycle') THEN
        ALTER TABLE pending_grade_records ADD CONSTRAINT unique_grade_entry_assignment_cycle
        UNIQUE (student_hash, subject_code, school_year, semester, section, assignment_cycle_id);
    END IF;
END $$;
