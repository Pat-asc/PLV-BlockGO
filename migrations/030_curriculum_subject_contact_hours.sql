BEGIN;

-- Older installations may already have curriculum_subjects from before contact
-- hours were introduced. CREATE TABLE IF NOT EXISTS does not add later columns,
-- so make the upgrade explicit and safe to rerun.
ALTER TABLE IF EXISTS curriculum_subjects
    ADD COLUMN IF NOT EXISTS lecture_hours NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS curriculum_subjects
    ADD COLUMN IF NOT EXISTS laboratory_hours NUMERIC(5,2) NOT NULL DEFAULT 0;

COMMIT;
