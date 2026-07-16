param(
  [string]$OutputPath = 'build/cursor-release.json',
  [string]$BaselinePath = 'compat/cursor-stable.json',
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Channel = 'stable'
$Platform = 'win32-x64-user'
$ApiUrl = "https://cursor.com/api/download?platform=$Platform&releaseTrack=$Channel"

function Resolve-RepoPath([string]$Value) {
  if ([IO.Path]::IsPathRooted($Value)) { return $Value }
  return Join-Path $Root $Value
}

$OutputFile = Resolve-RepoPath $OutputPath
$BaselineFile = Resolve-RepoPath $BaselinePath
$response = Invoke-RestMethod -Uri $ApiUrl -Method Get
$version = [string]$response.version
$commit = [string]$response.commitSha
$downloadUrl = [string]$response.downloadUrl

if ($version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
  throw "Cursor API returned an invalid version: $version"
}
if ($commit -notmatch '^[0-9a-f]{40}$') {
  throw "Cursor API returned an invalid commit: $commit"
}
$uri = [Uri]$downloadUrl
if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'downloads.cursor.com') {
  throw "Cursor API returned an unexpected download URL: $downloadUrl"
}

$release = [ordered]@{
  schema = 1
  channel = $Channel
  platform = $Platform
  version = $version
  commit = $commit
  downloadUrl = $downloadUrl
  checkedAt = [DateTime]::UtcNow.ToString('o')
}

$directory = Split-Path $OutputFile -Parent
New-Item -ItemType Directory -Force -Path $directory | Out-Null
[IO.File]::WriteAllText(
  $OutputFile,
  (($release | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
  [Text.UTF8Encoding]::new($false)
)

$baselineVersion = ''
$baselineCommit = ''
if (Test-Path -LiteralPath $BaselineFile -PathType Leaf) {
  $baseline = Get-Content -LiteralPath $BaselineFile -Raw | ConvertFrom-Json
  $baselineVersion = [string]$baseline.version
  $baselineCommit = [string]$baseline.commit
}
$changed = $Force.IsPresent -or $version -ne $baselineVersion -or $commit -ne $baselineCommit

if ($env:GITHUB_OUTPUT) {
  Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "changed=$($changed.ToString().ToLowerInvariant())"
  Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "version=$version"
  Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "commit=$commit"
  Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "download_url=$downloadUrl"
}

Write-Host "Cursor stable: $version ($($commit.Substring(0, 8)))"
Write-Host "Recorded baseline: $baselineVersion ($($baselineCommit.Substring(0, [Math]::Min(8, $baselineCommit.Length))))"
Write-Host "Compatibility build required: $changed"
