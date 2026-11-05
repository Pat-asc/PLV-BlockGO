-- Keep each program's active curriculum pointer aligned with its current
-- published version. This repairs databases where migration 014 ran before a
-- later curriculum was published, while preserving cohort-specific mappings.
INSERT INTO program_curriculum_assignments
    (program_id, curriculum_id, assigned_by, assigned_at, updated_at)
SELECT DISTINCT ON (curriculum.program_id)
       curriculum.program_id,
       curriculum.curriculum_id,
       COALESCE(curriculum.reviewed_by, curriculum.created_by),
       COALESCE(curriculum.published_at, CURRENT_TIMESTAMP),
       CURRENT_TIMESTAMP
FROM curriculums curriculum
WHERE curriculum.status = 'PUBLISHED'
ORDER BY curriculum.program_id,
         curriculum.published_at DESC NULLS LAST,
         curriculum.updated_at DESC,
         curriculum.curriculum_id DESC
ON CONFLICT (program_id) DO UPDATE
SET curriculum_id = EXCLUDED.curriculum_id,
    assigned_by = EXCLUDED.assigned_by,
    assigned_at = EXCLUDED.assigned_at,
    updated_at = CURRENT_TIMESTAMP
WHERE program_curriculum_assignments.curriculum_id IS DISTINCT FROM EXCLUDED.curriculum_id;
