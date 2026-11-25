$ErrorActionPreference = 'Stop'
$webRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$icon = Join-Path $webRoot 'build/icon.ico'
$output = Join-Path $webRoot 'The Foundry Web.exe'
$source = Join-Path $PSScriptRoot 'FoundryWebLauncher.cs'

$compilerArgs = @(
    '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu'
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll'
    "/out:$output"
)
if (Test-Path -LiteralPath $icon) {
    $compilerArgs += "/win32icon:$icon"
}
& $compiler @compilerArgs $source
if ($LASTEXITCODE -ne 0) { throw 'Foundry Web launcher compilation failed.' }
Write-Output $output
