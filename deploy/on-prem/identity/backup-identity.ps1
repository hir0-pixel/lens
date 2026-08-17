[CmdletBinding()]
param(
  [string]$EnvironmentFile,
  [string]$OutputDirectory,
  [switch]$EncryptedDestinationConfirmed
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) { $EnvironmentFile = Join-Path $scriptRoot ".env.local" }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $HOME "LensBackups" }
if (-not $EncryptedDestinationConfirmed) { throw "Backups may contain identity data. Use only an encrypted destination and pass -EncryptedDestinationConfirmed." }
if (-not (Test-Path -LiteralPath $EnvironmentFile)) { throw "Identity environment file not found: $EnvironmentFile" }

$settings = @{}
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
  if ($line -match '^\s*(?:#|$)') { continue }
  $separator = $line.IndexOf('=')
  if ($separator -gt 0) { $settings[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1).Trim() }
}
foreach ($name in @("LENS_IDENTITY_DATABASE_NAME", "LENS_IDENTITY_DATABASE_USER", "LENS_IDENTITY_DATABASE_PASSWORD")) {
  if ([string]::IsNullOrWhiteSpace($settings[$name])) { throw "Required database setting is missing: $name" }
}

$composeFile = Join-Path $scriptRoot "compose.yaml"
$container = docker compose --env-file $EnvironmentFile -f $composeFile ps -q database
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($container)) { throw "The identity database is not running." }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$remote = "/tmp/lens-identity-$stamp.dump"
$backup = Join-Path $OutputDirectory "lens-identity-$stamp.dump"
try {
  docker exec -e "PGPASSWORD=$($settings.LENS_IDENTITY_DATABASE_PASSWORD)" $container pg_dump --format=custom --no-owner --no-privileges --username $settings.LENS_IDENTITY_DATABASE_USER --dbname $settings.LENS_IDENTITY_DATABASE_NAME --file $remote
  if ($LASTEXITCODE -ne 0) { throw "Identity backup creation failed." }
  docker cp "${container}:$remote" $backup
  if ($LASTEXITCODE -ne 0) { throw "Identity backup copy failed." }
} finally {
  docker exec $container rm -f $remote 2>$null | Out-Null
}
$hash = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant()
$metadata = [ordered]@{ schemaVersion = 1; createdAt = (Get-Date).ToUniversalTime().ToString("o"); backupFile = (Split-Path -Leaf $backup); sha256 = $hash; encryptedDestinationConfirmed = $true }
$metadataPath = "$backup.json"
$metadata | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding UTF8
Write-Output "Backup created: $backup"
Write-Output "SHA256: $hash"
