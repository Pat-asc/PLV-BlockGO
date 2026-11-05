-- Allow an archived academic section to be recreated while
-- preventing more than one active section with the same identity.

BEGIN;

ALTER TABLE academicsections
    DROP CONSTRAINT IF EXISTS academicsections_department_year_level_section_num_key;

DROP INDEX IF EXISTS idx_academicsections_active_department;

CREATE UNIQUE INDEX IF NOT EXISTS ux_academicsections_active_department_year_section
    ON academicsections (
        LOWER(department),
        year_level,
        section_num
    )
    WHERE is_active = TRUE;

COMMIT;
