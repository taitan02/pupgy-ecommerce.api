-- Wipes the schema so every test run starts from the same state. Only ever run
-- against the test database (see the db:test:prepare script): it destroys all data.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Extensions live inside the schema, so dropping it drops them too. Recreating them
-- here keeps this one command sufficient: locally and in CI the test database is
-- always in the same shape as dev, where the Postgres image installs them at init.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
