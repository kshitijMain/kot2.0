# Lets phones on the Wi-Fi reach the QR pilot running inside WSL (Windows only). WSL has a private
# network of its own, so Windows has to pass ports 8080 (POS), 3100 (QR site) and 8787 (relay) on.
# Run in PowerShell as Administrator; `parosaa-local.sh ports` copies this to ~\kot-ports.ps1:
#
#   powershell -ep bypass ~\kot-ports.ps1            # add or refresh the forwarding and firewall rule
#   powershell -ep bypass ~\kot-ports.ps1 -Remove    # take them away again
#   powershell -ep bypass ~\kot-ports.ps1 -DryRun    # only say what it would do (no Administrator)
param([switch]$Remove, [switch]$DryRun)

$Ports = 8080, 3100, 8787
$RuleName = 'KOT-pilot'
$Distro = '__WSL_DISTRO__'

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $DryRun -and -not $isAdmin) {
  Write-Host 'This needs Administrator rights.'
  Write-Host 'Close this window, right-click PowerShell, choose "Run as administrator", and run it again.'
  exit 1
}

function Invoke-Step([string]$Text, [string[]]$NetshArgs) {
  if ($DryRun) { Write-Host "Would: $Text"; return }
  & netsh @NetshArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "Could not: $Text"; exit 1 }
  Write-Host "Done: $Text"
}

# Forwards made earlier for these ports, whatever address they were made for.
$old = netsh interface portproxy show v4tov4 | ForEach-Object {
  if ($_ -match '^\s*(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s*$' -and $Ports -contains [int]$Matches[2]) {
    [pscustomobject]@{ Address = $Matches[1]; Port = $Matches[2] }
  }
}
foreach ($entry in $old) {
  Invoke-Step "remove the old forwarding of $($entry.Address):$($entry.Port)" @(
    'interface', 'portproxy', 'delete', 'v4tov4',
    "listenaddress=$($entry.Address)", "listenport=$($entry.Port)")
}

& netsh advfirewall firewall show rule name=$RuleName | Out-Null
$hasRule = $LASTEXITCODE -eq 0

if ($Remove) {
  if ($hasRule) {
    Invoke-Step "remove the firewall rule $RuleName" @(
      'advfirewall', 'firewall', 'delete', 'rule', "name=$RuleName")
  }
  Write-Host 'Removed. Phones can no longer reach the pilot on this computer.'
  exit 0
}

$routes = Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object {
  $_.RouteMetric + (Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4).InterfaceMetric
}
if (-not $routes) { Write-Host 'This computer is not on a network. Connect to the Wi-Fi first.'; exit 1 }
$wifi = @(Get-NetIPAddress -InterfaceIndex @($routes)[0].ifIndex -AddressFamily IPv4)[0].IPAddress

$wslArgs = @('-e', 'hostname', '-I')
if ($Distro -notlike '__*') { $wslArgs = @('-d', $Distro) + $wslArgs }
$wsl = (& wsl.exe @wslArgs) -join ' ' -split '\s+' |
  Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notlike '172.17.*' } |
  Select-Object -First 1
if (-not $wsl) { Write-Host 'WSL did not answer. Open the Ubuntu window, then run this again.'; exit 1 }

foreach ($port in $Ports) {
  Invoke-Step "forward ${wifi}:$port to WSL ${wsl}:$port" @(
    'interface', 'portproxy', 'add', 'v4tov4', "listenaddress=$wifi", "listenport=$port",
    "connectaddress=$wsl", "connectport=$port")
}
if (-not $hasRule) {
  Invoke-Step "add the firewall rule $RuleName" @(
    'advfirewall', 'firewall', 'add', 'rule', "name=$RuleName", 'dir=in', 'action=allow',
    'protocol=TCP', "localport=$($Ports -join ',')", 'profile=any')
}
Write-Host "Finished. Phones on this Wi-Fi can reach this computer at $wifi."
