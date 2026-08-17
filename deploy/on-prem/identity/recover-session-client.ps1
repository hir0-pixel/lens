[CmdletBinding()]
param(
  [string]$EnvironmentFile
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
  $EnvironmentFile = Join-Path $scriptRoot ".env.local"
}
$composeFile = Join-Path $scriptRoot "compose.yaml"
$provisioner = Join-Path $scriptRoot "provision-session-client.ps1"

if (-not (Test-Path -LiteralPath $EnvironmentFile)) {
  throw "Identity environment file not found: $EnvironmentFile"
}

$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $idBytes = New-Object byte[] 8
  $secretBytes = New-Object byte[] 32
  $random.GetBytes($idBytes)
  $random.GetBytes($secretBytes)
} finally {
  $random.Dispose()
}
$temporaryClientId = "lens-recovery-" + (-join ($idBytes | ForEach-Object { $_.ToString("x2") }))
$temporaryClientSecret = -join ($secretBytes | ForEach-Object { $_.ToString("x2") })
$keycloakStarted = $false

try {
  docker compose --env-file $EnvironmentFile -f $composeFile stop keycloak
  if ($LASTEXITCODE -ne 0) { throw "Keycloak could not be stopped for admin recovery." }

  docker compose --env-file $EnvironmentFile -f $composeFile run --rm --no-deps `
    -e "KC_TEMP_ADMIN_CLIENT_ID=$temporaryClientId" `
    -e "KC_TEMP_ADMIN_CLIENT_SECRET=$temporaryClientSecret" `
    keycloak bootstrap-admin service `
    --client-id:env KC_TEMP_ADMIN_CLIENT_ID `
    --client-secret:env KC_TEMP_ADMIN_CLIENT_SECRET `
    --no-prompt
  if ($LASTEXITCODE -ne 0) { throw "Temporary Keycloak administrator creation failed." }

  docker compose --env-file $EnvironmentFile -f $composeFile up -d keycloak
  if ($LASTEXITCODE -ne 0) { throw "Keycloak could not be restarted after admin recovery." }
  $keycloakStarted = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    $container = docker compose --env-file $EnvironmentFile -f $composeFile ps -q keycloak
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($container)) {
      docker exec `
        -e "LENS_TEMP_ADMIN_CLIENT_ID=$temporaryClientId" `
        -e "LENS_TEMP_ADMIN_CLIENT_SECRET=$temporaryClientSecret" `
        $container /bin/sh -c '/opt/keycloak/bin/kcadm.sh config credentials --config /tmp/lens-recovery-ready.config --server http://localhost:8080 --realm master --client "$LENS_TEMP_ADMIN_CLIENT_ID" --secret "$LENS_TEMP_ADMIN_CLIENT_SECRET" >/dev/null 2>&1'
      if ($LASTEXITCODE -eq 0) {
        docker exec $container rm -f /tmp/lens-recovery-ready.config | Out-Null
        $ready = $true
        break
      }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw "Keycloak did not become ready after admin recovery." }

  & $provisioner `
    -EnvironmentFile $EnvironmentFile `
    -AdminClientId $temporaryClientId `
    -AdminClientSecret $temporaryClientSecret `
    -RemoveAdminClientAfterProvisioning
  if ($LASTEXITCODE -ne 0) { throw "Lens client provisioning with the temporary administrator failed." }

  docker compose --env-file $EnvironmentFile -f $composeFile restart session_gateway
  if ($LASTEXITCODE -ne 0) { throw "The session gateway could not be restarted." }

  Write-Output "Identity client recovery completed successfully."
} finally {
  if (-not $keycloakStarted) {
    docker compose --env-file $EnvironmentFile -f $composeFile up -d keycloak | Out-Null
  }
  $temporaryClientSecret = $null
}
