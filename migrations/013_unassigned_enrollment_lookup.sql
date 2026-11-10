-- The enrollment table already owns student_user_id -> users(id),
CREATE INDEX IF NOT EXISTS idx_student_enrollments_unassigned
    ON student_enrollments (school_year, semester, program_id, year_level, student_no)
    WHERE status = 'ENROLLED' AND academic_section_id IS NULL;
