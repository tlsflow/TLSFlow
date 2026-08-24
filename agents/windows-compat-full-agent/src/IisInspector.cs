using Microsoft.Win32;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class IisInspectionResult
    {
        public Dictionary<string, object> Detail { get; set; }
        public List<Dictionary<string, object>> Sites { get; set; }
        public string Error { get; set; }
    }

    internal sealed class IisInspector
    {
        public IisInspectionResult Inspect()
        {
            bool installed = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\InetStp", "MajorVersion", null) != null;
            string versionString = Convert.ToString(Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\InetStp", "VersionString", string.Empty));
            List<Dictionary<string, object>> sites = new List<Dictionary<string, object>>();
            Dictionary<string, object> detail = new Dictionary<string, object>
            {
                { "Installed", installed },
                { "VersionString", versionString },
                { "Sites", sites }
            };
            if (!installed) return new IisInspectionResult { Detail = detail, Sites = sites };

            IDisposable manager = null;
            try
            {
                manager = CreateServerManager();
                IEnumerable siteCollection = GetProperty(manager, "Sites") as IEnumerable;
                if (siteCollection == null) throw new InvalidOperationException("IIS Sites 集合不可用");
                foreach (object site in siteCollection) sites.Add(InspectSite(site));
                return new IisInspectionResult { Detail = detail, Sites = sites };
            }
            catch (Exception error)
            {
                detail["InspectionError"] = error.Message;
                return new IisInspectionResult { Detail = detail, Sites = sites, Error = error.Message };
            }
            finally
            {
                if (manager != null) manager.Dispose();
            }
        }

        internal static Dictionary<string, object> ParseBindingInformation(string value)
        {
            string bindingInformation = value ?? string.Empty;
            int hostSeparator = bindingInformation.LastIndexOf(':');
            int portSeparator = hostSeparator > 0 ? bindingInformation.LastIndexOf(':', hostSeparator - 1) : -1;
            string ipAddress = portSeparator >= 0 ? bindingInformation.Substring(0, portSeparator) : string.Empty;
            string portText = portSeparator >= 0 && hostSeparator > portSeparator ? bindingInformation.Substring(portSeparator + 1, hostSeparator - portSeparator - 1) : string.Empty;
            string hostHeader = hostSeparator >= 0 && hostSeparator + 1 < bindingInformation.Length ? bindingInformation.Substring(hostSeparator + 1) : string.Empty;
            int port;
            int.TryParse(portText, out port);
            return new Dictionary<string, object>
            {
                { "IPAddress", ipAddress },
                { "Port", port },
                { "HostHeader", hostHeader }
            };
        }

        private static Dictionary<string, object> InspectSite(object site)
        {
            List<Dictionary<string, object>> bindings = new List<Dictionary<string, object>>();
            IEnumerable bindingCollection = GetProperty(site, "Bindings") as IEnumerable;
            if (bindingCollection != null)
                foreach (object binding in bindingCollection) bindings.Add(InspectBinding(binding));

            object rootApplication = GetIndexerValue(GetProperty(site, "Applications"), "/");
            string appPool = rootApplication == null ? string.Empty : Convert.ToString(GetOptionalProperty(rootApplication, "ApplicationPoolName"));
            object rootVirtualDirectory = rootApplication == null ? null : GetIndexerValue(GetProperty(rootApplication, "VirtualDirectories"), "/");
            string physicalPath = rootVirtualDirectory == null ? string.Empty : Convert.ToString(GetOptionalProperty(rootVirtualDirectory, "PhysicalPath"));
            return new Dictionary<string, object>
            {
                { "Id", Convert.ToInt64(GetProperty(site, "Id")) },
                { "Name", Convert.ToString(GetProperty(site, "Name")) },
                { "AppPool", appPool },
                { "State", Convert.ToString(GetOptionalProperty(site, "State")) },
                { "ServerAutoStart", Convert.ToBoolean(GetProperty(site, "ServerAutoStart")) },
                { "PhysicalPath", physicalPath },
                { "Bindings", bindings }
            };
        }

        private static Dictionary<string, object> InspectBinding(object binding)
        {
            string protocol = Convert.ToString(GetProperty(binding, "Protocol"));
            string bindingInformation = Convert.ToString(GetProperty(binding, "BindingInformation"));
            Dictionary<string, object> parsed = ParseBindingInformation(bindingInformation);
            string storeName = Convert.ToString(GetOptionalProperty(binding, "CertificateStoreName"));
            string thumbprint = ReadCertificateThumbprint(binding);
            string certificateSource = TextUtility.IsBlank(thumbprint) ? string.Empty : "iis-binding";
            if (string.Equals(protocol, "https", StringComparison.OrdinalIgnoreCase) && TextUtility.IsBlank(thumbprint))
            {
                Dictionary<string, string> httpSysBinding = ReadHttpSysCertificateBinding(
                    Convert.ToString(parsed["IPAddress"]),
                    Convert.ToInt32(parsed["Port"]));
                if (httpSysBinding != null)
                {
                    thumbprint = httpSysBinding["CertificateThumbprint"];
                    certificateSource = "http.sys";
                    if (TextUtility.IsBlank(storeName)) storeName = httpSysBinding["CertificateStoreName"];
                }
            }
            Dictionary<string, object> certificate = string.Equals(protocol, "https", StringComparison.OrdinalIgnoreCase)
                ? ReadCertificate(storeName, thumbprint)
                : null;
            return new Dictionary<string, object>
            {
                { "Protocol", protocol },
                { "BindingInformation", bindingInformation },
                { "IPAddress", parsed["IPAddress"] },
                { "Port", parsed["Port"] },
                { "HostHeader", parsed["HostHeader"] },
                { "CertificateStoreName", TextUtility.IsBlank(storeName) ? "My" : storeName },
                { "CertificateThumbprint", thumbprint },
                { "CertificateSource", certificateSource },
                { "SslFlags", ReadSslFlags(binding) },
                { "Certificate", certificate }
            };
        }

        internal static string ReadCertificateThumbprint(object binding)
        {
            if (binding == null) return string.Empty;
            string thumbprint = NormalizeCertificateThumbprint(GetOptionalProperty(binding, "CertificateHash"));
            if (!TextUtility.IsBlank(thumbprint)) return thumbprint;

            MethodInfo method = binding.GetType().GetMethod("GetAttributeValue", BindingFlags.Instance | BindingFlags.Public);
            if (method == null) return string.Empty;
            try
            {
                return NormalizeCertificateThumbprint(method.Invoke(binding, new object[] { "certificateHash" }));
            }
            catch
            {
                return string.Empty;
            }
        }

        internal static Dictionary<string, string> ParseHttpSysSslCertOutput(string output, string ipAddress, int port)
        {
            if (TextUtility.IsBlank(output) || port < 1 || port > 65535) return null;
            bool inMatchingBinding = false;
            string thumbprint = string.Empty;
            string storeName = string.Empty;
            string[] lines = output.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            foreach (string line in lines)
            {
                if (IsHttpSysEndpointLine(line))
                {
                    if (inMatchingBinding && !TextUtility.IsBlank(thumbprint))
                        return HttpSysBinding(thumbprint, storeName);
                    inMatchingBinding = MatchesHttpSysEndpoint(line, ipAddress, port);
                    thumbprint = string.Empty;
                    storeName = string.Empty;
                    continue;
                }
                if (!inMatchingBinding) continue;
                string normalized = line.Trim();
                if (normalized.Length == 0)
                {
                    if (!TextUtility.IsBlank(thumbprint)) return HttpSysBinding(thumbprint, storeName);
                    inMatchingBinding = false;
                    continue;
                }
                if (ContainsAny(normalized, "certificate hash", "certificatehash", "证书哈希"))
                    thumbprint = NormalizeCertificateThumbprint(ValueAfterColon(normalized));
                else if (ContainsAny(normalized, "certificate store name", "cert store name", "证书存储名称", "证书存储名"))
                    storeName = ValueAfterColon(normalized).Trim();
            }
            return inMatchingBinding && !TextUtility.IsBlank(thumbprint)
                ? HttpSysBinding(thumbprint, storeName)
                : null;
        }

        private static Dictionary<string, string> ReadHttpSysCertificateBinding(string ipAddress, int port)
        {
            try
            {
                string windir = Environment.GetEnvironmentVariable("WINDIR");
                string executable = TextUtility.IsBlank(windir)
                    ? "netsh.exe"
                    : Path.Combine(Path.Combine(windir, "System32"), "netsh.exe");
                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = executable,
                    Arguments = "http show sslcert",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                };
                using (Process process = Process.Start(startInfo))
                {
                    if (process == null) return null;
                    if (!process.WaitForExit(5000))
                    {
                        try { process.Kill(); }
                        catch { }
                        return null;
                    }
                    return ParseHttpSysSslCertOutput(process.StandardOutput.ReadToEnd(), ipAddress, port);
                }
            }
            catch
            {
                return null;
            }
        }

        private static bool IsHttpSysEndpointLine(string value)
        {
            string normalized = value == null ? string.Empty : value.Trim().ToLowerInvariant();
            return normalized.StartsWith("ip:port", StringComparison.Ordinal)
                || normalized.StartsWith("hostname:port", StringComparison.Ordinal)
                || normalized.StartsWith("ip:端口", StringComparison.Ordinal)
                || normalized.StartsWith("主机名:端口", StringComparison.Ordinal);
        }

        private static bool MatchesHttpSysEndpoint(string line, string ipAddress, int port)
        {
            string normalized = line == null ? string.Empty : line.ToLowerInvariant();
            string portSuffix = ":" + port.ToString();
            if (!normalized.Contains(portSuffix)) return false;
            string address = (ipAddress ?? string.Empty).Trim().ToLowerInvariant();
            if (TextUtility.IsBlank(address) || address == "*")
                return normalized.Contains("0.0.0.0" + portSuffix)
                    || normalized.Contains("[::]" + portSuffix)
                    || normalized.Contains("::" + portSuffix)
                    || normalized.Contains("*" + portSuffix);
            return normalized.Contains(address + portSuffix);
        }

        private static Dictionary<string, string> HttpSysBinding(string thumbprint, string storeName)
        {
            return new Dictionary<string, string>
            {
                { "CertificateThumbprint", thumbprint },
                { "CertificateStoreName", TextUtility.IsBlank(storeName) ? "My" : storeName }
            };
        }

        private static string ValueAfterColon(string value)
        {
            int separator = value.IndexOf(':');
            return separator < 0 ? string.Empty : value.Substring(separator + 1);
        }

        private static bool ContainsAny(string value, params string[] candidates)
        {
            string normalized = value.ToLowerInvariant();
            foreach (string candidate in candidates)
                if (normalized.Contains(candidate.ToLowerInvariant())) return true;
            return false;
        }

        internal static string NormalizeCertificateThumbprint(object value)
        {
            if (value == null) return string.Empty;
            byte[] bytes = value as byte[];
            if (bytes != null) return BitConverter.ToString(bytes).Replace("-", string.Empty).ToUpperInvariant();

            Array array = value as Array;
            if (array != null && array.Rank == 1)
            {
                StringBuilder hex = new StringBuilder(array.Length * 2);
                for (int index = 0; index < array.Length; index++)
                {
                    object item = array.GetValue(index);
                    int number;
                    try { number = Convert.ToInt32(item); }
                    catch { return string.Empty; }
                    if (number < 0 || number > 255) return string.Empty;
                    hex.Append(number.ToString("X2"));
                }
                return hex.ToString();
            }

            string text = Convert.ToString(value);
            if (TextUtility.IsBlank(text)) return string.Empty;
            StringBuilder normalized = new StringBuilder(text.Length);
            foreach (char current in text)
            {
                if (current == ':' || current == '-' || char.IsWhiteSpace(current)) continue;
                if (!IsHexDigit(current)) return string.Empty;
                normalized.Append(char.ToUpperInvariant(current));
            }
            return normalized.ToString();
        }

        private static bool IsHexDigit(char value)
        {
            return (value >= '0' && value <= '9')
                || (value >= 'a' && value <= 'f')
                || (value >= 'A' && value <= 'F');
        }

        private static Dictionary<string, object> ReadCertificate(string storeName, string thumbprint)
        {
            if (TextUtility.IsBlank(thumbprint)) return null;
            string resolvedStoreName = TextUtility.IsBlank(storeName) ? "My" : storeName;
            X509Store store = new X509Store(resolvedStoreName, StoreLocation.LocalMachine);
            try
            {
                store.Open(OpenFlags.ReadOnly);
                X509Certificate2Collection matches = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false);
                if (matches.Count == 0) return null;
                X509Certificate2 certificate = matches[0];
                return new Dictionary<string, object>
                {
                    { "Thumbprint", certificate.Thumbprint },
                    { "FingerprintSHA256", ComputeSha256(certificate.RawData) },
                    { "StoreName", resolvedStoreName },
                    { "Subject", certificate.Subject },
                    { "Issuer", certificate.Issuer },
                    { "NotBefore", certificate.NotBefore.ToUniversalTime().ToString("o") },
                    { "NotAfter", certificate.NotAfter.ToUniversalTime().ToString("o") }
                };
            }
            catch
            {
                // 证书详情读取失败不能影响 Binding 指纹上报，调用方仍会保留 CertificateThumbprint。
                return null;
            }
            finally
            {
                store.Close();
            }
        }

        private static string ComputeSha256(byte[] value)
        {
            using (SHA256 sha256 = SHA256.Create()) return BitConverter.ToString(sha256.ComputeHash(value)).Replace("-", string.Empty).ToLowerInvariant();
        }

        private static int ReadSslFlags(object binding)
        {
            MethodInfo method = binding.GetType().GetMethod("GetAttributeValue", BindingFlags.Instance | BindingFlags.Public);
            if (method == null) return 0;
            try { return Convert.ToInt32(method.Invoke(binding, new object[] { "sslFlags" })); }
            catch { return 0; }
        }

        internal static IDisposable CreateServerManager()
        {
            Assembly assembly = LoadAdministrationAssembly();
            Type type = assembly.GetType("Microsoft.Web.Administration.ServerManager", true);
            return (IDisposable)Activator.CreateInstance(type);
        }

        internal static Assembly LoadAdministrationAssembly()
        {
            string assemblyPath = ResolveAdministrationAssemblyPath();
            return !TextUtility.IsBlank(assemblyPath) && File.Exists(assemblyPath)
                ? Assembly.LoadFrom(assemblyPath)
                : Assembly.Load("Microsoft.Web.Administration");
        }

        internal static string ResolveAdministrationAssemblyPath()
        {
            string windir = Environment.GetEnvironmentVariable("WINDIR");
            if (TextUtility.IsBlank(windir)) return string.Empty;
            return Path.Combine(Path.Combine(Path.Combine(windir, "System32"), "inetsrv"), "Microsoft.Web.Administration.dll");
        }

        private static object GetIndexerValue(object collection, string key)
        {
            if (collection == null) return null;
            PropertyInfo indexer = collection.GetType().GetProperty("Item", new Type[] { typeof(string) });
            return indexer == null ? null : indexer.GetValue(collection, new object[] { key });
        }

        private static object GetProperty(object target, string propertyName)
        {
            if (target == null) throw new ArgumentNullException("target");
            PropertyInfo property = target.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public);
            if (property == null) throw new MissingMemberException(target.GetType().FullName, propertyName);
            return property.GetValue(target, null);
        }

        private static object GetOptionalProperty(object target, string propertyName)
        {
            if (target == null) return null;
            PropertyInfo property = target.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public);
            return property == null ? null : property.GetValue(target, null);
        }
    }
}
