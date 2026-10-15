-- Archive: a reversible "out of sight" state for artworks and images, separate
-- from soft delete (deleted_at). Archived records stay in the database, the
-- nightly export, record.json and the search indexes; reads leave them out
-- unless asked (archived=include|only), so sample data can be tidied away and
-- brought back without loss.
ALTER TABLE artworks ADD COLUMN archived_at TEXT;
ALTER TABLE artworks ADD COLUMN archived_by TEXT;
ALTER TABLE images   ADD COLUMN archived_at TEXT;
ALTER TABLE images   ADD COLUMN archived_by TEXT;

-- Archived pieces are few: a small partial index serves the "only archived"
-- view and the id lookups search uses to leave them out.
CREATE INDEX idx_artworks_archived ON artworks(archived_at) WHERE deleted_at IS NULL AND archived_at IS NOT NULL;
-- The visible images of a piece, in carousel order (cover fallback, counts).
CREATE INDEX idx_images_visible ON images(artwork_id, sort_order) WHERE deleted_at IS NULL AND archived_at IS NULL;
