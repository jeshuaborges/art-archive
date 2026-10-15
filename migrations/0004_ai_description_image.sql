-- Where a piece's description came from. The vision model describes the main
-- image; this records which image that was, so a new main image gets a new
-- description. NULL with a description means a person wrote it (never replaced
-- automatically); NULL without one means there is nothing yet.
ALTER TABLE artworks ADD COLUMN ai_description_image_id TEXT;

-- Every description so far was written by the vision model for the main image of
-- the time: credit it to the current cover, so it is replaced when that changes.
UPDATE artworks SET ai_description_image_id = cover_image_id
 WHERE ai_description IS NOT NULL AND trim(ai_description) <> '';
