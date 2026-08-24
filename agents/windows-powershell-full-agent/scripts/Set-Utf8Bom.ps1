[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path
)

$ErrorActionPreference = "Stop"
$utf8Bom = New-Object System.Text.UTF8Encoding($true)

foreach ($item in $Path) {
  if (-not (Test-Path -LiteralPath $item)) {
    throw "File not found: $item"
  }

  $content = Get-Content -LiteralPath $item -Raw
  [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath $item), $content, $utf8Bom)
}
