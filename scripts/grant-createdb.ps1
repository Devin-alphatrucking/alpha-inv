$ErrorActionPreference = "Stop"
$pgBin = "C:\Program Files\PostgreSQL\17\bin"
$pgData = "C:\Program Files\PostgreSQL\17\data"
$pgHba = Join-Path $pgData "pg_hba.conf"
$log = "C:\work\sanavi-invoice\scripts\grant-createdb.log"

function Log([string]$msg) { Add-Content $log $msg; Write-Host $msg }

Set-Content $log ""
if (-not (Test-Path "$pgHba.before-trust")) { Copy-Item $pgHba "$pgHba.before-trust" -Force }
$content = Get-Content $pgHba -Raw
$patched = $content -replace '(?m)^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)scram-sha-256', '${1}trust'
$patched = $patched -replace '(?m)^(host\s+all\s+all\s+::1/128\s+)scram-sha-256', '${1}trust'
Set-Content -Path $pgHba -Value $patched -NoNewline
& "$pgBin\pg_ctl.exe" reload -D $pgData | Out-Null
Start-Sleep -Seconds 1

& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE invoice_crm CREATEDB;"
if ($LASTEXITCODE -ne 0) { Copy-Item "$pgHba.before-trust" $pgHba -Force; & "$pgBin\pg_ctl.exe" reload -D $pgData | Out-Null; throw "ALTER ROLE failed" }
Log "CREATEDB granted"

Copy-Item "$pgHba.before-trust" $pgHba -Force
& "$pgBin\pg_ctl.exe" reload -D $pgData | Out-Null
Log "SUCCESS"
