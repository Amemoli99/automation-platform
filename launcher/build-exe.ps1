# Compila Launcher.cs (launcher\ nel repository, ui\ nel pacchetto) in NexsoftAutomationCockpit.exe nella root del progetto (usa il csc di .NET Framework, già presente su Windows).
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$root = Split-Path $PSScriptRoot -Parent
& $csc /nologo /target:winexe /optimize+ /r:System.Windows.Forms.dll "/win32icon:$PSScriptRoot\nexsoft.ico" "/out:$root\NexsoftAutomationCockpit.exe" "$PSScriptRoot\Launcher.cs"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Write-Host "Creato $root\NexsoftAutomationCockpit.exe"
