using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Management;
using System.Net;
using System.Security.Principal;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class CapabilityCollector
    {
        private readonly AgentConfig config;

        public CapabilityCollector()
        {
        }

        public CapabilityCollector(AgentConfig config)
        {
            this.config = config;
        }

        public CapabilitySnapshot Collect()
        {
            Dictionary<string, object> facts = new Dictionary<string, object>();
            facts["runtime.product_line"] = ProductIdentity.ProductLine;
            facts["runtime.kind"] = ProductIdentity.Runtime;
            facts["runtime.framework_release"] = ReadDotNetRelease();
            facts["windows.version"] = Environment.OSVersion.Version.ToString();
            facts["windows.service_pack"] = ReadServicePack();
            facts["security.tls12_enabled"] = SupportsTls12();
            facts["identity.is_administrator"] = IsAdministrator();
            facts["network.hostname"] = Dns.GetHostName();
            facts["windows.required_hotfixes_present"] = RequiredHotfixesPresent(config == null ? new string[0] : config.requiredHotfixes);
            facts["windows.cert_store_writable"] = CanWriteCertificateStore();
            facts["network.control_plane_reachable"] = CanReachControlPlane(config == null ? null : config.controlPlaneUrl);
            List<string> capabilities = new List<string>();
            capabilities.Add("agent.control.register");
            capabilities.Add("agent.control.heartbeat");
            capabilities.Add("agent.control.task_poll");
            capabilities.Add("agent.action.registry");
            capabilities.Add("agent.full.online");
            capabilities.Add("agent.task.receive");
            capabilities.Add("runtime.windows.compatibility_agent");
            capabilities.Add("windows.file.atomic_replace");
            capabilities.Add("windows.scm.inspect");
            capabilities.Add("windows.cert_store.local_machine");
            capabilities.Add("windows.certstore.import_pfx");
            capabilities.Add("iis.binding.update");
            capabilities.Add("service.restart");
            capabilities.Add("rollback.restore");
            capabilities.Add("tls.local_verify");
            capabilities.Add("tls.remote_probe");
            capabilities.Add("network.tls.verify");
            return new CapabilitySnapshot
            {
                SchemaVersion = ProductIdentity.CapabilitySchemaVersion,
                SnapshotId = Guid.NewGuid().ToString("N"),
                CollectedAtUtc = DateTime.UtcNow,
                Facts = facts,
                Capabilities = capabilities
            };
        }

        private static int ReadDotNetRelease()
        {
            object value = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full", "Release", 0);
            return value is int ? (int)value : 0;
        }

        private static string ReadServicePack()
        {
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT CSDVersion FROM Win32_OperatingSystem"))
                    foreach (ManagementObject item in searcher.Get()) return Convert.ToString(item["CSDVersion"]);
            }
            catch { }
            return string.Empty;
        }

        private static bool SupportsTls12()
        {
            return Enum.IsDefined(typeof(SecurityProtocolType), 3072);
        }

        private static bool IsAdministrator()
        {
            WindowsPrincipal principal = new WindowsPrincipal(WindowsIdentity.GetCurrent());
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }

        private static bool RequiredHotfixesPresent(string[] requiredHotfixes)
        {
            if (requiredHotfixes == null || requiredHotfixes.Length == 0) return true;
            HashSet<string> installed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT HotFixID FROM Win32_QuickFixEngineering"))
                    foreach (ManagementObject item in searcher.Get()) installed.Add(Convert.ToString(item["HotFixID"]));
            }
            catch { return false; }
            foreach (string required in requiredHotfixes) if (!installed.Contains(required)) return false;
            return true;
        }

        private static bool CanWriteCertificateStore()
        {
            try { return new CertificateStoreAdapter().CanOpenLocalMachineStore(); }
            catch { return false; }
        }

        private static bool CanReachControlPlane(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return false;
            try { return new TlsVerifierAdapter().CanReach(url, 5000); }
            catch { return false; }
        }
    }
}
