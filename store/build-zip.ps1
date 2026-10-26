# Builds the Chrome Web Store upload ZIP: manifest.json at the ZIP root (the
# store requires that), no data/, no docs, no store material. Output: dist/.
#
# Uses ZipArchive directly rather than Compress-Archive: on Windows
# PowerShell 5.1 Compress-Archive writes entry names with backslashes
# (icons\icon128.png), and the store then cannot find the icons.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ver = (Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json).version
$out = Join-Path $src "dist\imdb-ratings-v$ver-webstore.zip"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
if (Test-Path $out) { Remove-Item $out }

$skipDirs = @('data', 'dist', 'store')
$skipFiles = @('README.md', 'PRIVACY.md', 'RELEASING.md')
$skipExt = @('.zip', '.crx', '.pem')

$zip = [IO.Compression.ZipFile]::Open($out, [IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $src -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length + 1) -replace '\\', '/'
    $top = $rel.Split('/')[0]
    # .git, .github, .gitignore
    if ($top -in $skipDirs -or $top.StartsWith('.')) { return }
    if ($rel -in $skipFiles -or $_.Extension -in $skipExt) { return }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}
Write-Host "Wrote $out"
