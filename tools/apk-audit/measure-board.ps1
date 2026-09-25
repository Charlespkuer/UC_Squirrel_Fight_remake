<#
  Measure the reference screenshot: find the bounding box of the cream board panel
  so the client literal resource_3:5 rect (144,133,886,462) can be checked against
  what the original UI actually looked like on screen.
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$DesignW = 1170,
  [int]$DesignH = 690
)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile($Path)
"image: $($img.Width) x $($img.Height)"

# Cream board colours seen in the rebuilt UI / original art.
function IsCream($c) {
  return ($c.R -gt 235 -and $c.G -gt 225 -and $c.B -gt 180 -and $c.B -lt 250 -and ($c.R - $c.B) -gt 8)
}

$minX = $img.Width; $maxX = -1; $minY = $img.Height; $maxY = -1
$step = 2
for ($y = 0; $y -lt $img.Height; $y += $step) {
  for ($x = 0; $x -lt $img.Width; $x += $step) {
    $c = $img.GetPixel($x, $y)
    if (IsCream $c) {
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
$img.Dispose()

if ($maxX -lt 0) { "没有找到米色面板"; exit }

# The screenshot is a window capture; the design space is letterboxed inside it.
# Estimate scale from the known game width: the original art fills 1170 x 690.
$scale = $img.Width / $DesignW
"assumed scale (width/{0}) : {1:N4}" -f $DesignW, $scale
"cream bbox in screenshot   : x {0}..{1}  y {2}..{3}  ({4} x {5})" -f $minX, $maxX, $minY, $maxY, ($maxX - $minX), ($maxY - $minY)
"cream bbox in design space : x {0:N0}..{1:N0}  y {2:N0}..{3:N0}" -f ($minX / $scale), ($maxX / $scale), ($minY / $scale), ($maxY / $scale)
"design-space width fraction: {0:P1} of 1170" -f (($maxX - $minX) / $scale / $DesignW)
""
"client resource_3:5 rect    : x 144..1030  y 133..595   (886 x 462)  = {0:P1} of 1170" -f (886 / $DesignW)
