-- Vietnamese search: "ao khoac" must find "Áo khoác".
--
-- unaccent() is STABLE, not IMMUTABLE — its result depends on a dictionary that can
-- be changed — so Postgres refuses to build an index on it. The standard workaround
-- is an IMMUTABLE wrapper that pins the dictionary by name.
--
-- The cost of that promise: if the unaccent dictionary is ever modified, indexes
-- built on this function must be rebuilt (REINDEX). We do not modify it.
CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$;

-- GIN + trigram supports ILIKE '%…%', which a b-tree index cannot: a leading wildcard
-- makes an ordinary index useless.
CREATE INDEX "products_name_unaccent_trgm_idx"
  ON "products" USING gin (f_unaccent("name") gin_trgm_ops);
