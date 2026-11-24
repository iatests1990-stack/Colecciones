# Genera el instalador portable (ZIP) y el ejecutable compilado con csc.exe.
# Ejecutar: powershell -NoProfile -ExecutionPolicy Bypass -File tools/installer/build-installer.ps1
$ErrorActionPreference = "Stop"

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$installerDir = $PSScriptRoot
$extDir = Join-Path $installerDir "extension"
$releaseDir = Join-Path $repo "release"
$stage = "C:\Users\marco\AppData\Local\Temp\opencode\collections-installer-stage"
$exe = Join-Path $releaseDir "instala-colecciones.exe"
$zip = Join-Path $releaseDir "instalador-colecciones.zip"

# 1. Carpeta con solo los archivos de ejecucion de la extension.
Remove-Item $extDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $extDir | Out-Null
foreach ($item in @("manifest.json", "background.js", "sidepanel", "content", "lib", "offscreen", "icons")) {
  Copy-Item -Path (Join-Path $repo $item) -Destination $extDir -Recurse -Force
}

# 2. ZIP portable: script + extension.
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item (Join-Path $installerDir "install.ps1") $stage -Force
Copy-Item (Join-Path $installerDir "install.cmd") $stage -Force
Copy-Item (Join-Path $installerDir "LEEME.txt") $stage -Force
Copy-Item $extDir (Join-Path $stage "extension") -Recurse -Force
Compress-Archive -Path "$stage\*" -DestinationPath $zip -Force
"generado $zip"

# 3. Ejecutable autodescriptivo: compila el C# con el ZIP incrustado.
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "No se encontró csc.exe" }
Remove-Item $exe -Force -ErrorAction SilentlyContinue
& $csc /nologo /target:winexe /out:"$exe" `
  /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
  /resource:"$zip,payload" `
  (Join-Path $installerDir "Installer.cs")
if (-not (Test-Path $exe)) { throw "csc no generó el ejecutable" }
"generado $exe ($((Get-Item $exe).Length) bytes)"
