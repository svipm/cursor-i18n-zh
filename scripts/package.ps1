Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Dist = Join-Path $Root 'dist'
$Stage = Join-Path $Dist 'cursor-i18n-zh'
$Zip = Join-Path $Dist 'cursor-i18n-zh-windows.zip'

if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
if (Test-Path $Zip) { Remove-Item -LiteralPath $Zip -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$include = @(
  'dict',
  'scripts',
  'src',
  'test',
  '.gitignore',
  'package.json',
  'README.md'
)

foreach ($item in $include) {
  $source = Join-Path $Root $item
  if (!(Test-Path $source)) { continue }
  $target = Join-Path $Stage $item
  if ((Get-Item $source).PSIsContainer) {
    Copy-Item -LiteralPath $source -Destination $target -Recurse
  } else {
    Copy-Item -LiteralPath $source -Destination $target
  }
}

Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Zip -Force
Write-Host "Package: $Zip"
