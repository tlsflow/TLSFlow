using Microsoft.Win32;
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

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
            byte[] certificateHash = GetOptionalProperty(binding, "CertificateHash") as byte[];
            string thumbprint = certificateHash == null ? string.Empty : BitConverter.ToString(certificateHash).Replace("-", string.Empty);
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
                { "SslFlags", ReadSslFlags(binding) },
                { "Certificate", certificate }
            };
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

        private static IDisposable CreateServerManager()
        {
            string assemblyPath = Path.Combine(Path.Combine(Path.Combine(Environment.GetEnvironmentVariable("WINDIR"), "System32"), "inetsrv"), "Microsoft.Web.Administration.dll");
            Assembly assembly = File.Exists(assemblyPath) ? Assembly.LoadFrom(assemblyPath) : Assembly.Load("Microsoft.Web.Administration");
            Type type = assembly.GetType("Microsoft.Web.Administration.ServerManager", true);
            return (IDisposable)Activator.CreateInstance(type);
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
