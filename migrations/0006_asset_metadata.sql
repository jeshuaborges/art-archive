-- Originals as archival assets: what each file is (read from its headers), the
-- name it arrived with, and when its bytes were last re-read and checked against
-- the SHA-256 recorded at upload (fixity).
ALTER TABLE images ADD COLUMN original_name TEXT;
ALTER TABLE images ADD COLUMN tech TEXT CHECK (tech IS NULL OR json_valid(tech));
ALTER TABLE images ADD COLUMN tech_read_at TEXT;
ALTER TABLE images ADD COLUMN fixity_checked_at TEXT;
ALTER TABLE images ADD COLUMN fixity_ok INTEGER CHECK (fixity_ok IS NULL OR fixity_ok IN (0,1));
CREATE INDEX idx_images_fixity ON images(fixity_checked_at) WHERE deleted_at IS NULL;
