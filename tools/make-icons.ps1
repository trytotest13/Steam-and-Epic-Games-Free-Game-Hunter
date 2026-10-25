# Generates the extension icons (16/48/128 px) with System.Drawing.
Add-Type -AssemblyName System.Drawing

$dir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function MakeIcon([int]$size, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 16, 24, 20))
    $green = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 46, 160, 67))
    $g.FillEllipse($dark, 0, 0, $size - 1, $size - 1)
    $inset = [Math]::Max(1, [int]($size * 0.06))
    $g.FillEllipse($green, $inset, $inset, $size - 1 - 2 * $inset, $size - 1 - 2 * $inset)

    $font = New-Object System.Drawing.Font ('Segoe UI', [float]($size * 0.52), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF (0, [float]($size * 0.04), [float]$size, [float]($size * 0.96))
    $g.DrawString('%', $font, [System.Drawing.Brushes]::White, $rect, $fmt)

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "wrote $path"
}

MakeIcon 16  (Join-Path $dir 'icon16.png')
MakeIcon 48  (Join-Path $dir 'icon48.png')
MakeIcon 128 (Join-Path $dir 'icon128.png')
