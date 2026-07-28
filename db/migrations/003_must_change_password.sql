-- Force password change flag for dashboard users
-- Apply with: psql -h 127.0.0.1 -U jenkins -d jenkins -f db/migrations/003_must_change_password.sql

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- App ensureDefaultAdmin() sets this TRUE only while password is still the default "admin".
