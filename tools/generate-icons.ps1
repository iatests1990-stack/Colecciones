# Genera los iconos de Colecciones escalando el marcador de tools/bookmark-source.png.
# Ejecutar: powershell -NoProfile -ExecutionPolicy Bypass -File tools/generate-icons.ps1
Add-Type -AssemblyName System.Drawing

$repo = Split-Path $PSScriptRoot -Parent
$sourcePath = Join-Path $PSScriptRoot "bookmark-source.png"
$source = [System.Drawing.Image]::FromFile($sourcePath)

function New-ScaledIcon([int] $size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.DrawImage($source, 0, 0, $size, $size)
  $graphics.Dispose()
  return $bitmap
}

foreach ($size in @(16, 32, 48, 128)) {
  $icon = New-ScaledIcon $size
  $destination = Join-Path $repo "icons\icon$size.png"
  $icon.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  $icon.Dispose()
  "generado $destination"
}

$logo = New-ScaledIcon 300
$logoDestination = Join-Path $repo "release\logo-300.png"
$logo.Save($logoDestination, [System.Drawing.Imaging.ImageFormat]::Png)
$logo.Dispose()
"generado $logoDestination"

$source.Dispose()
