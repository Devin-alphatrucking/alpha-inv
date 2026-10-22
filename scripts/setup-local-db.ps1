# One-shot: create local invoice_crm DB on PostgreSQL 17, then restore SCRAM auth.
$ErrorActionPreference = "Stop"
$pgBin = "C:\Program Files\PostgreSQL\17\bin"
$pgData = "C:\Program Files\PostgreSQL\17\data"
$pgHba = Join-Path $pgData "pg_hba.conf"
$log = "C:\work\sanavi-invoice\scripts\setup-local-db.log"
$sqlFile = "C:\work\sanavi-invoice\scripts\setup-local-db.sql"

function Log([string]$msg) {
  $line = "$(Get-Date -Format o) $msg"
  Add-Content -Path $log -Value $line
  Write-Host $line
}

function Restore-Scram {
  if (Test-Path "$pgHba.before-trust") {
    Copy-Item "$pgHba.before-trust" $pgHba -Force
  } elseif (Test-Path (Join-Path $pgData "pg_hba.conf.bak.sanavi")) {
    Copy-Item (Join-Path $pgData "pg_hba.conf.bak.sanavi") $pgHba -Force
  }
  & "$pgBin\pg_ctl.exe" reload -D $pgData | Out-Null
  Log "SCRAM auth restored"
}

try {
  Set-Content -Path $log -Value ""
  Log "Starting local DB setup (pass 4)"

  $backup = Join-Path $pgData "pg_hba.conf.bak.sanavi"
  if (-not (Test-Path $backup)) { Copy-Item $pgHba $backup -Force }
  if (-not (Test-Path "$pgHba.before-trust")) { Copy-Item $pgHba "$pgHba.before-trust" -Force }

  $content = Get-Content $pgHba -Raw
  if ($content -match '(?m)^host\s+all\s+all\s+127\.0\.0\.1/32\s+scram-sha-256') {
    $patched = $content -replace '(?m)^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)scram-sha-256', '${1}trust'
    $patched = $patched -replace '(?m)^(host\s+all\s+all\s+::1/128\s+)scram-sha-256', '${1}trust'
    Set-Content -Path $pgHba -Value $patched -NoNewline
    & "$pgBin\pg_ctl.exe" reload -D $pgData | Out-Null
    Start-Sleep -Seconds 1
    Log "Enabled temporary trust auth"
  } else {
    Log "Trust auth already active"
  }

  & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d postgres -v ON_ERROR_STOP=1 -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw "role setup failed" }
  Log "role invoice_crm ensured"

  $countOut = & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d postgres -tAc "SELECT COUNT(*) FROM pg_database WHERE datname='invoice_crm'"
  if ($LASTEXITCODE -ne 0) { throw "db existence check failed: $countOut" }
  $dbExists = ("$countOut").Trim()
  Log "db_exists_count=$dbExists"

  if ($dbExists -eq "0") {
    & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE invoice_crm OWNER invoice_crm;"
    if ($LASTEXITCODE -ne 0) { throw "CREATE DATABASE failed" }
    Log "database created"
  } else {
    & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d postgres -c "ALTER DATABASE invoice_crm OWNER TO invoice_crm;"
    Log "database already exists; owner updated"
  }

  & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d invoice_crm -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO invoice_crm; ALTER SCHEMA public OWNER TO invoice_crm;"
  if ($LASTEXITCODE -ne 0) { throw "schema grant failed" }
  Log "schema permissions granted"

  Restore-Scram

  $env:PGPASSWORD = "invoice_crm_dev_password"
  $check = & "$pgBin\psql.exe" -U invoice_crm -h 127.0.0.1 -p 5432 -d invoice_crm -tAc "SELECT 'connected'"
  $code = $LASTEXITCODE
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $checkText = ("$check").Trim()
  Log "app_user_check=$checkText exit=$code"
  if ($code -ne 0 -or $checkText -ne "connected") { throw "App user could not connect after restore" }

  Log "SUCCESS"
  exit 0
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  try { Restore-Scram } catch { Log "restore failed: $($_.Exception.Message)" }
  exit 1
}
