-- Opt-in BlockGo QA/demo fixture. This is intentionally not a migration:
-- production deployments must choose explicitly whether to install test data.
-- Re-running the script is safe and never updates an existing curriculum or subject.
DO $seed$
DECLARE
    target_program_id INTEGER;
    target_curriculum_id BIGINT;
    target_creator_id INTEGER;
BEGIN
    SELECT program_id INTO target_program_id
    FROM academic_programs
    WHERE UPPER(program_code) = 'BSIT';

    IF target_program_id IS NULL THEN
        RAISE EXCEPTION 'The BSIT academic program must exist before installing the QA curriculum.';
    END IF;

    SELECT curriculum_id INTO target_curriculum_id
    FROM curriculums
    WHERE curriculum_code = 'BSIT-QA-2026';

    IF target_curriculum_id IS NULL AND EXISTS (
        SELECT 1 FROM curriculums
        WHERE program_id = target_program_id AND curriculum_version = 'QA-2026'
    ) THEN
        RAISE NOTICE 'A BSIT QA-2026 curriculum already exists under another code; no test data was changed.';
        RETURN;
    END IF;

    IF target_curriculum_id IS NULL THEN
        SELECT id INTO target_creator_id
        FROM users
        WHERE LOWER(role) IN ('registrar', 'department_admin', 'system_admin')
          AND LOWER(status) = 'approved' AND is_active = TRUE
        ORDER BY CASE LOWER(role) WHEN 'registrar' THEN 1 ELSE 2 END, id
        LIMIT 1;

        IF target_creator_id IS NULL THEN
            RAISE EXCEPTION 'An active Registrar or administrator account is required to own the QA curriculum.';
        END IF;

        INSERT INTO curriculums
            (curriculum_code, curriculum_name, program_id, curriculum_version,
             school_year, status, created_by, published_at)
        VALUES
            ('BSIT-QA-2026', 'BSIT BlockGo QA Curriculum', target_program_id, 'QA-2026',
             '2026-2027', 'PUBLISHED', target_creator_id, CURRENT_TIMESTAMP)
        ON CONFLICT (curriculum_code) DO NOTHING
        RETURNING curriculum_id INTO target_curriculum_id;
    END IF;

    IF target_curriculum_id IS NULL THEN
        SELECT curriculum_id INTO target_curriculum_id
        FROM curriculums WHERE curriculum_code = 'BSIT-QA-2026';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM curriculums
        WHERE curriculum_id = target_curriculum_id
          AND program_id = target_program_id
          AND curriculum_version = 'QA-2026'
    ) THEN
        RAISE EXCEPTION 'BSIT-QA-2026 already identifies a different curriculum; no test data was changed.';
    END IF;

    INSERT INTO curriculum_subjects
        (curriculum_id, subject_code, subject_title, units, lecture_hours,
         laboratory_hours, prerequisite, year_level, semester, subject_type)
    VALUES
        (target_curriculum_id, 'IT 101', 'Introduction to Computing', 3, 3, 0, NULL, 1, 'FIRST', 'Major'),
        (target_curriculum_id, 'IT 102', 'Programming 1', 3, 2, 3, 'IT 101', 1, 'FIRST', 'Major'),
        (target_curriculum_id, 'IT 201', 'Data Structures', 3, 2, 3, 'IT 102', 2, 'SECOND', 'Major')
    ON CONFLICT (curriculum_id, year_level, semester, subject_code) DO NOTHING;
END
$seed$;
