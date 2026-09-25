# Scan a binary for printable ASCII and UTF-16LE strings, then report the ones
# matching URLs / domains / emulator keywords. Read-only forensic helper.
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$MinLen = 6,
  [string]$OutFile = ''
)

$bytes = [System.IO.File]::ReadAllBytes($Path)
$results = New-Object System.Collections.Generic.List[string]

# ASCII run extraction
$sb = New-Object System.Text.StringBuilder
for ($i = 0; $i -lt $bytes.Length; $i++) {
  $c = $bytes[$i]
  if ($c -ge 32 -and $c -lt 127) { [void]$sb.Append([char]$c) }
  else {
    if ($sb.Length -ge $MinLen) { $results.Add($sb.ToString()) }
    [void]$sb.Clear()
  }
}

# UTF-16LE run extraction
$sb2 = New-Object System.Text.StringBuilder
for ($i = 0; $i -lt $bytes.Length - 1; $i += 2) {
  $c = $bytes[$i]
  $hi = $bytes[$i + 1]
  if ($hi -eq 0 -and $c -ge 32 -and $c -lt 127) { [void]$sb2.Append([char]$c) }
  else {
    if ($sb2.Length -ge $MinLen) { $results.Add($sb2.ToString()) }
    [void]$sb2.Clear()
  }
}

$all = $results | Sort-Object -Unique

$pattern = 'https?://|www\.|\.com|\.cn|\.net|bluestacks|BlueStacks|simulator|Simulator|android|Android|apk|APK|download|Download|gamex|h5runtime|advert|ads\.'
$interest = $all | Where-Object { $_ -match $pattern }

"total unique strings : $($all.Count)"
"interesting strings  : $($interest.Count)"
""
"===== URLs / domains ====="
$interest | Where-Object { $_ -match 'https?://|www\.|\.com|\.cn|\.net' } | Select-Object -First 80
""
"===== emulator / APK / runtime keywords ====="
$interest | Where-Object { $_ -match 'bluestacks|simulator|android|apk|download|gamex|h5runtime|advert|ads\.' } | Select-Object -First 80

if ($OutFile) {
  $text = ($all -join "`n")
  [System.IO.File]::WriteAllText($OutFile, $text, (New-Object System.Text.UTF8Encoding($false)))
  "full string dump -> $OutFile"
}
