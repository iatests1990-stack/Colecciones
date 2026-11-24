# Instalador local de Colecciones para navegadores Chromium.
# Copia la extension a una ruta estable, detecta navegadores y abre el elegido.
$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "extension"
$dest = Join-Path $env:LOCALAPPDATA "Colecciones\Extension"

if (-not (Test-Path $source)) {
  throw "No se encontró la carpeta 'extension' junto a este script."
}

# 1. Copiar los archivos a la ruta estable.
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem -Path $dest -Force | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $source "*") -Destination $dest -Recurse -Force

$readme = @"
Colecciones - extension instalada en:
$dest

Pasos para terminar la instalacion:
1. Abre la pagina de extensiones de tu navegador Chromium.
2. Activa 'Modo desarrollador'.
3. Pulsa 'Cargar desempaquetada' y selecciona esta carpeta:
   $dest

Tus colecciones se guardan en el perfil del navegador, no en esta carpeta.
Puedes borrar el instalador despues de usarla.
"@
$readme | Set-Content -Path (Join-Path $dest "LEEME.txt") -Encoding UTF8

Write-Host "Extension copiada a: $dest"

# 2. Detectar navegadores Chromium instalados.
$PF = ${env:ProgramFiles}
$PF86 = ${env:ProgramFiles(x86)}
$LA = $env:LOCALAPPDATA
$extensionUrls = @("edge://extensions", "chrome://extensions", "brave://extensions", "vivaldi://extensions", "opera://extensions")

$candidates = @(
  @{ Name = "Microsoft Edge"; Scheme = "edge"; Exe = @("$PF\Microsoft\Edge\Application\msedge.exe", "$PF86\Microsoft\Edge\Application\msedge.exe", "$LA\Microsoft\Edge\Application\msedge.exe") },
  @{ Name = "Google Chrome"; Scheme = "chrome"; Exe = @("$PF\Google\Chrome\Application\chrome.exe", "$PF86\Google\Chrome\Application\chrome.exe", "$LA\Google\Chrome\Application\chrome.exe") },
  @{ Name = "Brave"; Scheme = "brave"; Exe = @("$PF\BraveSoftware\Brave-Browser\Application\brave.exe", "$LA\BraveSoftware\Brave-Browser\Application\brave.exe") },
  @{ Name = "Vivaldi"; Scheme = "vivaldi"; Exe = @("$PF\Vivaldi\Application\vivaldi.exe", "$LA\Vivaldi\Application\vivaldi.exe") },
  @{ Name = "Opera"; Scheme = "opera"; Exe = @("$PF\Opera\opera.exe", "$PF86\Opera\opera.exe", "$LA\Programs\Opera\opera.exe") }
)

$found = @()
foreach ($candidate in $candidates) {
  foreach ($path in $candidate.Exe) {
    if (Test-Path $path) {
      $found += [pscustomobject]@{ Name = $candidate.Name; Scheme = $candidate.Scheme; Exe = $path }
      break
    }
  }
}

# 3. Elegir navegador.
$selected = $null
if ($found.Count -eq 0) {
  Write-Host "No se detectó ningún navegador Chromium compatible. Abre manualmente la página de extensiones de tu navegador."
} elseif ($found.Count -eq 1) {
  $selected = $found[0]
  Write-Host "Navegador detectado: $($selected.Name)"
} else {
  Write-Host "Navegadores detectados:"
  for ($i = 0; $i -lt $found.Count; $i++) {
    Write-Host ("  [{0}] {1}" -f ($i + 1), $found[$i].Name)
  }
  $answer = Read-Host "Elige un navegador (1-$($found.Count))"
  $number = 0
  if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $found.Count) {
    $selected = $found[$number - 1]
  } else {
    Write-Host "Selección no válida. No se abrirá ningún navegador."
  }
}

if ($selected) {
  $url = "$($selected.Scheme)://extensions"
  if ($extensionUrls -notcontains $url) { throw "Esquema de navegador no soportado: $url" }
  # Chromium ignora las URLs internas por línea de comandos: abrimos el
  # navegador y mostramos la URL exacta para que la abras tú.
  Start-Process -FilePath $selected.Exe
  Write-Host "Abre esta dirección en $($selected.Name): $url"
}
Start-Process "explorer.exe" $dest
