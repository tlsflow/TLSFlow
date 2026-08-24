[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$Root = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  if ([string]::IsNullOrWhiteSpace($PSCommandPath)) {
    throw "Unable to resolve script path."
  }
  $Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}

$targets = Get-ChildItem -Path $Root -Recurse -File | Where-Object {
  $_.Extension -in @(".ps1", ".psm1", ".psd1")
}

$failed = @()

foreach ($file in $targets) {
  $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
    $failed += $file.FullName
  }
}

if ($failed.Count -gt 0) {
  Write-Error ("The following PowerShell files are not UTF-8 with BOM:`n" + ($failed -join "`n"))
}

Write-Host "All PowerShell files are UTF-8 with BOM."
