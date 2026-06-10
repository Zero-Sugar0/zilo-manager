param(
  [ValidateSet("github", "npm")]
  [string]$Source = "github",
  [string]$GitHubPackage = "github:zester4/zilo-manager",
  [string]$NpmPackage = "zilmate",
  [switch]$NoSetup,
  [switch]$NoPing,
  [switch]$NoTalk
)

$ErrorActionPreference = "Stop"

function Require-Command($Name, $InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $InstallHint"
  }
}

function Invoke-Step($Label, $Command) {
  Write-Host "`n$Label" -ForegroundColor Cyan
  $program = $Command[0]
  $arguments = @($Command | Select-Object -Skip 1)
  & $program @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $($Command -join ' ')"
  }
}

Require-Command "node" "Install Node.js LTS from https://nodejs.org/."
Require-Command "npm" "Install Node.js LTS from https://nodejs.org/."

$target = if ($Source -eq "npm") { $NpmPackage } else { $GitHubPackage }
Write-Host "Installing ZilMate from $target ..." -ForegroundColor Cyan
npm install -g $target
if ($LASTEXITCODE -ne 0) {
  throw "ZilMate install failed."
}

Write-Host "`nZilMate installed. Checking command..." -ForegroundColor Green
zilmate --help
if ($LASTEXITCODE -ne 0) {
  throw "ZilMate command check failed."
}

if (-not $NoSetup) {
  Invoke-Step "Starting ZilMate setup..." @("zilmate", "setup")
} else {
  Write-Host "`nRun 'zilmate setup' later to create your .env file." -ForegroundColor Yellow
}

if (-not $NoPing) {
  Invoke-Step "Verifying AI Gateway with zilmate ping..." @("zilmate", "ping")
} else {
  Write-Host "`nSkipping ping. Run 'zilmate ping' later to verify your key." -ForegroundColor Yellow
}

if (-not $NoTalk) {
  Write-Host "`nStarting ZilMate talk. Type /exit to quit." -ForegroundColor Green
  zilmate talk
} else {
  Write-Host "`nRun 'zilmate talk' when you are ready." -ForegroundColor Yellow
}
