# Genera los iconos de Colecciones a partir de la forma "bookmark-fill" de
# Bootstrap Icons (MIT). Ver licenses/BOOTSTRAP-ICONS-LICENSE.txt.
# Ejecutar: powershell -NoProfile -ExecutionPolicy Bypass -File tools/generate-icons.ps1
Add-Type -AssemblyName System.Drawing

$repo = Split-Path $PSScriptRoot -Parent

function New-BookmarkIcon([int] $size) {
  $scale = $size / 16.0
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $x0 = 2 * $scale
  $x1 = 14 * $scale
  $topRadius = 2 * $scale
  $bottom = 15.5 * $scale
  $notch = 13.069 * $scale
  $small = 0.5 * $scale

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  # Esquinas superiores redondeadas (radio 2 en el viewBox de 16).
  $path.AddArc([single]$x0, 0, [single](2 * $topRadius), [single](2 * $topRadius), 180, 90)
  $path.AddArc([single]($x1 - 2 * $topRadius), 0, [single](2 * $topRadius), [single](2 * $topRadius), 270, 90)
  # Borde derecho y pequeña curva inferior derecha.
  $path.AddLine([single]$x1, [single]($topRadius), [single]$x1, [single]($bottom - $small))
  $path.AddArc([single]($x1 - 2 * $small), [single]($bottom - 2 * $small), [single](2 * $small), [single](2 * $small), 0, 90)
  # Muesca inferior en V.
  $path.AddLine([single]($x1 - 2 * $small), [single]$bottom, [single](8 * $scale), [single]$notch)
  $path.AddLine([single](8 * $scale), [single]$notch, [single]($x0 + 2 * $small), [single]$bottom)
  # Pequeña curva inferior izquierda y borde izquierdo.
  $path.AddArc([single]$x0, [single]($bottom - 2 * $small), [single](2 * $small), [single](2 * $small), 90, 90)
  $path.AddLine([single]$x0, [single]($bottom - $small), [single]$x0, [single]$topRadius)
  $path.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF 0, 0),
    (New-Object System.Drawing.PointF 0, ([single]$size)),
    [System.Drawing.Color]::FromArgb(0x50, 0x8A, 0xF7),
    [System.Drawing.Color]::FromArgb(0x30, 0x71, 0xEA)
  )
  $graphics.FillPath($brush, $path)
  $graphics.Dispose()
  $brush.Dispose()
  $path.Dispose()
  return $bitmap
}

foreach ($size in @(16, 32, 48, 128)) {
  $icon = New-BookmarkIcon $size
  $destination = Join-Path $repo "icons\icon$size.png"
  $icon.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  $icon.Dispose()
  "generado $destination"
}

$logo = New-BookmarkIcon 300
$logoDestination = Join-Path $repo "release\logo-300.png"
$logo.Save($logoDestination, [System.Drawing.Imaging.ImageFormat]::Png)
$logo.Dispose()
"generado $logoDestination"
