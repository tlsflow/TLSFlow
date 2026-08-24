using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography.X509Certificates;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class IisCertificateDeploymentHandler
    {
        private readonly string backupDirectory;

        public IisCertificateDeploymentHandler(string dataDirectory)
        {
            backupDirectory = Path.Combine(dataDirectory, "iis-backups");
        }

        public ActionResult Execute(AgentTask task)
        {
            string siteName;
            string bindingInformation;
            string pfxBase64;
            string password;
            if (!TryString(task.payload, "siteName", out siteName) || !TryString(task.payload, "bindingInformation", out bindingInformation) || !TryString(task.payload, "pfxBase64", out pfxBase64))
                return ActionResult.Failed("ACTION_PAYLOAD_INVALID", "IIS 部署缺少 siteName、bindingInformation 或 pfxBase64", null);
            TryString(task.payload, "password", out password);
            Directory.CreateDirectory(backupDirectory);
            string appHostPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "inetsrv", "config", "applicationHost.config");
            if (!File.Exists(appHostPath)) return ActionResult.Failed("IIS_CONFIGURATION_NOT_FOUND", "未找到 IIS applicationHost.config", Detail("path", appHostPath));
            string backupPath = Path.Combine(backupDirectory, "applicationHost." + DateTime.UtcNow.Ticks + ".config");
            File.Copy(appHostPath, backupPath, true);
            X509Certificate2 certificate = null;
            bool imported = false;
            try
            {
                certificate = new X509Certificate2(Convert.FromBase64String(pfxBase64), password ?? string.Empty, X509KeyStorageFlags.MachineKeySet | X509KeyStorageFlags.PersistKeySet | X509KeyStorageFlags.Exportable);
                ImportCertificate(certificate);
                imported = true;
                UpdateBinding(siteName, bindingInformation, certificate.GetCertHash());
                VerifyBinding(siteName, bindingInformation, certificate.GetCertHash());
                Dictionary<string, object> detail = new Dictionary<string, object>();
                detail["mode"] = "iis_install_completed";
                detail["siteName"] = siteName;
                detail["bindingInformation"] = bindingInformation;
                detail["newThumbprint"] = certificate.Thumbprint;
                detail["backupPath"] = backupPath;
                detail["rolledBack"] = false;
                return ActionResult.Succeeded(detail);
            }
            catch (Exception error)
            {
                string rollbackError = null;
                try
                {
                    File.Copy(backupPath, appHostPath, true);
                    if (imported && certificate != null) RemoveCertificate(certificate.Thumbprint);
                }
                catch (Exception rollbackFailure) { rollbackError = rollbackFailure.Message; }
                Dictionary<string, object> detail = new Dictionary<string, object>();
                detail["backupPath"] = backupPath;
                detail["rolledBack"] = rollbackError == null;
                if (rollbackError != null) detail["rollbackError"] = rollbackError;
                return ActionResult.Failed(rollbackError == null ? "IIS_DEPLOYMENT_FAILED" : "IIS_ROLLBACK_FAILED", error.Message, detail);
            }
            finally
            {
                if (certificate != null) certificate.Reset();
            }
        }

        private static void ImportCertificate(X509Certificate2 certificate)
        {
            using (X509Store store = new X509Store(StoreName.My, StoreLocation.LocalMachine))
            {
                store.Open(OpenFlags.ReadWrite);
                store.Add(certificate);
            }
        }

        private static void RemoveCertificate(string thumbprint)
        {
            using (X509Store store = new X509Store(StoreName.My, StoreLocation.LocalMachine))
            {
                store.Open(OpenFlags.ReadWrite);
                X509Certificate2Collection matches = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false);
                foreach (X509Certificate2 match in matches) store.Remove(match);
            }
        }

        private static void UpdateBinding(string siteName, string bindingInformation, byte[] hash)
        {
            using (IDisposable manager = CreateServerManager())
            {
                dynamic serverManager = manager;
                dynamic binding = FindBinding(serverManager, siteName, bindingInformation);
                binding.CertificateHash = hash;
                binding.CertificateStoreName = "My";
                serverManager.CommitChanges();
            }
        }

        private static void VerifyBinding(string siteName, string bindingInformation, byte[] expectedHash)
        {
            using (IDisposable manager = CreateServerManager())
            {
                dynamic binding = FindBinding((dynamic)manager, siteName, bindingInformation);
                byte[] actualHash = (byte[])binding.CertificateHash;
                if (!ByteArraysEqual(actualHash, expectedHash)) throw new InvalidOperationException("IIS Binding 证书指纹验证失败");
            }
        }

        private static IDisposable CreateServerManager()
        {
            Assembly assembly = Assembly.Load("Microsoft.Web.Administration");
            Type type = assembly.GetType("Microsoft.Web.Administration.ServerManager", true);
            return (IDisposable)Activator.CreateInstance(type);
        }

        private static dynamic FindBinding(dynamic serverManager, string siteName, string bindingInformation)
        {
            dynamic site = serverManager.Sites[siteName];
            if (site == null) throw new InvalidOperationException("IIS 站点不存在：" + siteName);
            foreach (dynamic binding in site.Bindings)
            {
                if (string.Equals(Convert.ToString(binding.Protocol), "https", StringComparison.OrdinalIgnoreCase)
                    && string.Equals(Convert.ToString(binding.BindingInformation), bindingInformation, StringComparison.OrdinalIgnoreCase)) return binding;
            }
            throw new InvalidOperationException("IIS HTTPS Binding 不存在：" + bindingInformation);
        }

        private static bool ByteArraysEqual(byte[] left, byte[] right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            for (int index = 0; index < left.Length; index++) if (left[index] != right[index]) return false;
            return true;
        }

        private static bool TryString(Dictionary<string, object> payload, string key, out string value)
        {
            value = null;
            object raw;
            if (payload == null || !payload.TryGetValue(key, out raw) || raw == null) return false;
            value = Convert.ToString(raw);
            return !string.IsNullOrWhiteSpace(value);
        }

        private static Dictionary<string, object> Detail(string key, object value)
        {
            return new Dictionary<string, object> { { key, value } };
        }
    }
}
