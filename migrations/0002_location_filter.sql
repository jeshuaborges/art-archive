-- Location is free text, but it's useful to filter by: the filter sheet offers
-- the distinct values in use for any filterable text field.
UPDATE field_defs SET filterable = 1 WHERE key = 'location';
