Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Dist = Join-Path $Root 'dist'
$Stage = Join-Path $Dist ('cursor-i18n-zh-stage-' + [guid]::NewGuid().ToString('N'))
$Zip = Join-Path $Dist 'cursor-i18n-zh-windows.zip'
$ZipTemp = Join-Path $Dist ('cursor-i18n-zh-windows-' + [guid]::NewGuid().ToString('N') + '.zip')

$include = @(
  'assets',
  'dict',
  'scripts',
  'src',
  'test',
  'LICENSE',
  'THIRD_PARTY_LICENSES',
  'package.json',
  'package-lock.json',
  'README.md'
)
$rootLaunchers = @(
  ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('Q3Vyc29y5rGJ5YyW5Yqp5omLLmNtZA=='))),
  ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5LiA6ZSu5a6J6KOF5rGJ5YyWLmNtZA=='))),
  ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('6L+Y5Y6f6buY6K6kLmNtZA==')))
)

foreach ($item in $include + $rootLaunchers) {
  $source = Join-Path $Root $item
  if (!(Test-Path -LiteralPath $source)) { throw "Missing package input: $item" }
}

$packageManifest = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$dependenciesProperty = $packageManifest.PSObject.Properties['dependencies']
$runtimeDependencies = @()
if ($null -ne $dependenciesProperty -and $null -ne $dependenciesProperty.Value) {
  $runtimeDependencies = @(
    $dependenciesProperty.Value.PSObject.Properties |
      ForEach-Object { $_.Name } |
      Sort-Object
  )
}

$nodeModules = Join-Path $Root 'node_modules'
foreach ($name in $runtimeDependencies) {
  $dependency = Join-Path $nodeModules $name
  $dependencyManifest = Join-Path $dependency 'package.json'
  if (!(Test-Path -LiteralPath $dependency -PathType Container) -or
      !(Test-Path -LiteralPath $dependencyManifest -PathType Leaf)) {
    throw "Missing runtime dependency $name. Run npm ci first."
  }
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

try {
  foreach ($item in $include) {
    $source = Join-Path $Root $item
    $target = Join-Path $Stage $item
    if ((Get-Item -LiteralPath $source).PSIsContainer) {
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      Copy-Item -LiteralPath $source -Destination $target -Recurse
    } else {
      Copy-Item -LiteralPath $source -Destination $target
    }
  }

  foreach ($name in $runtimeDependencies) {
    $dependency = Join-Path $nodeModules $name
    $dependencyTarget = Join-Path (Join-Path $Stage 'node_modules') $name
    New-Item -ItemType Directory -Force -Path (Split-Path $dependencyTarget -Parent) | Out-Null
    Copy-Item -LiteralPath $dependency -Destination $dependencyTarget -Recurse
  }

  foreach ($item in $rootLaunchers) {
    Copy-Item -LiteralPath (Join-Path $Root $item) -Destination (Join-Path $Stage $item)
  }

  Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $ZipTemp -Force
  if (!(Test-Path -LiteralPath $ZipTemp)) { throw 'Package archive was not created.' }
  if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
  Move-Item -LiteralPath $ZipTemp -Destination $Zip -Force
  Write-Host "Package: $Zip"
} finally {
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
  if (Test-Path -LiteralPath $ZipTemp) { Remove-Item -LiteralPath $ZipTemp -Force }
}
