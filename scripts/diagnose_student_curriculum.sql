-- Read-only Student Portal curriculum diagnostic.
-- Usage:
--   psql "$DATABASE_URL" -v student_identity='student@example.edu.ph' \
--     -f scripts/diagnose_student_curriculum.sql
-- student_identity may be the account email or official student number.

BEGIN TRANSACTION READ ONLY;

WITH account AS (
    SELECT users.id AS student_user_id,
           users.email,
           profile.student_no
    FROM users
    LEFT JOIN studentprofiles profile ON profile.user_id = users.id
    WHERE LOWER(users.email) = LOWER(:'student_identity')
       OR LOWER(TRIM(profile.student_no)) = LOWER(TRIM(:'student_identity'))
),
active_enrollments AS (
    SELECT enrollment.enrollment_id,
           ROW_NUMBER() OVER (
               PARTITION BY enrollment.student_user_id
               ORDER BY enrollment.school_year DESC,
                        CASE enrollment.semester WHEN 'MIDYEAR' THEN 3 WHEN 'SECOND' THEN 2 ELSE 1 END DESC,
                        enrollment.enrollment_id DESC
           ) AS active_rank
    FROM student_enrollments enrollment
    JOIN account ON account.student_user_id = enrollment.student_user_id
    WHERE enrollment.status = 'ENROLLED'
)
SELECT account.student_user_id,
       account.student_no,
       enrollment.enrollment_id,
       enrollment.status AS enrollment_status,
       enrollment.enrollment_state,
       enrollment.school_year,
       enrollment.semester,
       enrollment.program_id,
       program.program_code,
       program.program_name,
       enrollment.curriculum_id AS enrollment_curriculum_id,
       curriculum.status AS curriculum_status,
       curriculum.curriculum_code,
       curriculum.curriculum_version,
       curriculum.school_year AS curriculum_school_year,
       COUNT(subject.subject_id) AS curriculum_subject_count,
       COALESCE(active_enrollments.active_rank = 1, FALSE) AS selected_by_endpoint,
       CASE
           WHEN enrollment.status <> 'ENROLLED' THEN 'Enrollment is not active'
           WHEN active_enrollments.active_rank <> 1 THEN 'Older active enrollment'
           WHEN enrollment.curriculum_id IS NULL THEN 'No curriculum_id is assigned'
           WHEN curriculum.curriculum_id IS NULL THEN 'Assigned curriculum does not exist'
           WHEN curriculum.program_id <> enrollment.program_id THEN 'Curriculum belongs to another program'
           WHEN curriculum.status NOT IN ('PUBLISHED', 'ARCHIVED') THEN 'Curriculum is not student-visible'
           ELSE 'Eligible for Student Portal'
       END AS diagnostic_result
FROM account
LEFT JOIN student_enrollments enrollment ON enrollment.student_user_id = account.student_user_id
LEFT JOIN active_enrollments ON active_enrollments.enrollment_id = enrollment.enrollment_id
LEFT JOIN academic_programs program ON program.program_id = enrollment.program_id
LEFT JOIN curriculums curriculum ON curriculum.curriculum_id = enrollment.curriculum_id
LEFT JOIN curriculum_subjects subject ON subject.curriculum_id = curriculum.curriculum_id
GROUP BY account.student_user_id, account.student_no, enrollment.enrollment_id,
         enrollment.status, enrollment.enrollment_state, enrollment.school_year,
         enrollment.semester, enrollment.program_id, program.program_code,
         program.program_name, enrollment.curriculum_id, curriculum.curriculum_id,
         curriculum.program_id, curriculum.status, curriculum.curriculum_code,
         curriculum.curriculum_version, curriculum.school_year,
         active_enrollments.active_rank
ORDER BY enrollment.school_year DESC NULLS LAST,
         CASE enrollment.semester WHEN 'MIDYEAR' THEN 3 WHEN 'SECOND' THEN 2 ELSE 1 END DESC,
         enrollment.enrollment_id DESC;

-- Published candidates are diagnostic only. The endpoint never substitutes one
-- of these for student_enrollments.curriculum_id.
WITH account_programs AS (
    SELECT DISTINCT enrollment.program_id
    FROM users
    JOIN studentprofiles profile ON profile.user_id = users.id
    JOIN student_enrollments enrollment ON enrollment.student_user_id = users.id
    WHERE LOWER(users.email) = LOWER(:'student_identity')
       OR LOWER(TRIM(profile.student_no)) = LOWER(TRIM(:'student_identity'))
)
SELECT program.program_id,
       program.program_code,
       program.program_name,
       curriculum.curriculum_id,
       curriculum.curriculum_code,
       curriculum.curriculum_version,
       curriculum.school_year,
       curriculum.status,
       COUNT(subject.subject_id) AS curriculum_subject_count
FROM account_programs
JOIN academic_programs program ON program.program_id = account_programs.program_id
JOIN curriculums curriculum ON curriculum.program_id = program.program_id
LEFT JOIN curriculum_subjects subject ON subject.curriculum_id = curriculum.curriculum_id
WHERE curriculum.status = 'PUBLISHED'
GROUP BY program.program_id, program.program_code, program.program_name,
         curriculum.curriculum_id, curriculum.curriculum_code,
         curriculum.curriculum_version, curriculum.school_year, curriculum.status,
         curriculum.published_at
ORDER BY curriculum.school_year DESC NULLS LAST,
         curriculum.published_at DESC NULLS LAST,
         curriculum.curriculum_id DESC;

ROLLBACK;
