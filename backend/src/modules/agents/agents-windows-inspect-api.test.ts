import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';

describe('windows inspect capability api', () => {
  it('accepts detailed Windows inspect payloads and returns them from detail endpoints', async () => {
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_agent_windows', 'x-request-id': 'req_agent_windows_1' };
    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'winps.inspect.01',
        hostname: 'WINPS-01',
        version: '0.1.0',
        osType: 'windows',
        arch: 'x64',
        role: 'full_agent',
        zone: 'default',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agent = registered.body as { id: string };

    const capabilities = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/capabilities',
      headers,
      body: {
        agentId: agent.id,
        compatibilityLevel: 'L1',
        capabilities: [
          {
            capabilityKey: 'windows.os.detail',
            value: {
              Caption: 'Microsoft Windows Server 2022 Datacenter',
              ProductName: 'Windows Server 2022 Datacenter',
              Version: '10.0.20348',
              BuildNumber: '20348',
              BuildRevision: '20348.2402',
              CurrentBuild: '20348',
              CurrentBuildNumber: '20348',
              UBR: 2402,
              DisplayVersion: '21H2',
              ReleaseId: '2009',
              EditionId: 'ServerDatacenter',
              InstallationType: 'Server',
              BuildLabEx: '20348.2402.amd64fre.fe_release_svc_prod3.240206-1234',
              OsArchitecture: '64-bit',
              ProductType: 3,
              LastBootUpTime: '2026-06-22T09:30:00.000Z',
            },
            confidence: 1,
            evidence: { source: 'runtime-inspection' },
          },
          {
            capabilityKey: 'windows.iis.detail',
            value: {
              Installed: true,
              VersionString: 'Version 10.0',
              MajorVersion: 10,
              MinorVersion: 0,
              BuildNumber: 20348,
              SetupString: 'IIS',
              Sites: [
                {
                  Id: 1,
                  Name: 'Default Web Site',
                  State: 'Started',
                  ServerAutoStart: true,
                  PhysicalPath: 'C:\\inetpub\\wwwroot',
                  Bindings: [
                    {
                      Protocol: 'https',
                      BindingInformation: '*:443:portal.example.com',
                      IPAddress: '*',
                      Port: 443,
                      HostHeader: 'portal.example.com',
                      CertificateStoreName: 'My',
                      CertificateThumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
                      SslFlags: 1,
                      Certificate: {
                        Thumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
                        StoreName: 'My',
                        Subject: 'CN=portal.example.com',
                        Issuer: 'CN=GCAC Test CA',
                        NotBefore: '2026-01-01T00:00:00.000Z',
                        NotAfter: '2027-01-01T00:00:00.000Z',
                      },
                    },
                  ],
                },
              ],
            },
            confidence: 1,
            evidence: { source: 'runtime-inspection' },
          },
          {
            capabilityKey: 'windows.iis.sites',
            value: [
              {
                Id: 1,
                Name: 'Default Web Site',
                State: 'Started',
                ServerAutoStart: true,
                PhysicalPath: 'C:\\inetpub\\wwwroot',
                Bindings: [
                  {
                    Protocol: 'https',
                    BindingInformation: '*:443:portal.example.com',
                    IPAddress: '*',
                    Port: 443,
                    HostHeader: 'portal.example.com',
                    CertificateStoreName: 'My',
                    CertificateThumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
                    SslFlags: 1,
                    Certificate: {
                      Thumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
                      StoreName: 'My',
                      Subject: 'CN=portal.example.com',
                      Issuer: 'CN=GCAC Test CA',
                      NotBefore: '2026-01-01T00:00:00.000Z',
                      NotAfter: '2027-01-01T00:00:00.000Z',
                    },
                  },
                ],
              },
            ],
            confidence: 1,
            evidence: { source: 'runtime-inspection' },
          },
          {
            capabilityKey: 'windows.network.adapters',
            value: [
              {
                Index: 7,
                Guid: 'adapter-guid-01',
                Name: 'Intel(R) Ethernet Connection',
                NetConnectionId: 'Ethernet0',
                Description: 'Intel(R) Ethernet Controller',
                Manufacturer: 'Intel',
                ServiceName: 'e1rexpress',
                MACAddress: '30:56:0F:11:02:EE',
                PhysicalAdapter: true,
                AdapterType: 'Ethernet 802.3',
                NetEnabled: true,
                NetConnectionStatus: 2,
                Speed: 1000000000,
                DHCPEnabled: false,
                IPEnabled: true,
                IPv4: ['10.255.0.85'],
                IPv6: ['fe80::1234:5678:90ab:cdef'],
              },
            ],
            confidence: 1,
            evidence: { source: 'runtime-inspection' },
          },
        ],
      },
    });
    assert.equal(capabilities.statusCode, 201);

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/detail?agentId=${agent.id}`,
      headers,
    });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.body as {
      capabilitySnapshot: {
        compatibilityLevel: string;
        capabilities: Array<{ capabilityKey: string; value: unknown }>;
      };
      capabilities: {
        declarations: Array<{ capabilityKey: string; value: unknown }>;
      };
    };

    assert.equal(detailBody.capabilitySnapshot.compatibilityLevel, 'L1');

    const osCapability = detailBody.capabilitySnapshot.capabilities.find((item) => item.capabilityKey === 'windows.os.detail');
    assert.ok(osCapability);
    assert.equal((osCapability?.value as { DisplayVersion: string }).DisplayVersion, '21H2');
    assert.equal((osCapability?.value as { BuildRevision: string }).BuildRevision, '20348.2402');

    const iisCapability = detailBody.capabilitySnapshot.capabilities.find((item) => item.capabilityKey === 'windows.iis.detail');
    assert.ok(iisCapability);
    assert.equal((iisCapability?.value as { Installed: boolean }).Installed, true);
    assert.equal((iisCapability?.value as { VersionString: string }).VersionString, 'Version 10.0');
    const firstIisSite = (iisCapability?.value as {
      Sites: Array<{
        Name: string;
        PhysicalPath: string;
        Bindings: Array<{
          Protocol: string;
          Port: number;
          Certificate: { Subject: string };
        }>;
      }>;
    }).Sites[0];
    assert.equal(firstIisSite.Name, 'Default Web Site');
    assert.equal(firstIisSite.PhysicalPath, 'C:\\inetpub\\wwwroot');
    assert.equal(firstIisSite.Bindings[0]?.Protocol, 'https');
    assert.equal(firstIisSite.Bindings[0]?.Port, 443);
    assert.equal(firstIisSite.Bindings[0]?.Certificate.Subject, 'CN=portal.example.com');

    const networkDeclaration = detailBody.capabilities.declarations.find((item) => item.capabilityKey === 'windows.network.adapters');
    assert.ok(networkDeclaration);
    const firstAdapter = (networkDeclaration?.value as Array<{ MACAddress: string; IPv4: string[]; IPv6: string[]; IPEnabled: boolean }>)[0];
    assert.equal(firstAdapter.MACAddress, '30:56:0F:11:02:EE');
    assert.deepEqual(firstAdapter.IPv4, ['10.255.0.85']);
    assert.deepEqual(firstAdapter.IPv6, ['fe80::1234:5678:90ab:cdef']);
    assert.equal(firstAdapter.IPEnabled, true);

    const iisSitesDeclaration = detailBody.capabilities.declarations.find((item) => item.capabilityKey === 'windows.iis.sites');
    assert.ok(iisSitesDeclaration);
    const firstDeclaredSite = (iisSitesDeclaration?.value as Array<{
      Name: string;
      PhysicalPath: string;
      Bindings: Array<{ CertificateThumbprint: string }>;
    }>)[0];
    assert.equal(firstDeclaredSite.Name, 'Default Web Site');
    assert.equal(firstDeclaredSite.PhysicalPath, 'C:\\inetpub\\wwwroot');
    assert.equal(firstDeclaredSite.Bindings[0]?.CertificateThumbprint, 'AABBCCDDEEFF00112233445566778899AABBCCDD');
  });
});
