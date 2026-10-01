#!/bin/sh
# Runs ONCE, when sim-db starts on an empty data volume (Postgres' own
# /docker-entrypoint-initdb.d hook). Sets up who may do what in the database:
#
#   sim_admin  superuser (POSTGRES_USER). You, over SSH, and deploy.sh for the
#              audit setup. Only this login can read the audit log.
#   sim_owner  owns the schema. Migrations and fresh-start run as it.
#   sim_app    the running app: reads and writes rows, nothing else. It cannot
#              change tables, disable the audit triggers, or see the audit log.
#
# After this, deploy/db/audit.sql creates the transaction log.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname sim \
  -v owner_pw="$SIM_OWNER_PASSWORD" -v app_pw="$SIM_APP_PASSWORD" <<'SQL'
CREATE ROLE sim_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE sim_app   LOGIN PASSWORD :'app_pw' CONNECTION LIMIT 30;

-- Nobody connects to a database unless named here
REVOKE ALL ON DATABASE sim FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE sim TO sim_owner, sim_app;

-- The schema belongs to sim_owner; the app may only use what is in it
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO sim_owner;
GRANT USAGE ON SCHEMA public TO sim_app;

-- Every table and sequence the migrations create: rows only, for the app
ALTER DEFAULT PRIVILEGES FOR ROLE sim_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sim_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sim_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sim_app;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname sim -f /sim-db-scripts/audit.sql
