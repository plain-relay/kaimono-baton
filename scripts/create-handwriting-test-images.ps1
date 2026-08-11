[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [string]$OutputDirectory = '.manual-test/images'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputPath = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory
}
else {
    Join-Path $repoRoot $OutputDirectory
}
$resolvedOutput = [System.IO.Path]::GetFullPath($outputPath)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

function Apply-ExifOrientation {
    param([System.Drawing.Image]$Image)

    $orientationPropertyId = 0x0112
    if (-not ($Image.PropertyIdList -contains $orientationPropertyId)) {
        return
    }

    try {
        $orientationBytes =
            $Image.GetPropertyItem($orientationPropertyId).Value
        if ($orientationBytes.Length -lt 2) {
            return
        }
        $orientation =
            [System.BitConverter]::ToUInt16($orientationBytes, 0)
    }
    catch {
        # A malformed EXIF orientation must not prevent local image creation.
        return
    }
    $rotation = switch ($orientation) {
        2 { [System.Drawing.RotateFlipType]::RotateNoneFlipX }
        3 { [System.Drawing.RotateFlipType]::Rotate180FlipNone }
        4 { [System.Drawing.RotateFlipType]::Rotate180FlipX }
        5 { [System.Drawing.RotateFlipType]::Rotate90FlipX }
        6 { [System.Drawing.RotateFlipType]::Rotate90FlipNone }
        7 { [System.Drawing.RotateFlipType]::Rotate270FlipX }
        8 { [System.Drawing.RotateFlipType]::Rotate270FlipNone }
        default { [System.Drawing.RotateFlipType]::RotateNoneFlipNone }
    }
    if ($rotation -ne [System.Drawing.RotateFlipType]::RotateNoneFlipNone) {
        $Image.RotateFlip($rotation)
    }
}

function Save-ResizedJpeg {
    param(
        [System.Drawing.Image]$Source,
        [int]$LongEdge,
        [string]$Destination
    )

    $scale = [Math]::Min(
        1.0,
        $LongEdge / [double][Math]::Max($Source.Width, $Source.Height)
    )
    $width = [Math]::Max(1, [int][Math]::Round($Source.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($Source.Height * $scale))
    $bitmap = [System.Drawing.Bitmap]::new(
        $width,
        $height,
        [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    )

    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.CompositingMode =
                [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality =
                [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode =
                [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode =
                [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode =
                [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage(
                $Source,
                [System.Drawing.Rectangle]::new(0, 0, $width, $height)
            )
        }
        finally {
            $graphics.Dispose()
        }

        $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq 'image/jpeg' } |
            Select-Object -First 1
        if (-not $jpegCodec) {
            throw 'JPEG encoder is not available on this Windows installation.'
        }
        $encoderParameters =
            [System.Drawing.Imaging.EncoderParameters]::new(1)
        try {
            $encoderParameters.Param[0] =
                [System.Drawing.Imaging.EncoderParameter]::new(
                    [System.Drawing.Imaging.Encoder]::Quality,
                    [long]90
                )
            $bitmap.Save($Destination, $jpegCodec, $encoderParameters)
        }
        finally {
            $encoderParameters.Dispose()
        }
    }
    finally {
        $bitmap.Dispose()
    }
}

$source = [System.Drawing.Image]::FromFile($resolvedInput)
try {
    $supportedFormats = @(
        [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid,
        [System.Drawing.Imaging.ImageFormat]::Png.Guid
    )
    if ($supportedFormats -notcontains $source.RawFormat.Guid) {
        throw 'Input image must be JPEG or PNG.'
    }
    Apply-ExifOrientation -Image $source
    foreach ($longEdge in @(800, 1200, 1600, 2400)) {
        $destination = Join-Path $resolvedOutput "long-edge-$longEdge.jpg"
        Save-ResizedJpeg `
            -Source $source `
            -LongEdge $longEdge `
            -Destination $destination
    }
}
finally {
    $source.Dispose()
}

Write-Host "Created four local test images in: $resolvedOutput"
Write-Host 'The default .manual-test directory is ignored by Git.'
