-- Wipes the schema so every test run starts from the same state. Only ever run
-- against the test database (see the db:test:prepare script): it destroys all data.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
