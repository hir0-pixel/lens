[CmdletBinding()]
param([string]$EnvironmentFile)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) { $EnvironmentFile = Join-Path $scriptRoot ".env.local" }
if (-not (Test-Path -LiteralPath $EnvironmentFile)) { throw "Identity environment file not found: $EnvironmentFile" }

$lines = New-Object 'Collections.Generic.List[string]'
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) { $lines.Add($line) }
$entry = $lines | Where-Object { $_ -match '^LENS_SESSION_GATEWAY_COOKIE_SECRET=' } | Select-Object -First 1
$value = if ($entry) { ($entry -split '=', 2)[1].Trim() } else { "" }
if ($value.Length -lt 32) {
  $bytes = New-Object byte[] 32
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
  $value = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  if ($entry) {
    for ($index = 0; $index -lt $lines.Count; $index++) {
      if ($lines[$index] -match '^LENS_SESSION_GATEWAY_COOKIE_SECRET=') { $lines[$index] = "LENS_SESSION_GATEWAY_COOKIE_SECRET=$value" }
    }
  } else {
    $lines.Add("LENS_SESSION_GATEWAY_COOKIE_SECRET=$value")
  }
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllLines((Resolve-Path $EnvironmentFile), [string[]]$lines, $utf8)
  Write-Output "Generated the encrypted session-cookie credential; value was not displayed."
}

$composeFile = Join-Path $scriptRoot "compose.yaml"
docker compose --env-file $EnvironmentFile -f $composeFile up -d --force-recreate keycloak edge session_gateway
if ($LASTEXITCODE -ne 0) { throw "Production-pilot service recreation failed." }
docker compose --env-file $EnvironmentFile -f $composeFile ps
if ($LASTEXITCODE -ne 0) { throw "Production-pilot status check failed." }
