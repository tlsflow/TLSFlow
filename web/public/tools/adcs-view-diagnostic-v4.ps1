param(
    [string]$CaConfig = 'Jackson-MGT\jacksonz-JACKSON-MGT-CA',
    [string]$OutputPath = 'C:\ProgramData\GCAC\ADCSAgent\adcs-view-diagnostic-v4.json'
)

$ErrorActionPreference = 'Stop'

$requestColumns = @(
    'Request.RequestID',
    'Request.Disposition',
    'Request.DispositionMessage',
    'Request.StatusCode',
    'Request.RequesterName',
    'Request.SubmittedWhen',
    'Request.ResolvedWhen',
    'Request.RevokedWhen',
    'Request.RevokedEffectiveWhen',
    'Request.RevokedReason',
    'Request.CommonName'
)

$issuedColumns = @(
    'RequestID',
    'CertificateTemplate',
    'SerialNumber',
    'NotBefore',
    'NotAfter',
    'CommonName',
    'RawCertificate'
)

function Convert-DiagnosticValue {
    param([string]$Name, [object]$Value)

    if ($null -eq $Value) { return $null }
    if ($Value -is [byte[]]) { return "[binary:$($Value.Length)]" }
    if ($Value -is [DateTime]) { return ([DateTimeOffset]$Value).ToUniversalTime().ToString('O') }

    $text = [string]$Value
    if ($Name -match 'RequesterName|CommonName') {
        return $(if ($text.Length -gt 0) { '[redacted]' } else { '' })
    }
    if ($Name -eq 'SerialNumber') { return "[present:length=$($text.Length)]" }
    if ($text.Length -gt 512) { return $text.Substring(0, 512) + '[truncated]' }
    return $text
}

function Invoke-CertViewQuery {
    param(
        [string]$Name,
        [string[]]$Columns,
        [int]$Limit,
        [switch]$Pending,
        [switch]$Resolved,
        [switch]$Failed,
        [Nullable[int]]$AfterRequestId
    )

    $view = New-Object -ComObject CertificateAuthority.View
    $view.OpenConnection($CaConfig)

    $selected = New-Object System.Collections.Generic.List[object]
    foreach ($columnName in $Columns) {
        $selected.Add([ordered]@{
            name = $columnName
            index = [int]$view.GetColumnIndex($false, $columnName)
        })
    }

    $view.SetResultColumnCount($selected.Count)
    foreach ($column in $selected) {
        $view.SetResultColumn([int]$column.index)
    }

    if ($Pending) { $view.SetRestriction(-1, 0, 0, 0) }
    if ($Resolved) { $view.SetRestriction(-2, 0, 0, 0) }
    if ($Failed) { $view.SetRestriction(-3, 0, 0, 0) }

    if ($null -ne $AfterRequestId) {
        $requestIdName = $(if ($Columns -contains 'Request.RequestID') { 'Request.RequestID' } else { 'RequestID' })
        $requestIdColumn = $selected | Where-Object { $_.name -eq $requestIdName } | Select-Object -First 1
        $view.SetRestriction([int]$requestIdColumn.index, 0x10, 0x1, [int]$AfterRequestId)
    }

    $rows = $view.OpenView()
    $items = New-Object System.Collections.Generic.List[object]
    $rowIndex = $rows.Next()

    while ($rowIndex -ne -1 -and $items.Count -lt $Limit) {
        $values = [ordered]@{}
        $rowColumns = $rows.EnumCertViewColumn()
        $columnIndex = $rowColumns.Next()

        while ($columnIndex -ne -1) {
            $columnName = $rowColumns.GetName()
            $values[$columnName] = Convert-DiagnosticValue -Name $columnName -Value $rowColumns.GetValue(0)
            $columnIndex = $rowColumns.Next()
        }

        $items.Add([ordered]@{
            rowIndex = [int]$rowIndex
            values = $values
        })
        $rowIndex = $rows.Next()
    }

    $requestIdName = $(if ($Columns -contains 'Request.RequestID') { 'Request.RequestID' } else { 'RequestID' })
    $requestIds = @(
        $items |
            ForEach-Object { $_.values.$requestIdName } |
            Where-Object { $null -ne $_ -and [string]$_ -match '^\d+$' } |
            ForEach-Object { [int]$_ }
    )

    return [ordered]@{
        name = $Name
        selectedColumns = @($selected | ForEach-Object { $_.name })
        count = $items.Count
        minimumRequestId = $(if ($requestIds.Count -gt 0) { ($requestIds | Measure-Object -Minimum).Minimum } else { $null })
        maximumRequestId = $(if ($requestIds.Count -gt 0) { ($requestIds | Measure-Object -Maximum).Maximum } else { $null })
        items = $items
    }
}

$result = [ordered]@{
    collectedAt = [DateTimeOffset]::UtcNow.ToString('O')
    computerName = $env:COMPUTERNAME
    caConfig = $CaConfig
    uiCulture = [Globalization.CultureInfo]::CurrentUICulture.Name
    queries = [ordered]@{}
}

$result.queries.requestsAll = Invoke-CertViewQuery -Name 'requestsAll' -Columns $requestColumns -Limit 20
$result.queries.requestsPending = Invoke-CertViewQuery -Name 'requestsPending' -Columns $requestColumns -Limit 20 -Pending
$result.queries.requestsResolved = Invoke-CertViewQuery -Name 'requestsResolved' -Columns $requestColumns -Limit 20 -Resolved
$result.queries.requestsFailed = Invoke-CertViewQuery -Name 'requestsFailed' -Columns $requestColumns -Limit 20 -Failed
$result.queries.issuedAll = Invoke-CertViewQuery -Name 'issuedAll' -Columns $issuedColumns -Limit 20
$result.queries.requestPageOne = Invoke-CertViewQuery -Name 'requestPageOne' -Columns $requestColumns -Limit 1

$cursor = $result.queries.requestPageOne.maximumRequestId
if ($null -ne $cursor) {
    $result.queries.requestPageAfter = Invoke-CertViewQuery -Name 'requestPageAfter' -Columns $requestColumns -Limit 20 -AfterRequestId ([int]$cursor)
}

$json = $result | ConvertTo-Json -Depth 16
[System.IO.File]::WriteAllText(
    [IO.Path]::GetFullPath($OutputPath),
    $json,
    [Text.UTF8Encoding]::new($false)
)

Write-Host "诊断完成：$OutputPath" -ForegroundColor Green
Get-Item $OutputPath | Select-Object FullName, Length, LastWriteTime
