[CmdletBinding()]
param(
    [string]$OutputDirectory = 'tests\fixtures\valid\outlook',
    [ValidateSet('Auto', 'Outlook', 'MsgKit')]
    [string]$Engine = 'Auto'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
    [IO.Path]::GetFullPath($OutputDirectory)
} else {
    [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
}
$assetsRoot = Join-Path $outputRoot '_assets'

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
New-Item -ItemType Directory -Force -Path $assetsRoot | Out-Null

function Release-ComObject {
    param([object]$Value)

    if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value)
    }
}

function Get-RelativeFixturePath {
    param([string]$Path)

    return [IO.Path]::GetFileName($Path)
}

function ConvertFrom-Utf8Base64 {
    param([Parameter(Mandatory)] [string]$Value)

    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

function Invoke-MsgKitGenerator {
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($null -eq $dotnet) {
        throw @'
The MsgKit generator requires the .NET 8 SDK. Install it with:
  winget install Microsoft.DotNet.SDK.8
Then run this script again. The .NET runtime alone is not sufficient.
'@
    }

    $sdks = & $dotnet.Source --list-sdks
    if ($LASTEXITCODE -ne 0 -or -not ($sdks -match '^8\.')) {
        throw @'
The MsgKit generator requires the .NET 8 SDK. Install it with:
  winget install Microsoft.DotNet.SDK.8
Then run this script again. The installed .NET runtime alone is not sufficient.
'@
    }

    $toolsRoot = Join-Path $repoRoot '.tools'
    $previousDotnetHome = $env:DOTNET_CLI_HOME
    $previousNugetPackages = $env:NUGET_PACKAGES
    $previousTelemetryOptOut = $env:DOTNET_CLI_TELEMETRY_OPTOUT
    $previousSkipFirstTime = $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE
    try {
        $env:DOTNET_CLI_HOME = Join-Path $toolsRoot 'dotnet-home'
        $env:NUGET_PACKAGES = Join-Path $toolsRoot 'nuget-packages'
        $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
        $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
        New-Item -ItemType Directory -Force -Path $env:DOTNET_CLI_HOME | Out-Null
        New-Item -ItemType Directory -Force -Path $env:NUGET_PACKAGES | Out-Null

        $project = Join-Path $PSScriptRoot 'MsgFixtureGenerator\MsgFixtureGenerator.csproj'
        $nugetConfig = Join-Path $PSScriptRoot 'MsgFixtureGenerator\NuGet.Config'
        & $dotnet.Source restore $project --configfile $nugetConfig
        if ($LASTEXITCODE -ne 0) {
            throw "MsgKit dependency restore failed with exit code $LASTEXITCODE."
        }

        & $dotnet.Source run --project $project --configuration Release --no-restore -- $outputRoot
        if ($LASTEXITCODE -ne 0) {
            throw "MsgKit fixture generator failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        $env:DOTNET_CLI_HOME = $previousDotnetHome
        $env:NUGET_PACKAGES = $previousNugetPackages
        $env:DOTNET_CLI_TELEMETRY_OPTOUT = $previousTelemetryOptOut
        $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = $previousSkipFirstTime
    }
}

function Save-TestMessage {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$Subject,
        [ValidateSet('Plain', 'Html', 'Rtf')] [string]$BodyFormat = 'Plain',
        [string]$Body = '',
        [string]$To = '',
        [string]$Cc = '',
        [string]$Bcc = '',
        [string[]]$Attachments = @(),
        [ValidateSet('Unicode', 'Ansi')] [string]$MsgFormat = 'Unicode',
        [hashtable]$Expected = @{}
    )

    $mail = $script:outlook.CreateItem(0) # olMailItem
    try {
        $mail.Subject = $Subject
        $mail.To = $To
        $mail.CC = $Cc
        $mail.BCC = $Bcc

        switch ($BodyFormat) {
            'Plain' {
                $mail.BodyFormat = 1 # olFormatPlain
                $mail.Body = $Body
            }
            'Html' {
                $mail.BodyFormat = 2 # olFormatHTML
                $mail.HTMLBody = $Body
            }
            'Rtf' {
                $mail.BodyFormat = 3 # olFormatRichText
                $mail.Body = $Body
            }
        }

        foreach ($attachmentPath in $Attachments) {
            $absolutePath = [IO.Path]::GetFullPath($attachmentPath)
            $attachment = $mail.Attachments.Add($absolutePath, 1) # olByValue
            Release-ComObject $attachment
        }

        $target = Join-Path $outputRoot "$Name.msg"
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Force
        }

        $saveType = if ($MsgFormat -eq 'Unicode') { 9 } else { 3 }
        $mail.SaveAs($target, $saveType)

        return [ordered]@{
            id = $Name
            file = Get-RelativeFixturePath $target
            producer = 'Microsoft Outlook (classic)'
            msgFormat = $MsgFormat.ToLowerInvariant()
            bodyFormat = $BodyFormat.ToLowerInvariant()
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
            expected = $Expected
        }
    }
    finally {
        Release-ComObject $mail
    }
}

function Save-EmbeddedMessageFixture {
    param([Parameter(Mandatory)] [string]$Name)

    $parent = $script:outlook.CreateItem(0)
    $child = $script:outlook.CreateItem(0)
    try {
        $parent.Subject = 'Parent with embedded message'
        $parent.BodyFormat = 1
        $parent.Body = 'The attachment is an embedded Outlook message.'

        $child.Subject = 'Embedded child message'
        $child.BodyFormat = 1
        $child.Body = 'Embedded message body.'

        $attachment = $parent.Attachments.Add($child, 5) # olEmbeddeditem
        Release-ComObject $attachment

        $target = Join-Path $outputRoot "$Name.msg"
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Force
        }
        $parent.SaveAs($target, 9)

        return [ordered]@{
            id = $Name
            file = Get-RelativeFixturePath $target
            producer = 'Microsoft Outlook (classic)'
            msgFormat = 'unicode'
            bodyFormat = 'plain'
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
            expected = [ordered]@{
                subject = 'Parent with embedded message'
                attachmentCount = 1
                attachmentKinds = @('embedded-message')
            }
        }
    }
    finally {
        Release-ComObject $child
        Release-ComObject $parent
    }
}

$utf8 = [Text.UTF8Encoding]::new($false)
$smallAttachment = Join-Path $assetsRoot 'unicode-text.txt'
$largeAttachment = Join-Path $assetsRoot 'large-binary.bin'
$unicodeAttachmentText = ConvertFrom-Utf8Base64 'WmHFvMOzxYLEhyBnxJnFm2zEhSBqYcW6xYQNCtCf0YDQuNCy0LXRgiwg0LzQuNGADQpFbW9qaTog8J+YgA=='
$unicodeSubject = ConvertFrom-Utf8Base64 'WmHFvMOzxYLEhyBnxJnFm2zEhSDigJQg0KLQtdGB0YLQvtCy0L7QtSDQv9C40YHRjNC80L4='
$unicodeBody = ConvertFrom-Utf8Base64 'UG9sc2tpOiBaYcW8w7PFgsSHIGfEmcWbbMSFIGphxbrFhC4NCtCg0YPRgdGB0LrQuNC5OiDQn9GA0LjQstC10YIsINC80LjRgC4NCkVtb2ppOiDwn5iA'
$unicodeRecipient = ConvertFrom-Utf8Base64 '0JjQstCw0L0g0JjQstCw0L3QvtCyIDxpdmFuQGV4YW1wbGUudGVzdD4='
$unicodeHtml = ConvertFrom-Utf8Base64 'PGh0bWw+PGJvZHk+PGgxPkhUTUwgdGVzdDwvaDE+PHA+UG9sc2tpLCDRgNGD0YHRgdC60LjQuSDQuCBlbW9qaSDwn5iAPC9wPjwvYm9keT48L2h0bWw+'
$ansiPolishSubject = ConvertFrom-Utf8Base64 'QU5TSSBaYcW8w7PFgsSHIGfEmcWbbMSFIGphxbrFhA=='
$ansiRussianSubject = ConvertFrom-Utf8Base64 'QU5TSSDQoNGD0YHRgdC60LjQuSDRgtC10LrRgdGC'
$ansiRussianBody = ConvertFrom-Utf8Base64 '0J/RgNC+0LLQtdGA0LrQsCDQutC40YDQuNC70LvQuNGG0Ysg0LIg0YTQvtGA0LzQsNGC0LUgTVNHIEFOU0ku'

[IO.File]::WriteAllText(
    $smallAttachment,
    $unicodeAttachmentText,
    $utf8
)

$largeBytes = [byte[]]::new(8192)
for ($index = 0; $index -lt $largeBytes.Length; $index++) {
    $largeBytes[$index] = $index % 251
}
[IO.File]::WriteAllBytes($largeAttachment, $largeBytes)

if ($Engine -eq 'MsgKit') {
    Invoke-MsgKitGenerator
    return
}

try {
    $script:outlook = New-Object -ComObject Outlook.Application
} catch {
    if ($Engine -eq 'Outlook') {
        throw 'Microsoft Outlook classic is required for -Engine Outlook. New Outlook does not expose the COM Outlook Object Model.'
    }

    Write-Host 'Classic Outlook is unavailable; using the MsgKit generator.'
    Invoke-MsgKitGenerator
    return
}

try {
    $fixtures = @()

    $fixtures += Save-TestMessage `
        -Name 'plain-basic-unicode' `
        -Subject 'Basic plain message' `
        -Body 'Simple message body.' `
        -To 'recipient@example.test' `
        -Expected @{ subject = 'Basic plain message'; textContains = 'Simple message body.' }

    $fixtures += Save-TestMessage `
        -Name 'unicode-polish-russian' `
        -Subject $unicodeSubject `
        -Body $unicodeBody `
        -To 'Jan Kowalski <jan@example.test>' `
        -Cc $unicodeRecipient `
        -Bcc 'hidden@example.test' `
        -Expected @{ subject = $unicodeSubject; toCount = 1; ccCount = 1; bccCount = 1 }

    $fixtures += Save-TestMessage `
        -Name 'html-unicode' `
        -Subject 'HTML message' `
        -BodyFormat Html `
        -Body $unicodeHtml `
        -Expected @{ subject = 'HTML message'; htmlContains = '<h1>HTML test</h1>' }

    $fixtures += Save-TestMessage `
        -Name 'rtf-unicode' `
        -Subject 'RTF message' `
        -BodyFormat Rtf `
        -Body 'RTF body generated by Outlook.' `
        -Expected @{ subject = 'RTF message'; rtfPresent = $true }

    $fixtures += Save-TestMessage `
        -Name 'empty-unicode' `
        -Subject '' `
        -Body '' `
        -Expected @{ subject = ''; attachmentCount = 0 }

    $fixtures += Save-TestMessage `
        -Name 'ansi-polish' `
        -Subject $ansiPolishSubject `
        -Body 'Polski tekst w formacie MSG ANSI.' `
        -MsgFormat Ansi `
        -Expected @{ subjectContains = 'ANSI'; bestEffortCodepage = $true }

    $fixtures += Save-TestMessage `
        -Name 'ansi-russian' `
        -Subject $ansiRussianSubject `
        -Body $ansiRussianBody `
        -MsgFormat Ansi `
        -Expected @{ subjectContains = 'ANSI'; bestEffortCodepage = $true }

    $fixtures += Save-TestMessage `
        -Name 'small-attachment' `
        -Subject 'Small attachment' `
        -Body 'Contains a small attachment.' `
        -Attachments @($smallAttachment) `
        -Expected @{ subject = 'Small attachment'; attachmentCount = 1; attachmentNames = @('unicode-text.txt') }

    $fixtures += Save-TestMessage `
        -Name 'large-attachment' `
        -Subject 'Large attachment' `
        -Body 'Contains an attachment larger than 4096 bytes.' `
        -Attachments @($largeAttachment) `
        -Expected @{ subject = 'Large attachment'; attachmentCount = 1; attachmentNames = @('large-binary.bin') }

    $fixtures += Save-TestMessage `
        -Name 'multiple-attachments' `
        -Subject 'Multiple attachments' `
        -BodyFormat Html `
        -Body '<html><body>Two attachments</body></html>' `
        -Attachments @($smallAttachment, $largeAttachment) `
        -Expected @{ subject = 'Multiple attachments'; attachmentCount = 2 }

    $fixtures += Save-EmbeddedMessageFixture -Name 'embedded-message'

    $manifest = [ordered]@{
        schemaVersion = 1
        generator = 'scripts/generate-outlook-fixtures.ps1'
        fixtures = $fixtures
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText((Join-Path $outputRoot 'manifest.json'), $manifestJson, $utf8)

    $fixtures | ForEach-Object {
        [PSCustomObject]@{
            Id = $_.id
            Format = $_.msgFormat
            Sha256 = $_.sha256
        }
    } | Format-Table -AutoSize

    Write-Host "Generated $($fixtures.Count) MSG fixtures in $outputRoot"
}
finally {
    Release-ComObject $script:outlook
    Remove-Variable -Name outlook -Scope Script -ErrorAction SilentlyContinue
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
