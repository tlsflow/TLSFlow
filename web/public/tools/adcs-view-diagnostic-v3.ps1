param(
    [string]$CaConfig = 'Jackson-MGT\jacksonz-JACKSON-MGT-CA',
    [string]$OutputPath = 'C:\ProgramData\GCAC\ADCSAgent\adcs-view-diagnostic-v3.json',
    [ValidateRange(1, 100)]
    [int]$Limit = 20
)

$ErrorActionPreference = 'Stop'

$columnNames = @(
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
    'Request.CommonName',
    'RequestID',
    'CertificateTemplate',
    'SerialNumber',
    'NotBefore',
    'NotAfter',
    'CommonName',
    'RawCertificate'
)

function Convert-DiagnosticValue {
    param(
        [string]$Name,
        [object]$Value
    )

    if ($null -eq $Value) {
        return $null
    }
    if ($Value -is [byte[]]) {
        return "[binary:$($Value.Length)]"
    }
    if ($Value -is [DateTime]) {
        return ([DateTimeOffset]$Value).ToUniversalTime().ToString('O')
    }

    $text = [string]$Value
    if ($Name -match 'RequesterName|CommonName') {
        return $(if ($text.Length -gt 0) { '[redacted]' } else { '' })
    }
    if ($Name -eq 'SerialNumber') {
        return "[present:length=$($text.Length)]"
    }
    if ($text.Length -gt 512) {
        return $text.Substring(0, 512) + '[truncated]'
    }
    return $text
}

function New-CertView {
    $view = New-Object -ComObject CertificateAuthority.View
    $view.OpenConnection($CaConfig)
    return $view
}

function Resolve-Columns {
    param(
        [Parameter(Mandatory = $true)]
        [object]$View
    )

    $resolved = New-Object System.Collections.Generic.List[object]
    foreach ($name in $columnNames) {
        try {
            $resolved.Add([ordered]@{
                name = $name
                index = [int]$View.GetColumnIndex($false, $name)
            })
        } catch {
            $resolved.Add([ordered]@{
                name = $name
                error = $_.Exception.Message
            })
        }
    }
    return $resolved
}

function Invoke-CertViewQuery {
    param(
        [string]$Name,
        [Nullable[int]]$DefaultRestriction,
        [Nullable[int]]$AfterRequestId
    )

    $view = New-CertView
    $resolved = @(Resolve-Columns -View $view)
    $selected = @($resolved | Where-Object { $null -ne $_.index })

    if ($selected.Count -eq 0) {
        throw "查询 $Name 没有可用列。"
    }

    $view.SetResultColumnCount($selected.Count)
    foreach ($column in $selected) {
        $view.SetResultColumn([int]$column.index)
    }

    if ($null -ne $DefaultRestriction) {
        $view.SetRestriction([int]$DefaultRestriction, 0, 0, 0)
    }

    if ($null -ne $AfterRequestId) {
        $requestIdColumn = $selected | Where-Object { $_.name -eq 'Request.RequestID' } | Select-Object -First 1
        if ($null -eq $requestIdColumn) {
            throw '无法找到 Request.RequestID 游标列。'
        }
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

    $requestIds = @(
        $items |
            ForEach-Object { $_.values.'Request.RequestID' } |
            Where-Object { $null -ne $_ -and [string]$_ -match '^\d+$' } |
            ForEach-Object { [int]$_ }
    )

    return [ordered]@{
        name = $Name
        selectedColumnCount = $selected.Count
        unresolvedColumns = @($resolved | Where-Object { $null -ne $_.error })
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
    limit = $Limit
    queries = [ordered]@{}
}

$result.queries.all = Invoke-CertViewQuery -Name 'all' -DefaultRestriction $null -AfterRequestId $null
$result.queries.pending = Invoke-CertViewQuery -Name 'pending' -DefaultRestriction -1 -AfterRequestId $null
$result.queries.resolved = Invoke-CertViewQuery -Name 'resolved' -DefaultRestriction -2 -AfterRequestId $null
$result.queries.failed = Invoke-CertViewQuery -Name 'failed' -DefaultRestriction -3 -AfterRequestId $null

$firstPageMaximum = $result.queries.all.maximumRequestId
if ($null -ne $firstPageMaximum) {
    $result.queries.afterCursor = Invoke-CertViewQuery -Name 'afterCursor' -DefaultRestriction $null -AfterRequestId ([int]$firstPageMaximum)
}

$json = $result | ConvertTo-Json -Depth 16
[System.IO.File]::WriteAllText(
    [IO.Path]::GetFullPath($OutputPath),
    $json,
    [Text.UTF8Encoding]::new($false)
)

Write-Host "诊断完成：$OutputPath" -ForegroundColor Green
Get-Item $OutputPath | Select-Object FullName, Length, LastWriteTime
