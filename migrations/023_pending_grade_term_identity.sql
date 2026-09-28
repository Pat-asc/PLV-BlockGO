BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pending_grade_records
        GROUP BY
            student_hash,
            subject_code,
            school_year,
            semester,
            section,
            assignment_cycle_id,
            LOWER(COALESCE(term, ''))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Migration 023 cannot create the term-scoped pending-grade identity because same-term duplicate rows exist. Review them without deleting or merging academic history.';
    END IF;
END $$;

ALTER TABLE pending_grade_records
    DROP CONSTRAINT IF EXISTS unique_grade_entry_assignment_cycle;

ALTER TABLE pending_grade_records
    ADD CONSTRAINT unique_grade_entry_assignment_cycle
    UNIQUE (
        student_hash,
        subject_code,
        school_year,
        semester,
        section,
        assignment_cycle_id,
        term
    );

COMMIT;
