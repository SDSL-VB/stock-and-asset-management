-- The transaction log: every row inserted, changed or deleted in SD-SIM, with
-- the old and new values, the database login, and the time. Written by
-- triggers, so it records changes whichever way they were made — the app, a
-- script, or someone at a psql prompt.
--
-- Only the superuser can read it, and nobody can change it: the app's login
-- (sim_app) has no access to the audit schema at all, and the triggers write
-- through a SECURITY DEFINER function owned by the superuser.
--
-- Safe to re-run. deploy.sh runs it after every migration so that tables a
-- migration adds are covered too:
--   docker compose ... exec -T sim-db psql -U sim_admin -d sim -f /sim-db-scripts/audit.sql

CREATE SCHEMA IF NOT EXISTS audit;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;

CREATE TABLE IF NOT EXISTS audit.log (
  id          bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  tx          bigint      NOT NULL DEFAULT txid_current(),
  db_user     text        NOT NULL DEFAULT session_user,
  table_name  text        NOT NULL,
  op          text        NOT NULL,          -- INSERT, UPDATE, DELETE, TRUNCATE
  row_id      text,
  old_row     jsonb,
  new_row     jsonb
);
CREATE INDEX IF NOT EXISTS log_at_idx    ON audit.log (at);
CREATE INDEX IF NOT EXISTS log_table_idx ON audit.log (table_name, row_id);
REVOKE ALL ON audit.log FROM PUBLIC;

-- Password hashes and the password vault never enter the log
CREATE OR REPLACE FUNCTION audit.scrub(r jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT r - 'password' - 'passwordEnc'
$$;

CREATE OR REPLACE FUNCTION audit.record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    INSERT INTO audit.log (table_name, op) VALUES (TG_TABLE_NAME, TG_OP);
    RETURN NULL;
  END IF;
  INSERT INTO audit.log (table_name, op, row_id, old_row, new_row) VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ->> 'id' ELSE to_jsonb(NEW) ->> 'id' END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN audit.scrub(to_jsonb(OLD)) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN audit.scrub(to_jsonb(NEW)) END
  );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION audit.record() FROM PUBLIC;

-- Attach to every table in the app's schema, except Prisma's bookkeeping and
-- login_failures: failed sign-ins are counted there, so logging them would let
-- anyone fill the disk by guessing passwords (Caddy's access log has them)
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('_prisma_migrations', 'login_failures')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_rows' AND tgrelid = format('public.%I', t.relname)::regclass) THEN
      EXECUTE format('CREATE TRIGGER audit_rows AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit.record()', t.relname);
      EXECUTE format('CREATE TRIGGER audit_truncate AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.record()', t.relname);
    END IF;
  END LOOP;
END $$;

-- Prisma's migration history is the owner's alone: the app has no business
-- reading it, and rewriting it could make a migration run twice or never
-- (absent on the very first start, before any migration has run)
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON public._prisma_migrations FROM sim_app;
  END IF;
END $$;
