-- Persist the normalized display schedule with the authoritative teaching load.
-- Existing assignments remain valid and receive an empty schedule until edited.
ALTER TABLE facultysections
    ADD COLUMN IF NOT EXISTS schedule VARCHAR(160);
