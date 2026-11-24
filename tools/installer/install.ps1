# Instalador local de Colecciones para Microsoft Edge.
# Copia la extension a una ruta estable y abre los dialogos necesarios.
$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "extension"
$dest = Join-Path $env:LOCALAPPDATA "Colecciones\Extension"

if (-not (Test-Path $source)) {
  throw "No se encontró la carpeta 'extension' junto a este script."
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem -Path $dest -Force | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $source "*") -Destination $dest -Recurse -Force

$readme = @"
Colecciones - extension instalada en:
$dest

Pasos para terminar la instalacion en Microsoft Edge:
1. Se ha abierto edge://extensions.
2. Activa 'Modo desarrollador' (arriba a la derecha).
3. Pulsa 'Cargar desempaquetada' y selecciona esta carpeta:
   $dest

Tus colecciones se guardan en el perfil de Edge, no en esta carpeta.
Puedes borrar el instalador despues de usarla.
"@
$readme | Set-Content -Path (Join-Path $dest "LEEME.txt") -Encoding UTF8

Write-Host "Extension copiada a: $dest"
Start-Process "msedge" "edge://extensions"
Start-Process "explorer.exe" $dest
