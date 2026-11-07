\set ON_ERROR_STOP on
\pset pager off

-- Read-only diagnostic. Override the default with:
-- psql ... -v record_id='another-uuid' -f scripts/diagnose-grade-finalization.sql
\if :{?record_id}
\else
\set record_id '401887be-d280-4f84-bd1c-6d27b8143400'
\endif

\echo '1) Staged grade and captured FacultySection'
SELECT
    pgr.id,
    pgr.status,
    pgr.term,
    pgr.faculty_id,
    pgr.student_no,
    pgr.student_name,
    pgr.assignment_cycle_id,
    pgr.program,
    pgr.course,
    pgr.section,
    pgr.subject_code,
    pgr.school_year AS grade_school_year,
    pgr.semester AS grade_semester,
    fs.id AS faculty_section_id,
    fs.user_id AS assignment_user_id,
    assignment_user.email AS assignment_faculty_email,
    fp.department AS faculty_profile_department,
    fs.department AS assignment_department,
    fs.section AS assignment_section,
    fs.subject AS assignment_subject,
    fs.academic_section_id,
    fs.school_year AS assignment_school_year,
    fs.semester AS assignment_semester,
    fs.is_active AS assignment_is_active,
    fs.deactivated_at,
    fs.deactivated_by
FROM pending_grade_records pgr
LEFT JOIN facultysections fs
  ON fs.id::text = pgr.assignment_cycle_id
LEFT JOIN users assignment_user
  ON assignment_user.id = fs.user_id
LEFT JOIN facultyprofiles fp
  ON fp.user_id = fs.user_id
WHERE pgr.id = :'record_id';

\echo '2) Current ACTIVE academic period'
SELECT academic_period_id, school_year, semester, term,
       start_date, end_date, status, opened_at, closed_at
FROM academic_periods
WHERE UPPER(BTRIM(status)) = 'ACTIVE'
ORDER BY opened_at DESC;

\echo '3) Faculty current active assignments'
WITH target AS (
    SELECT faculty_id
    FROM pending_grade_records
    WHERE id = :'record_id'
)
SELECT fs.id, u.email AS faculty_email, fs.department, fs.section, fs.subject,
       fs.academic_section_id, fs.school_year, fs.semester, fs.is_active
FROM target
JOIN users u
  ON LOWER(u.email) = LOWER(target.faculty_id)
JOIN facultysections fs
  ON fs.user_id = u.id
WHERE fs.is_active = TRUE
ORDER BY fs.school_year, fs.semester, fs.section, fs.subject, fs.id;

\echo '4) Captured-assignment and current-scope match checks'
WITH target AS (
    SELECT pgr.*, fs.user_id AS assignment_user_id,
           fs.department AS assignment_department,
           fs.section AS assignment_section,
           fs.subject AS assignment_subject,
           fs.school_year AS assignment_school_year,
           fs.semester AS assignment_semester,
           fs.is_active AS assignment_is_active,
           u.email AS assignment_faculty_email
    FROM pending_grade_records pgr
    LEFT JOIN facultysections fs
      ON fs.id::text = pgr.assignment_cycle_id
    LEFT JOIN users u
      ON u.id = fs.user_id
    WHERE pgr.id = :'record_id'
)
SELECT
    id,
    assignment_is_active,
    LOWER(BTRIM(COALESCE(assignment_faculty_email, ''))) = LOWER(BTRIM(COALESCE(faculty_id, '')))
        AS captured_faculty_matches,
    LOWER(BTRIM(COALESCE(assignment_department, ''))) IN (
        LOWER(BTRIM(COALESCE(program, ''))), LOWER(BTRIM(COALESCE(course, '')))
    ) AS captured_program_matches,
    LOWER(BTRIM(COALESCE(assignment_section, ''))) = LOWER(BTRIM(COALESCE(section, '')))
        AS captured_section_matches,
    LOWER(BTRIM(COALESCE(assignment_subject, ''))) = LOWER(BTRIM(COALESCE(subject_code, '')))
        AS captured_subject_matches,
    LOWER(BTRIM(COALESCE(assignment_school_year, ''))) = LOWER(BTRIM(COALESCE(school_year, '')))
        AS captured_school_year_matches,
    LOWER(BTRIM(COALESCE(assignment_semester, ''))) = LOWER(BTRIM(COALESCE(semester, '')))
        AS captured_semester_matches,
    EXISTS (
        SELECT 1
        FROM users current_user_record
        JOIN facultysections current_assignment
          ON current_assignment.user_id = current_user_record.id
         AND current_assignment.is_active = TRUE
        WHERE LOWER(current_user_record.email) = LOWER(target.faculty_id)
          AND LOWER(BTRIM(current_assignment.department)) IN (
              LOWER(BTRIM(COALESCE(target.program, ''))), LOWER(BTRIM(COALESCE(target.course, '')))
          )
          AND LOWER(BTRIM(current_assignment.section)) = LOWER(BTRIM(target.section))
          AND LOWER(BTRIM(current_assignment.subject)) = LOWER(BTRIM(target.subject_code))
          AND LOWER(BTRIM(current_assignment.school_year)) = LOWER(BTRIM(target.school_year))
          AND LOWER(BTRIM(current_assignment.semester)) = LOWER(BTRIM(target.semester))
    ) AS current_assignment_scope_includes_grade
FROM target;
