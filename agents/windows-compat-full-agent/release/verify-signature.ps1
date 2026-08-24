[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PublicKeyFile,
    [Parameter(Mandatory = $true)][string]$ArtifactPath,
    [Parameter(Mandatory = $true)][string]$SignatureFile,
    [Parameter(Mandatory = $true)][string]$SignatureVerifier
)

$ErrorActionPreference = "Stop"

foreach ($path in @($PublicKeyFile, $ArtifactPath, $SignatureFile, $SignatureVerifier)) {
    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "发布签名验证材料不存在：$path"
    }
}

& $SignatureVerifier verify $PublicKeyFile $ArtifactPath $SignatureFile
if ($LASTEXITCODE -ne 0) {
    throw "Ed25519 发布签名验证失败：$ArtifactPath"
}

Write-Output "发布签名验证通过：$ArtifactPath"
