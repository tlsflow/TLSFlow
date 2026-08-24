using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.IO;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Security.Cryptography.X509Certificates;

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
            facts["runtime.framework_35_installed"] = HasFramework35();
            facts["windows.version"] = Environment.OSVersion.Version.ToString();
            facts["windows.service_pack"] = ReadServicePack();
            facts["windows.product_name"] = ReadRegistryString(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion", "ProductName");
            facts["windows.build_number"] = ReadRegistryString(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber");
            facts["windows.machine_id"] = ReadRegistryString(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography", "MachineGuid");
            facts["security.tls12_enabled"] = SupportsTls12(config == null ? null : config.controlPlaneUrl);
            facts["identity.is_administrator"] = IsAdministrator();
            facts["network.hostname"] = Dns.GetHostName();
            facts["network.primary_ip"] = ReadPrimaryIpAddress();
            facts["windows.required_hotfixes_present"] = RequiredHotfixesPresent(config == null ? new string[0] : config.requiredHotfixes);
            facts["windows.cert_store_writable"] = CanWriteCertificateStore();
            facts["network.control_plane_reachable"] = CanReachControlPlane(config == null ? null : config.controlPlaneUrl);
            facts["web.inventory"] = new Dictionary<string, object>
            {
                { "processExecutables", CollectWebProcessExecutables() },
                { "listeningPorts", CollectListeningPorts() },
                { "configFiles", CollectWebConfigFiles() },
                { "certificateFiles", CollectCertificateFiles() }
            };
            List<string> capabilities = new List<string>();
            capabilities.Add("agent.control.register");
            capabilities.Add("agent.control.heartbeat");
            capabilities.Add("agent.control.task_poll");
            capabilities.Add("agent.action.registry");
            capabilities.Add("agent.full.online");
            capabilities.Add("agent.task.receive");
            capabilities.Add("runtime.windows.compatibility_agent");
            capabilities.Add("windows.scm.inspect");
            capabilities.Add("windows.cert_store.local_machine");
            capabilities.Add("certificate.material.validate");
            capabilities.Add("certificate.verify");
            return new CapabilitySnapshot
            {
                SchemaVersion = ProductIdentity.CapabilitySchemaVersion,
                SnapshotId = Guid.NewGuid().ToString("N"),
                CollectedAtUtc = DateTime.UtcNow,
                Facts = facts,
                Capabilities = capabilities
            };
        }

        // 兼容 Agent 只读取 Windows 只读系统命令，绝不执行进程或配置写入。
        private static string[] CollectWebProcessExecutables()
        {
            List<string> result = new List<string>();
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT Name, ExecutablePath FROM Win32_Process"))
                {
                    foreach (ManagementObject item in searcher.Get())
                    {
                        string name = Convert.ToString(item["Name"]);
                        string path = Convert.ToString(item["ExecutablePath"]);
                        string candidate = TextUtility.IsBlank(path) ? name : path;
                        if (!TextUtility.IsBlank(candidate) && !result.Contains(candidate)) result.Add(candidate);
                    }
                }
            }
            catch { }
            result.Sort(StringComparer.OrdinalIgnoreCase);
            return result.ToArray();
        }

        private static object[] CollectListeningPorts()
        {
            List<object> result = new List<object>();
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT LocalAddress, LocalPort, Protocol, State FROM Win32_NetTCPConnection WHERE State = 2"))
                {
                    foreach (ManagementObject item in searcher.Get())
                    {
                        result.Add(new Dictionary<string, object>
                        {
                            { "kind", "listening_port" },
                            { "address", Convert.ToString(item["LocalAddress"]) },
                            { "port", Convert.ToInt32(item["LocalPort"]) },
                            { "protocol", "tcp" }
                        });
                    }
                }
            }
            catch { }
            return result.ToArray();
        }

        // 只读取固定安装目录中的原始配置，禁止在 Compatibility Agent Core 内解析产品语义。
        private static object[] CollectWebConfigFiles()
        {
            List<object> result = new List<object>();
            AddWebConfigFile(result, @"C:\Windows\System32\inetsrv\config\applicationHost.config");
            string[] roots = new string[]
            {
                @"C:\nginx", @"C:\Apache24", @"C:\Tomcat",
                @"C:\ProgramData", @"C:\Program Files", @"C:\Program Files (x86)"
            };
            for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
            {
                try
                {
                    string[] paths = Directory.GetFiles(roots[rootIndex], "*.*", SearchOption.AllDirectories);
                    for (int index = 0; index < paths.Length && result.Count < 256; index++)
                    {
                        string extension = Path.GetExtension(paths[index]).ToLowerInvariant();
                        if (extension != ".conf" && extension != ".xml" && extension != ".properties" && extension != ".config") continue;
                        AddWebConfigFile(result, paths[index]);
                    }
                }
                catch { }
            }
            return result.ToArray();
        }

        private static void AddWebConfigFile(List<object> result, string path)
        {
            if (result == null || TextUtility.IsBlank(path) || result.Count >= 256) return;
            try
            {
                FileInfo info = new FileInfo(path);
                if (!info.Exists || info.Length > 262144) return;
                string normalizedPath = path.Replace('\\', '/');
                foreach (object item in result)
                {
                    Dictionary<string, object> existing = item as Dictionary<string, object>;
                    if (existing != null && string.Equals(Convert.ToString(existing["path"]), normalizedPath, StringComparison.OrdinalIgnoreCase)) return;
                }
                result.Add(new Dictionary<string, object> { { "path", normalizedPath }, { "content", File.ReadAllText(path) } });
            }
            catch { }
        }

        private static int ReadDotNetRelease()
        {
            object value = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full", "Release", 0);
            return value is int ? (int)value : 0;
        }

        private static bool HasFramework35()
        {
            object framework35 = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\NET Framework Setup\NDP\v3.5", "Install", 0);
            return framework35 is int && (int)framework35 == 1;
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

        private static string ReadRegistryString(string keyName, string valueName)
        {
            object value = Registry.GetValue(keyName, valueName, string.Empty);
            return value == null ? string.Empty : Convert.ToString(value);
        }

        private static string ReadPrimaryIpAddress()
        {
            try
            {
                IPAddress[] addresses = Dns.GetHostEntry(Dns.GetHostName()).AddressList;
                foreach (IPAddress address in addresses)
                {
                    if (address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(address)) continue;
                    byte[] bytes = address.GetAddressBytes();
                    if (bytes.Length == 4 && bytes[0] == 169 && bytes[1] == 254) continue;
                    return address.ToString();
                }
            }
            catch { }
            return string.Empty;
        }

        // 只回传公开证书摘要；不读取或上报私钥、PFX 和 JKS 原文。
        private static object[] CollectCertificateFiles()
        {
            List<object> result = new List<object>();
            string[] roots = new string[]
            {
                @"C:\nginx", @"C:\Apache24", @"C:\Tomcat",
                @"C:\ProgramData", @"C:\Program Files", @"C:\Program Files (x86)"
            };
            for (int rootIndex = 0; rootIndex < roots.Length && result.Count < 256; rootIndex++)
            {
                try
                {
                    string[] paths = Directory.GetFiles(roots[rootIndex], "*.*", SearchOption.AllDirectories);
                    for (int index = 0; index < paths.Length && result.Count < 256; index++)
                    {
                        string extension = Path.GetExtension(paths[index]).ToLowerInvariant();
                        if (extension != ".pem" && extension != ".crt" && extension != ".cer" && extension != ".der") continue;
                        Dictionary<string, object> certificate = ReadCertificateSummary(paths[index]);
                        if (certificate == null) continue;
                        certificate["path"] = paths[index].Replace('\\', '/');
                        certificate["configuredPaths"] = new string[] { Path.GetFileName(paths[index]) };
                        result.Add(certificate);
                    }
                }
                catch { }
            }
            foreach (object item in ReadWindowsCertificateStore("My"))
                if (result.Count < 512) result.Add(item);
            return result.ToArray();
        }

        private static List<object> ReadWindowsCertificateStore(string storeName)
        {
            List<object> result = new List<object>();
            try
            {
                X509Store store = new X509Store(storeName, StoreLocation.LocalMachine);
                try
                {
                    store.Open(OpenFlags.OpenExistingOnly | OpenFlags.ReadOnly);
                    foreach (X509Certificate2 certificate in store.Certificates)
                    {
                        string thumbprint = NormalizeHex(certificate.Thumbprint);
                        if (TextUtility.IsBlank(thumbprint)) continue;
                        Dictionary<string, object> summary = CertificateSummary(certificate);
                        summary["path"] = "windows-certstore://LocalMachine/" + storeName + "/" + thumbprint;
                        summary["thumbprint"] = thumbprint;
                        summary["store"] = storeName;
                        summary["storeLocation"] = "LocalMachine";
                        result.Add(summary);
                        certificate.Reset();
                    }
                }
                finally { store.Close(); }
            }
            catch { }
            return result;
        }

        private static Dictionary<string, object> ReadCertificateSummary(string path)
        {
            try
            {
                byte[] raw = File.ReadAllBytes(path);
                string text = System.Text.Encoding.ASCII.GetString(raw);
                System.Text.RegularExpressions.Match match = System.Text.RegularExpressions.Regex.Match(text, "-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----", System.Text.RegularExpressions.RegexOptions.Singleline);
                if (match.Success) raw = Convert.FromBase64String(System.Text.RegularExpressions.Regex.Replace(match.Groups[1].Value, @"\s+", string.Empty));
                X509Certificate2 certificate = new X509Certificate2(raw);
                Dictionary<string, object> summary = CertificateSummary(certificate);
                certificate.Reset();
                return summary;
            }
            catch { return null; }
        }

        private static Dictionary<string, object> CertificateSummary(X509Certificate2 certificate)
        {
            byte[] digest;
            using (SHA256 sha = new SHA256Managed()) digest = sha.ComputeHash(certificate.RawData);
            Dictionary<string, object> summary = new Dictionary<string, object>();
            summary["sha256Fingerprint"] = ToHex(digest);
            summary["thumbprint"] = NormalizeHex(certificate.Thumbprint);
            summary["subject"] = certificate.Subject;
            summary["issuer"] = certificate.Issuer;
            summary["notBefore"] = certificate.NotBefore.ToUniversalTime().ToString("o");
            summary["notAfter"] = certificate.NotAfter.ToUniversalTime().ToString("o");
            return summary;
        }

        private static string NormalizeHex(string value)
        {
            if (TextUtility.IsBlank(value)) return string.Empty;
            System.Text.StringBuilder builder = new System.Text.StringBuilder();
            foreach (char character in value)
                if ((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) builder.Append(character);
            return builder.ToString().ToUpperInvariant();
        }

        private static string ToHex(byte[] bytes)
        {
            System.Text.StringBuilder builder = new System.Text.StringBuilder();
            foreach (byte value in bytes) builder.Append(value.ToString("x2"));
            return builder.ToString();
        }
        private static bool SupportsTls12(string controlPlaneUrl)
        {
            if (!TransportProtocol.IsHttps(controlPlaneUrl)) return true;
            SecurityProtocolType previous = ServicePointManager.SecurityProtocol;
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
                return (int)ServicePointManager.SecurityProtocol == 3072;
            }
            catch { return false; }
            finally { ServicePointManager.SecurityProtocol = previous; }
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
            if (string.IsNullOrEmpty(url) || url.Trim().Length == 0) return false;
            try { return new TlsVerifierAdapter().CanReach(url, 5000); }
            catch { return false; }
        }
    }
}
