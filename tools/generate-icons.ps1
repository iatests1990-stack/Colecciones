# Genera el icono de Colecciones: tarjeta redondeada azul con cinta de marcador.
# Ejecutar: powershell -NoProfile -ExecutionPolicy Bypass -File tools/generate-icons.ps1
Add-Type -AssemblyName System.Drawing

$repo = Split-Path $PSScriptRoot -Parent
$cardColor = [System.Drawing.Color]::FromArgb(0x0F, 0x6C, 0xBD)
$ribbonColor = [System.Drawing.Color]::FromArgb(0x69, 0xB1, 0xE8)

function Add-RoundedRectangle([System.Drawing.Drawing2D.GraphicsPath] $path, [int] $x, [int] $y, [int] $w, [int] $h, [int] $r) {
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
}

function New-Icon([int] $size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $margin = [int][Math]::Round($size * 0.125)
  $cardSide = $size - (2 * $margin)
  $radius = [int][Math]::Round($cardSide * 0.16)
  $radius = [Math]::Max(1, $radius)

  $cardPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  Add-RoundedRectangle $cardPath $margin $margin $cardSide $cardSide $radius
  $cardBrush = New-Object System.Drawing.SolidBrush $cardColor
  $graphics.FillPath($cardBrush, $cardPath)

  $rx0 = [int][Math]::Round($size * 0.4375)
  $rx1 = [int][Math]::Round($size * 0.5625)
  $ry0 = [int][Math]::Round($size * 0.6875)
  $ry1 = [int][Math]::Round($size * 0.8750)
  $ry2 = [int][Math]::Round($size * 0.9375)
  $mid = [int][Math]::Round(($rx0 + $rx1) / 2)
  $points = @(
    (New-Object System.Drawing.PointF $rx0, $ry0),
    (New-Object System.Drawing.PointF $rx1, $ry0),
    (New-Object System.Drawing.PointF $rx1, $ry2),
    (New-Object System.Drawing.PointF $mid, $ry1),
    (New-Object System.Drawing.PointF $rx0, $ry2)
  )
  $ribbonBrush = New-Object System.Drawing.SolidBrush $ribbonColor
  $graphics.FillPolygon($ribbonBrush, $points)

  $graphics.Dispose()
  $cardBrush.Dispose()
  $ribbonBrush.Dispose()
  $cardPath.Dispose()
  return $bitmap
}

foreach ($size in @(16, 32, 48, 128)) {
  $icon = New-Icon $size
  $destination = Join-Path $repo "icons\icon$size.png"
  $icon.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  $icon.Dispose()
  "generado $destination"
}

$logo = New-Icon 300
$logoDestination = Join-Path $repo "release\logo-300.png"
$logo.Save($logoDestination, [System.Drawing.Imaging.ImageFormat]::Png)
$logo.Dispose()
"generado $logoDestination"
