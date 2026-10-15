-- Anne Laddon archive — initial schema
-- Core, always-queried facts are real columns; everything else lives in
-- artworks.attrs (JSON), described by field_defs.

CREATE TABLE field_defs (
  key         TEXT PRIMARY KEY
              CHECK (key GLOB '[a-z]*' AND key NOT GLOB '*[^a-z0-9_]*' AND length(key) <= 48),
  label       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('text','long_text','number','boolean','select','multi_select','url','fuzzy_date')),
  options     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options)),
  required    INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  help_text   TEXT,
  filterable  INTEGER NOT NULL DEFAULT 0 CHECK (filterable IN (0,1)),
  archived_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE artworks (
  id             TEXT PRIMARY KEY,
  catalog_id     TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL DEFAULT '',
  year_start     INTEGER CHECK (year_start IS NULL OR year_start BETWEEN 1800 AND 2100),
  year_end       INTEGER CHECK (year_end   IS NULL OR year_end   BETWEEN 1800 AND 2100),
  circa          INTEGER NOT NULL DEFAULT 0 CHECK (circa IN (0,1)),
  status         TEXT NOT NULL DEFAULT 'in_studio'
                 CHECK (status IN ('in_studio','on_show','sold','gifted','consigned','on_loan','lost','unknown')),
  attrs          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attrs) AND json_type(attrs) = 'object'),
  palette        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(palette)),
  ai_description TEXT,
  cover_image_id TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT,
  CHECK (year_end IS NULL OR year_start IS NULL OR year_end >= year_start)
);
CREATE INDEX idx_artworks_year   ON artworks(year_start) WHERE deleted_at IS NULL;
CREATE INDEX idx_artworks_status ON artworks(status)     WHERE deleted_at IS NULL;
CREATE INDEX idx_attrs_medium ON artworks(json_extract(attrs, '$.medium'));
CREATE INDEX idx_attrs_style  ON artworks(json_extract(attrs, '$.style'));

CREATE TABLE artwork_revisions (
  artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE RESTRICT,
  version    INTEGER NOT NULL,
  snapshot   TEXT NOT NULL CHECK (json_valid(snapshot)),
  changed_by TEXT,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (artwork_id, version)
);

-- Many images per piece: the finished work and its details, progress shots,
-- studies, and reference photos that led to it.
CREATE TABLE images (
  id           TEXT PRIMARY KEY,
  artwork_id   TEXT NOT NULL REFERENCES artworks(id) ON DELETE RESTRICT,
  kind         TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work','progress','study','reference')),
  role         TEXT NOT NULL DEFAULT '',
  r2_key       TEXT NOT NULL UNIQUE,
  display_key  TEXT,
  thumb_key    TEXT,
  sha256       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  palette      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(palette)),
  caption      TEXT,
  taken_on     TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  uploaded_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT
);
CREATE INDEX idx_images_artwork ON images(artwork_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_images_sha ON images(artwork_id, sha256);

-- Derived: full-text index, rewritten by the Worker on every change.
CREATE VIRTUAL TABLE artworks_fts USING fts5(
  artwork_id UNINDEXED, catalog_id, title, attrs_text, ai_description,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Derived: vectors for the local embedding provider (production uses Vectorize).
CREATE TABLE embeddings (
  artwork_id TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  vec        TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO field_defs (key, label, type, options, sort_order, filterable, help_text) VALUES
  ('medium',     'Medium',     'select',       '{"choices":["Oil","Pastel","Print","Serigraph","Watercolor","Mixed media"],"allowNew":true}', 10, 1, NULL),
  ('subjects',   'Subjects',   'multi_select', '{"choices":["Landscape","Water","Flowers","Abstract","Music & people","Sports","Rural","Night"],"allowNew":true}', 20, 1, NULL),
  ('style',      'Style',      'select',       '{"choices":["Representational","Abstract","Graphic"],"allowNew":true}', 30, 1, NULL),
  ('dimensions', 'Size',       'text',         '{"maxLength":120}', 40, 0, 'e.g. 24 × 36 in'),
  ('location',   'Location',   'text',         '{"maxLength":200}', 50, 0, 'Who has it now, or where it is kept'),
  ('series',     'Series',     'select',       '{"choices":[],"allowNew":true}', 60, 1, NULL),
  ('notes',      'Story & notes', 'long_text', '{"maxLength":20000}', 70, 0, 'Where it was painted, who has it now…');
