param(
  [string]$Base = "https://mcp.alfatek.store",
  [string]$Redirect = "https://chatgpt.com/connector/oauth/final-callback",
  [string]$State = "smoke-state-123",
  [string]$Verifier = "pkce-verifier-very-long-value-1234567890"
)

$ErrorActionPreference = "Stop"

function Step($text) {
  Write-Host ""
  Write-Host "==> $text" -ForegroundColor Cyan
}

function Pass($text) {
  Write-Host "[PASS] $text" -ForegroundColor Green
}

function Fail($text) {
  Write-Host "[FAIL] $text" -ForegroundColor Red
  exit 1
}

try {
  Step "Compute PKCE challenge"
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($Verifier)
  $hash = $sha.ComputeHash($bytes)
  $challenge = [Convert]::ToBase64String($hash).TrimEnd('=').Replace('+','-').Replace('/','_')
  Pass "PKCE challenge generated"

  Step "Register DCR client"
  $regBody = @{
    redirect_uris = @($Redirect)
    token_endpoint_auth_method = "none"
    grant_types = @("authorization_code")
    response_types = @("code")
  } | ConvertTo-Json -Depth 5

  $reg = Invoke-RestMethod -Method Post -Uri "$Base/oauth/register" -ContentType "application/json" -Body $regBody
  $clientId = [string]$reg.client_id
  if (-not $clientId) { Fail "No client_id returned from /oauth/register" }
  Pass "Registered client_id: $clientId"

  Step "Authorize and capture redirect code/state"
  $authUrl = "$Base/oauth/authorize?response_type=code&client_id=$([uri]::EscapeDataString($clientId))&redirect_uri=$([uri]::EscapeDataString($Redirect))&state=$([uri]::EscapeDataString($State))&code_challenge=$([uri]::EscapeDataString($challenge))&code_challenge_method=S256"
  $authResp = Invoke-WebRequest -Method Get -Uri $authUrl -MaximumRedirection 0 -ErrorAction SilentlyContinue
  $loc = $authResp.Headers.Location
  if (-not $loc) { Fail "No Location header from /oauth/authorize" }

  $u = [uri]$loc
  $q = [System.Web.HttpUtility]::ParseQueryString($u.Query)
  $code = $q["code"]
  $stateBack = $q["state"]
  if (-not $code) { Fail "No authorization code in redirect URL" }
  if ($stateBack -ne $State) { Fail "State mismatch. expected='$State' got='$stateBack'" }
  Pass "Authorize returned code and matching state"

  Step "Exchange code for access token"
  $tokenForm = @{
    grant_type = "authorization_code"
    code = $code
    client_id = $clientId
    redirect_uri = $Redirect
    code_verifier = $Verifier
  }

  $token = Invoke-RestMethod -Method Post -Uri "$Base/oauth/token" -ContentType "application/x-www-form-urlencoded" -Body $tokenForm
  $accessToken = [string]$token.access_token
  $tokenType = [string]$token.token_type
  $expiresIn = $token.expires_in
  if (-not $accessToken) { Fail "No access_token returned from /oauth/token" }
  if ($tokenType -ne "Bearer") { Fail "token_type expected 'Bearer', got '$tokenType'" }
  if (-not $expiresIn) { Fail "expires_in missing from /oauth/token response" }
  Pass "Token exchange succeeded (expires_in=$expiresIn)"

  Step "Call /mcp tools/list with OAuth bearer token"
  $headers = @{
    Authorization = "Bearer $accessToken"
    Accept = "application/json, text/event-stream"
    "MCP-Protocol-Version" = "2025-03-26"
  }
  $body = '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}'
  $r = Invoke-WebRequest -Method Post -Uri "$Base/mcp" -Headers $headers -ContentType "application/json" -Body $body
  if ($r.StatusCode -ne 200) { Fail "MCP call failed with status $($r.StatusCode)" }
  Pass "MCP tools/list succeeded (HTTP 200)"

  Write-Host ""
  Write-Host "OAuth smoke test completed successfully." -ForegroundColor Green
} catch {
  Fail $_.Exception.Message
}
