# Setup local PostgreSQL for SentinelOps dashboard (Windows)
# Usage (PowerShell as Admin optional):
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local-postgres.ps1

$ErrorActionPreference = "Stop"
$PgRoot = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -First 1

if (-not $PgRoot) {
  Write-Error "PostgreSQL not found under C:\Program Files\PostgreSQL. Install PostgreSQL 16 first."
}

$psql = Join-Path $PgRoot.FullName "bin\psql.exe"
$env:Path = (Join-Path $PgRoot.FullName "bin") + ";" + $env:Path
$env:PGPASSWORD = if ($env:POSTGRES_SUPER_PASSWORD) { $env:POSTGRES_SUPER_PASSWORD } else { "postgres" }

Write-Host "Using psql: $psql"
Write-Host "Creating role/database jenkins ..."

& $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -v ON_ERROR_STOP=1 -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jenkins') THEN CREATE ROLE jenkins LOGIN PASSWORD 'jenkins'; END IF; END `$`$;"
& $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -v ON_ERROR_STOP=1 -c "SELECT 'CREATE DATABASE jenkins OWNER jenkins' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'jenkins')\gexec"
& $psql -U postgres -h 127.0.0.1 -p 5432 -d jenkins -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE jenkins TO jenkins; GRANT ALL ON SCHEMA public TO jenkins;"

$Root = Split-Path -Parent $PSScriptRoot
& $psql -U jenkins -h 127.0.0.1 -p 5432 -d jenkins -v ON_ERROR_STOP=1 -f (Join-Path $Root "db\migrations\001_security_dashboard.sql")
& $psql -U jenkins -h 127.0.0.1 -p 5432 -d jenkins -v ON_ERROR_STOP=1 -f (Join-Path $Root "db\migrations\002_dashboard_users.sql")

Write-Host "PostgreSQL ready: host=127.0.0.1 db=jenkins user=jenkins password=jenkins"
Write-Host "Restart security-dashboard (npm run dev) and open Settings to create a user."
