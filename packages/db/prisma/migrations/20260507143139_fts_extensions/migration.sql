-- FTS, trigram, unaccent, pgvector setup.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS vector;

-- Russian-weighted full-text search vector. Title weighted A, body B.
ALTER TABLE "Document"
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce("rawText", '')), 'B')
  ) STORED;

CREATE INDEX document_search_idx ON "Document" USING GIN(search_vector);

-- Trigram index for fuzzy title search.
CREATE INDEX document_title_trgm_idx ON "Document" USING GIN(title gin_trgm_ops);

-- Trigram index for entity name fuzzy lookup.
CREATE INDEX entity_name_trgm_idx ON "Entity" USING GIN(name gin_trgm_ops);
