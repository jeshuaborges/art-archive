-- Anne's own inventory number for a piece ("OP 1154": OP oil, PA pastel), set by
-- the importer and by hand. Shown first in the form; not a filter (each value is
-- unique), but search ranks an exact number first. OR IGNORE: safe if someone
-- already added the field through POST /api/fields.
INSERT OR IGNORE INTO field_defs (key, label, type, options, sort_order, filterable, help_text) VALUES
  ('inventory', 'Inventory no.', 'text', '{"maxLength":40}', 5, 0, 'Anne''s own number, e.g. OP 1154 (OP oil, PA pastel)');
