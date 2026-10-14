-- Repair deployments where student_enrollments existed before migration 004.
-- CREATE TABLE IF NOT EXISTS does not add constraints to an existing table,
-- but the assignment upsert requires this exact enrollment-period identity.
DO $migration$
BEGIN
    IF to_regclass('student_enrollments') IS NULL THEN
        RAISE EXCEPTION 'Cannot add uq_student_enrollment_period: student_enrollments does not exist.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM student_enrollments
        WHERE student_user_id IS NOT NULL
          AND school_year IS NOT NULL
          AND semester IS NOT NULL
        GROUP BY student_user_id, school_year, semester
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'Cannot add uq_student_enrollment_period: duplicate student/academic-period enrollment rows exist.',
            HINT = 'Reconcile the duplicate rows without deleting enrollment history, then rerun this migration.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'student_enrollments'::regclass
          AND conname = 'uq_student_enrollment_period'
          AND contype = 'u'
    ) THEN
        ALTER TABLE student_enrollments
            ADD CONSTRAINT uq_student_enrollment_period
            UNIQUE (student_user_id, school_year, semester);
    END IF;
END
$migration$;

COMMENT ON CONSTRAINT uq_student_enrollment_period ON student_enrollments IS
    'One canonical enrollment per student, school year, and semester; subjects share this enrollment.';
