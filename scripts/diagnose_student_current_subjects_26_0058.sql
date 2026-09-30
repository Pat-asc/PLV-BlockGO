-- Read-only production diagnostic for Student Portal Current Subjects.
-- This script is intentionally scoped to official student number 26-0058.

BEGIN TRANSACTION READ ONLY;

WITH target_account AS (
    SELECT account.id AS student_user_id,
           account.email,
           account.role,
           account.status AS account_status,
           account.is_active AS account_is_active,
           profile.student_no
    FROM users account
    JOIN studentprofiles profile ON profile.user_id = account.id
    WHERE LOWER(TRIM(profile.student_no)) = LOWER('26-0058')
),
active_period AS (
    SELECT period.academic_period_id,
           period.school_year,
           period.semester,
           period.term
    FROM academic_periods period
    WHERE period.status = 'ACTIVE'
    ORDER BY period.opened_at DESC, period.academic_period_id DESC
    LIMIT 1
),
ranked_enrollments AS (
    SELECT enrollment.*,
           ROW_NUMBER() OVER (
               PARTITION BY enrollment.student_user_id
               ORDER BY enrollment.school_year DESC,
                        CASE enrollment.semester WHEN 'MIDYEAR' THEN 3 WHEN 'SECOND' THEN 2 ELSE 1 END DESC,
                        enrollment.enrollment_id DESC
           ) AS latest_rank
    FROM student_enrollments enrollment
    JOIN target_account account ON account.student_user_id = enrollment.student_user_id
)
SELECT account.student_user_id,
       account.student_no AS profile_student_no,
       enrollment.student_no AS enrollment_student_no,
       enrollment.enrollment_id,
       enrollment.status AS enrollment_status,
       enrollment.enrollment_state,
       enrollment.school_year,
       enrollment.semester,
       enrollment.year_level,
       enrollment.academic_section_id,
       enrollment.section,
       enrollment.program_id,
       program.program_code,
       program.program_name,
       enrollment.curriculum_id,
       curriculum.status AS curriculum_status,
       curriculum.curriculum_version,
       section.is_active AS academic_section_is_active,
       active_period.school_year AS active_school_year,
       active_period.semester AS active_semester,
       active_period.term AS active_encoding_term,
       (SELECT COUNT(*)
        FROM curriculum_subjects subject
        WHERE subject.curriculum_id = enrollment.curriculum_id
          AND subject.year_level = enrollment.year_level
          AND subject.semester = enrollment.semester) AS matching_curriculum_subject_count,
       enrollment.latest_rank = 1 AS selected_by_existing_latest_rule,
       enrollment.enrollment_state = 'FINALIZED' AS passes_existing_finalized_predicate,
       enrollment.school_year = active_period.school_year
           AND enrollment.semester = active_period.semester AS matches_active_academic_period,
       array_to_string(array_remove(ARRAY[
           CASE WHEN enrollment.latest_rank <> 1 THEN 'not the latest enrollment selected by the existing query' END,
           CASE WHEN LOWER(TRIM(enrollment.student_no)) IS DISTINCT FROM LOWER(TRIM(account.student_no)) THEN 'student_no snapshot does not match studentprofiles.student_no' END,
           CASE WHEN enrollment.status IS DISTINCT FROM 'ENROLLED' THEN 'se.status <> ENROLLED' END,
           CASE WHEN enrollment.enrollment_state IS DISTINCT FROM 'FINALIZED' THEN 'se.enrollment_state <> FINALIZED' END,
           CASE WHEN program.program_id IS NULL OR program.is_active IS DISTINCT FROM TRUE THEN 'academic program is missing or inactive' END,
           CASE WHEN enrollment.academic_section_id IS NULL THEN 'academic_section_id is NULL' END,
           CASE WHEN section.id IS NULL THEN 'academic section does not exist' END,
           CASE WHEN section.year_level IS DISTINCT FROM enrollment.year_level THEN 'academic section year level does not match enrollment' END,
           CASE WHEN section.id IS NOT NULL AND program.program_id IS NOT NULL
                  AND LOWER(TRIM(section.department)) NOT IN (LOWER(TRIM(program.program_code)), LOWER(TRIM(program.program_name)))
                THEN 'academic section department does not match enrollment program' END,
           CASE WHEN curriculum.curriculum_id IS NULL THEN 'assigned curriculum does not exist' END,
           CASE WHEN curriculum.curriculum_id IS NOT NULL AND curriculum.program_id IS DISTINCT FROM enrollment.program_id THEN 'assigned curriculum belongs to another program' END,
           CASE WHEN curriculum.curriculum_id IS NOT NULL AND curriculum.status NOT IN ('PUBLISHED', 'ARCHIVED') THEN 'curriculum is not PUBLISHED or ARCHIVED' END
       ], NULL), ', ') AS existing_query_failure_predicates,
       array_to_string(array_remove(ARRAY[
           CASE WHEN active_period.academic_period_id IS NULL THEN 'no active academic period exists' END,
           CASE WHEN active_period.academic_period_id IS NOT NULL
                  AND (enrollment.school_year IS DISTINCT FROM active_period.school_year
                    OR enrollment.semester IS DISTINCT FROM active_period.semester)
                THEN 'enrollment does not match the active school year and semester' END,
           CASE WHEN enrollment.status IS DISTINCT FROM 'ENROLLED' THEN 'enrollment is not ENROLLED' END,
           CASE WHEN enrollment.academic_section_id IS NULL THEN 'academic_section_id is NULL' END,
           CASE WHEN section.id IS NULL OR section.is_active IS DISTINCT FROM TRUE THEN 'academic section is missing or inactive' END,
           CASE WHEN curriculum.curriculum_id IS NULL THEN 'assigned curriculum does not exist' END,
           CASE WHEN curriculum.curriculum_id IS NOT NULL AND curriculum.program_id IS DISTINCT FROM enrollment.program_id THEN 'assigned curriculum belongs to another program' END,
           CASE WHEN curriculum.curriculum_id IS NOT NULL AND curriculum.status NOT IN ('PUBLISHED', 'ARCHIVED') THEN 'curriculum is not student-visible' END
       ], NULL), ', ') AS fixed_query_failure_predicates
FROM target_account account
LEFT JOIN ranked_enrollments enrollment ON enrollment.student_user_id = account.student_user_id
LEFT JOIN academic_programs program ON program.program_id = enrollment.program_id
LEFT JOIN academicsections section ON section.id = enrollment.academic_section_id
LEFT JOIN curriculums curriculum ON curriculum.curriculum_id = enrollment.curriculum_id
LEFT JOIN active_period ON TRUE
ORDER BY enrollment.school_year DESC NULLS LAST,
         CASE enrollment.semester WHEN 'MIDYEAR' THEN 3 WHEN 'SECOND' THEN 2 ELSE 1 END DESC,
         enrollment.enrollment_id DESC;

ROLLBACK;
