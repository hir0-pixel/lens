[CmdletBinding()]
param(
  [string]$EnvironmentFile,
  [string]$EvidenceDirectory,
  [ValidateRange(1, 200)][int]$Requests = 10,
  [ValidateRange(1, 20)][int]$Concurrency = 2
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) { $EnvironmentFile = Join-Path $scriptRoot ".env.local" }
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) { $EvidenceDirectory = Join-Path $HOME "LensReadinessEvidence" }
if (-not (Test-Path -LiteralPath $EnvironmentFile)) { throw "Identity environment file not found: $EnvironmentFile" }
if ($Concurrency -gt $Requests) { throw "Concurrency cannot exceed request count." }

$composeFile = Join-Path $scriptRoot "compose.yaml"
$requiredServices = @("database", "keycloak", "edge", "session_gateway")
foreach ($service in $requiredServices) {
  $container = docker compose --env-file $EnvironmentFile -f $composeFile ps -q $service
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($container)) { throw "Required service is not running: $service" }
  $state = docker inspect --format '{{.State.Status}}' $container
  if ($LASTEXITCODE -ne 0 -or $state.Trim() -ne "running") { throw "Required service is not stable: $service" }
}

$json = docker compose --env-file $EnvironmentFile -f $composeFile exec -T session_gateway node scripts/readiness/identity-pilot-evidence.mjs $Requests $Concurrency
if ($LASTEXITCODE -ne 0) { throw "Production-pilot readiness probes failed." }
$evidence = $json | ConvertFrom-Json
if (-not $evidence.passed) { throw "Production-pilot readiness evidence did not pass." }

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$evidencePath = Join-Path $EvidenceDirectory ("production-pilot-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($evidencePath, ($evidence | ConvertTo-Json -Depth 8), $utf8)
Write-Output "Production-pilot readiness passed: $evidencePath"
