-- Prints (serigraphs, mylar lithographs): how many were pulled, and on what
-- paper. Shown next to Size. OR IGNORE: safe if someone already added them
-- through POST /api/fields.
INSERT OR IGNORE INTO field_defs (key, label, type, options, sort_order, filterable, help_text) VALUES
  ('edition', 'Edition', 'number', '{"integer":true,"min":1,"max":100000}', 42, 0, 'Prints: how many in the edition, e.g. 140'),
  ('paper', 'Paper', 'select', '{"choices":["Rives BFK","Fabriano","Arches","Somerset"],"allowNew":true}', 44, 1, 'Prints: the paper it was pulled on');
