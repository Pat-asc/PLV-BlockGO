-- Teaching assignments must identify one academic section and period. Legacy
-- rows remain readable, but ambiguous rows are deliberately left unresolved.
ALTER TABLE facultysections
    ADD COLUMN IF NOT EXISTS academic_section_id INTEGER REFERENCES academicsections(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS school_year VARCHAR(20),
    ADD COLUMN IF NOT EXISTS semester VARCHAR(20),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deactivated_by VARCHAR(255);

-- academicsections is not period-specific, so its ID can be backfilled when
-- the legacy department/year/section label identifies exactly one section.
WITH section_candidates AS (
    SELECT fs.id AS faculty_section_id, MIN(s.id) AS academic_section_id
    FROM facultysections fs
    JOIN academicsections s
      ON LOWER(TRIM(s.department)) = LOWER(TRIM(fs.department))
     AND s.year_level::text = TRIM(fs.year_level)
     AND (
          TRIM(fs.section) = s.section_num::text
          OR SUBSTRING(fs.section FROM '([1-4]-[0-9]+)') = CONCAT(s.year_level, '-', s.section_num)
     )
    WHERE fs.academic_section_id IS NULL
    GROUP BY fs.id
    HAVING COUNT(DISTINCT s.id) = 1
)
UPDATE facultysections fs
SET academic_section_id = candidate.academic_section_id
FROM section_candidates candidate
WHERE fs.id = candidate.faculty_section_id;

-- Backfill a period only when exactly one distinct enrollment period exists.
-- No newest-row heuristic is used.
WITH period_candidates AS (
    SELECT fs.id AS faculty_section_id,
           MIN(e.school_year) AS school_year,
           MIN(e.semester) AS semester
    FROM facultysections fs
    JOIN student_enrollments e ON e.academic_section_id = fs.academic_section_id
    WHERE fs.school_year IS NULL AND fs.semester IS NULL
    GROUP BY fs.id
    HAVING COUNT(DISTINCT (e.school_year, e.semester)) = 1
)
UPDATE facultysections fs
SET school_year = candidate.school_year,
    semester = candidate.semester
FROM period_candidates candidate
WHERE fs.id = candidate.faculty_section_id;

DROP INDEX IF EXISTS idx_unique_faculty_section;

CREATE UNIQUE INDEX IF NOT EXISTS ux_facultysections_exact_active_assignment
    ON facultysections (user_id, academic_section_id, school_year, semester, LOWER(subject))
    WHERE is_active = TRUE
      AND academic_section_id IS NOT NULL
      AND school_year IS NOT NULL
      AND semester IS NOT NULL
      AND subject IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_facultysections_roster_scope
    ON facultysections (academic_section_id, school_year, semester)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_facultysections_faculty_active
    ON facultysections (user_id, is_active);
