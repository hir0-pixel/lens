[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$BackupFile, [string]$EvidenceDirectory)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) { $EvidenceDirectory = Join-Path $HOME "LensReadinessEvidence" }
if (-not (Test-Path -LiteralPath $BackupFile)) { throw "Backup file not found: $BackupFile" }
$name = "lens-restore-check-" + [guid]::NewGuid().ToString("N").Substring(0, 12)
$passwordBytes = New-Object byte[] 24
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
$password = -join ($passwordBytes | ForEach-Object { $_.ToString("x2") })
try {
  docker run -d --name $name -e POSTGRES_DB=lens_restore -e POSTGRES_USER=lens_restore -e "POSTGRES_PASSWORD=$password" --tmpfs /var/lib/postgresql/data postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Isolated restore database could not start." }
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $name pg_isready -U lens_restore -d lens_restore 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw "Isolated restore database did not become ready." }
  docker cp $BackupFile "${name}:/tmp/identity.dump"
  if ($LASTEXITCODE -ne 0) { throw "Backup could not be copied into the restore container." }
  docker exec -e "PGPASSWORD=$password" $name pg_restore --exit-on-error --no-owner --no-privileges --username lens_restore --dbname lens_restore /tmp/identity.dump
  if ($LASTEXITCODE -ne 0) { throw "Backup restore verification failed." }
  $realmCount = docker exec -e "PGPASSWORD=$password" $name psql --tuples-only --no-align --username lens_restore --dbname lens_restore --command "SELECT COUNT(*) FROM realm;"
  if ($LASTEXITCODE -ne 0 -or [int]$realmCount -lt 1) { throw "Restored backup does not contain a Keycloak realm." }
  New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
  $evidence = [ordered]@{ schemaVersion = 1; evidenceKind = "single-server-identity-restore"; verifiedAt = (Get-Date).ToUniversalTime().ToString("o"); backupSha256 = (Get-FileHash -LiteralPath $BackupFile -Algorithm SHA256).Hash.ToLowerInvariant(); realmCount = [int]$realmCount; isolatedTmpfsRestore = $true; passed = $true }
  $evidencePath = Join-Path $EvidenceDirectory ("identity-restore-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
  $evidence | ConvertTo-Json | Set-Content -LiteralPath $evidencePath -Encoding UTF8
  Write-Output "Restore verification passed: $evidencePath"
} finally {
  docker rm -f $name 2>$null | Out-Null
  $password = $null
}
