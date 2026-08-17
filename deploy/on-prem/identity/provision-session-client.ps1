[CmdletBinding()]
param(
  [string]$EnvironmentFile,
  [string]$AdminClientId,
  [string]$AdminClientSecret,
  [switch]$RemoveAdminClientAfterProvisioning
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
  $EnvironmentFile = Join-Path $scriptRoot ".env.local"
}
$composeFile = Join-Path $scriptRoot "compose.yaml"

if (-not (Test-Path -LiteralPath $EnvironmentFile)) {
  throw "Identity environment file not found: $EnvironmentFile"
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
  if ($line -match '^\s*(?:#|$)') { continue }
  $separator = $line.IndexOf('=')
  if ($separator -lt 1) { continue }
  $name = $line.Substring(0, $separator).Trim()
  $value = $line.Substring($separator + 1).Trim()
  if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  $settings[$name] = $value
}

$required = @(
  "LENS_SESSION_GATEWAY_CLIENT_ID",
  "LENS_SESSION_GATEWAY_CLIENT_SECRET",
  "LENS_SESSION_GATEWAY_ALLOWED_ORIGIN",
  "LENS_SESSION_GATEWAY_REDIRECT_URI"
)
$useAdminClient = -not [string]::IsNullOrWhiteSpace($AdminClientId) -or -not [string]::IsNullOrWhiteSpace($AdminClientSecret)
if ($useAdminClient -and ([string]::IsNullOrWhiteSpace($AdminClientId) -or [string]::IsNullOrWhiteSpace($AdminClientSecret))) {
  throw "Both temporary admin client values are required."
}
if (-not $useAdminClient) {
  $required = @("LENS_IDENTITY_ADMIN_USERNAME", "LENS_IDENTITY_ADMIN_PASSWORD") + $required
}
foreach ($name in $required) {
  if (-not $settings.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($settings[$name])) {
    throw "Required identity setting is missing: $name"
  }
}
if ($settings.LENS_SESSION_GATEWAY_CLIENT_SECRET.Length -lt 32) {
  throw "The session gateway client secret must contain at least 32 characters."
}

$container = docker compose --env-file $EnvironmentFile -f $composeFile ps -q keycloak
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($container)) {
  throw "The Keycloak container is not running."
}

$provision = @'
set -eu
KCADM=/opt/keycloak/bin/kcadm.sh
CONFIG=/tmp/lens-kcadm.config
cleanup() {
  status=$?
  set +e
  if [ "${LENS_REMOVE_ADMIN_CLIENT:-0}" = "1" ] && [ -f "$CONFIG" ]; then
    admin_uuid="$("$KCADM" get clients --config "$CONFIG" -r master -q "clientId=$LENS_ADMIN_CLIENT_ID" --fields id --format csv --noquotes 2>/dev/null | tail -n 1 | tr -d '\r')"
    if [ -n "$admin_uuid" ] && [ "$admin_uuid" != "id" ] && "$KCADM" delete "clients/$admin_uuid" --config "$CONFIG" -r master >/dev/null 2>&1; then
      echo "Temporary admin service account removed."
    else
      echo "Temporary admin service account cleanup failed." >&2
      if [ "$status" -eq 0 ]; then status=1; fi
    fi
  fi
  rm -f "$CONFIG"
  exit "$status"
}
trap cleanup EXIT

if [ -n "${LENS_ADMIN_CLIENT_ID:-}" ]; then
  "$KCADM" config credentials --config "$CONFIG" --server http://localhost:8080 --realm master --client "$LENS_ADMIN_CLIENT_ID" --secret "$LENS_ADMIN_CLIENT_SECRET" >/dev/null
else
  "$KCADM" config credentials --config "$CONFIG" --server http://localhost:8080 --realm master --user "$LENS_ADMIN_USERNAME" --password "$LENS_ADMIN_PASSWORD" >/dev/null
fi

client_uuid="$("$KCADM" get clients --config "$CONFIG" -r lens-internal -q "clientId=$LENS_CLIENT_ID" --fields id --format csv --noquotes | tail -n 1 | tr -d '\r')"
if [ "$client_uuid" = "id" ]; then client_uuid=""; fi

set_client_values() {
  "$KCADM" "$@" --config "$CONFIG" -r lens-internal \
    -s "clientId=$LENS_CLIENT_ID" \
    -s 'name=Lens Session Gateway' \
    -s enabled=true \
    -s clientAuthenticatorType=client-secret \
    -s "secret=$LENS_CLIENT_SECRET" \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s bearerOnly=false \
    -s standardFlowEnabled=true \
    -s implicitFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s serviceAccountsEnabled=false \
    -s frontchannelLogout=false \
    -s "redirectUris=[\"$LENS_REDIRECT_URI\"]" \
    -s "webOrigins=[\"$LENS_ALLOWED_ORIGIN\"]" \
    -s 'attributes={"pkce.code.challenge.method":"S256"}' >/dev/null
}

if [ -z "$client_uuid" ]; then
  set_client_values create clients
  echo "Lens session client created."
else
  set_client_values update "clients/$client_uuid"
  echo "Lens session client updated."
fi

'@
$provision = $provision.Replace("`r`n", "`n").Replace("`r", "`n")
$encodedProvision = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($provision))

docker exec `
  -e "LENS_ADMIN_USERNAME=$($settings.LENS_IDENTITY_ADMIN_USERNAME)" `
  -e "LENS_ADMIN_PASSWORD=$($settings.LENS_IDENTITY_ADMIN_PASSWORD)" `
  -e "LENS_ADMIN_CLIENT_ID=$AdminClientId" `
  -e "LENS_ADMIN_CLIENT_SECRET=$AdminClientSecret" `
  -e "LENS_REMOVE_ADMIN_CLIENT=$(if ($RemoveAdminClientAfterProvisioning) { '1' } else { '0' })" `
  -e "LENS_CLIENT_ID=$($settings.LENS_SESSION_GATEWAY_CLIENT_ID)" `
  -e "LENS_CLIENT_SECRET=$($settings.LENS_SESSION_GATEWAY_CLIENT_SECRET)" `
  -e "LENS_ALLOWED_ORIGIN=$($settings.LENS_SESSION_GATEWAY_ALLOWED_ORIGIN)" `
  -e "LENS_REDIRECT_URI=$($settings.LENS_SESSION_GATEWAY_REDIRECT_URI)" `
  $container /bin/sh -c "printf '%s' '$encodedProvision' | base64 -d | /bin/sh"

if ($LASTEXITCODE -ne 0) {
  throw "Keycloak client provisioning failed."
}
