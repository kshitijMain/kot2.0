BeforeAll {
    . (Join-Path $PSScriptRoot 'TestHelpers.ps1')

    function New-TestAdapter {
        param([string] $Name, [string] $Address, [switch] $Gateway, [string] $Origin = 'Dhcp', [string] $Description = '')
        [pscustomobject]@{
            Name                 = $Name
            InterfaceDescription = $Description
            IPv4Address          = $Address
            PrefixLength         = 24
            HasGateway           = [bool]$Gateway
            PrefixOrigin         = $Origin
        }
    }
}

Describe '[AUTH-007] the staff network (P9-27)' {
    It 'chooses the adapter with the internet gateway, leaving out VPNs and virtual machines' {
        $adapters = @(
            (New-TestAdapter -Name 'vEthernet (Default Switch)' -Address '172.29.16.1'),
            (New-TestAdapter -Name 'Ethernet 3' -Address '10.8.0.2' -Description 'TAP-Windows Adapter V9'),
            (New-TestAdapter -Name 'Tailscale' -Address '100.101.102.103'),
            (New-TestAdapter -Name 'Bluetooth Network Connection' -Address '169.254.3.4'),
            (New-TestAdapter -Name 'Ethernet' -Address '10.0.0.15'),
            (New-TestAdapter -Name 'Wi-Fi' -Address '192.168.1.20' -Gateway)
        )
        $network = Select-RPStaffNetwork -Adapter $adapters
        $network.Name | Should -Be 'Wi-Fi'
        $network.IPv4Address | Should -Be '192.168.1.20'
        $network.Dhcp | Should -BeTrue
        @($network.Others) | Should -Be @('Ethernet')
    }

    It 'takes the adapter the installer was told, when it is there' {
        $adapters = @(
            (New-TestAdapter -Name 'Ethernet' -Address '10.0.0.15' -Origin 'Manual'),
            (New-TestAdapter -Name 'Wi-Fi' -Address '192.168.1.20' -Gateway)
        )
        $network = Select-RPStaffNetwork -Adapter $adapters -Preferred ' Ethernet '
        $network.Name | Should -Be 'Ethernet'
        $network.Dhcp | Should -BeFalse
        (Select-RPStaffNetwork -Adapter $adapters -Preferred 'Mobile hotspot').Name | Should -Be 'Wi-Fi'
    }

    It 'says there is none when the PC has no usable network' {
        Select-RPStaffNetwork -Adapter @() | Should -BeNullOrEmpty
        Select-RPStaffNetwork -Adapter @((New-TestAdapter -Name 'Wi-Fi' -Address '169.254.9.9')) | Should -BeNullOrEmpty
    }

    It 'never offers link-local, carrier-NAT or loopback addresses' {
        foreach ($address in @('169.254.1.1', '100.64.0.1', '100.127.255.1', '127.0.0.1', 'not-an-address')) {
            Test-RPUsableAddress -Address $address | Should -BeFalse
        }
        foreach ($address in @('192.168.1.20', '10.0.0.15', '172.16.5.4', '100.63.0.1')) {
            Test-RPUsableAddress -Address $address | Should -BeTrue
        }
    }
}
