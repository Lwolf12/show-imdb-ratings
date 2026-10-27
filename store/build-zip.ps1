# Builds the store upload ZIPs: manifest.json at the ZIP root (both stores
# require that), no data/, no docs, no store material. Output: dist/
#   imdb-ratings-v<version>-webstore.zip   Chrome Web Store
#   imdb-ratings-v<version>-firefox.zip    addons.mozilla.org; its manifest
#                                          comes from firefox-manifest.mjs
#                                          (needs Node). Also loads as a
#                                          temporary add-on in about:debugging.
#
# Uses ZipArchive directly rather than Compress-Archive: on Windows
# PowerShell 5.1 Compress-Archive writes entry names with backslashes
# (icons\icon128.png), and the store then cannot find the icons.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ver = (Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force (Join-Path $src 'dist') | Out-Null

$skipDirs = @('data', 'dist', 'store')
# Docs (every top-level .md: README, PRIVACY, RELEASING, working notes)
# and packaging output stay out of the package.
$skipExt = @('.zip', '.crx', '.pem', '.xpi', '.md')

$firefoxManifest = (& node (Join-Path $PSScriptRoot 'firefox-manifest.mjs')) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'firefox-manifest.mjs failed' }

function Build-Zip($out, $manifestText) {
  if (Test-Path $out) { Remove-Item $out }
  $zip = [IO.Compression.ZipFile]::Open($out, [IO.Compression.ZipArchiveMode]::Create)
  try {
    # Skipped top-level folders (data, dist, store) and dot entries (.git,
    # .github, .gitignore) are left out before recursing, not filtered after.
    Get-ChildItem $src |
      Where-Object { -not ($_.Name.StartsWith('.') -or ($_.PSIsContainer -and $_.Name -in $skipDirs)) } |
      ForEach-Object { if ($_.PSIsContainer) { Get-ChildItem $_.FullName -Recurse -File } else { $_ } } |
      ForEach-Object {
      $rel = $_.FullName.Substring($src.Length + 1) -replace '\\', '/'
      if ($_.Extension -in $skipExt) { return }
      if ($rel -eq 'manifest.json' -and $manifestText) {
        $entry = $zip.CreateEntry($rel, [IO.Compression.CompressionLevel]::Optimal)
        $w = New-Object IO.StreamWriter($entry.Open(), (New-Object Text.UTF8Encoding($false)))
        try { $w.Write($manifestText) } finally { $w.Dispose() }
        return
      }
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally {
    $zip.Dispose()
  }
  Write-Host "Wrote $out"
}

Build-Zip (Join-Path $src "dist\imdb-ratings-v$ver-webstore.zip") $null
Build-Zip (Join-Path $src "dist\imdb-ratings-v$ver-firefox.zip") $firefoxManifest
