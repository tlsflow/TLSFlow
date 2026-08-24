using System;
using System.Collections.Generic;
using System.IO;
using System.Collections;
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
            string windowsDirectory = Environment.GetEnvironmentVariable("WINDIR");
            string appHostPath = Path.Combine(Path.Combine(Path.Combine(Path.Combine(windowsDirectory, "System32"), "inetsrv"), "config"), "applicationHost.config");
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
            X509Store store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
            try
            {
                store.Open(OpenFlags.ReadWrite);
                store.Add(certificate);
            }
            finally { store.Close(); }
        }

        private static void RemoveCertificate(string thumbprint)
        {
            X509Store store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
            try
            {
                store.Open(OpenFlags.ReadWrite);
                X509Certificate2Collection matches = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false);
                foreach (X509Certificate2 match in matches) store.Remove(match);
            }
            finally { store.Close(); }
        }

        private static void UpdateBinding(string siteName, string bindingInformation, byte[] hash)
        {
            using (IDisposable manager = CreateServerManager())
            {
                object binding = FindBinding(manager, siteName, bindingInformation);
                SetProperty(binding, "CertificateHash", hash);
                SetProperty(binding, "CertificateStoreName", "My");
                InvokeMethod(manager, "CommitChanges");
            }
        }

        private static void VerifyBinding(string siteName, string bindingInformation, byte[] expectedHash)
        {
            using (IDisposable manager = CreateServerManager())
            {
                object binding = FindBinding(manager, siteName, bindingInformation);
                byte[] actualHash = (byte[])GetProperty(binding, "CertificateHash");
                if (!ByteArraysEqual(actualHash, expectedHash)) throw new InvalidOperationException("IIS Binding 证书指纹验证失败");
            }
        }

        private static IDisposable CreateServerManager()
        {
            Assembly assembly = Assembly.Load("Microsoft.Web.Administration");
            Type type = assembly.GetType("Microsoft.Web.Administration.ServerManager", true);
            return (IDisposable)Activator.CreateInstance(type);
        }

        private static object FindBinding(object serverManager, string siteName, string bindingInformation)
        {
            object sites = GetProperty(serverManager, "Sites");
            PropertyInfo indexer = sites.GetType().GetProperty("Item", new Type[] { typeof(string) });
            if (indexer == null) throw new InvalidOperationException("IIS Sites 集合不支持按名称查找");
            object site = indexer.GetValue(sites, new object[] { siteName });
            if (site == null) throw new InvalidOperationException("IIS 站点不存在：" + siteName);
            IEnumerable bindings = GetProperty(site, "Bindings") as IEnumerable;
            if (bindings == null) throw new InvalidOperationException("IIS Binding 集合不可用");
            foreach (object binding in bindings)
            {
                if (string.Equals(Convert.ToString(GetProperty(binding, "Protocol")), "https", StringComparison.OrdinalIgnoreCase)
                    && string.Equals(Convert.ToString(GetProperty(binding, "BindingInformation")), bindingInformation, StringComparison.OrdinalIgnoreCase)) return binding;
            }
            throw new InvalidOperationException("IIS HTTPS Binding 不存在：" + bindingInformation);
        }

        private static object GetProperty(object target, string propertyName)
        {
            PropertyInfo property = target.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public);
            if (property == null) throw new MissingMemberException(target.GetType().FullName, propertyName);
            return property.GetValue(target, null);
        }

        private static void SetProperty(object target, string propertyName, object value)
        {
            PropertyInfo property = target.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public);
            if (property == null) throw new MissingMemberException(target.GetType().FullName, propertyName);
            property.SetValue(target, value, null);
        }

        private static object InvokeMethod(object target, string methodName)
        {
            MethodInfo method = target.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public, null, Type.EmptyTypes, null);
            if (method == null) throw new MissingMethodException(target.GetType().FullName, methodName);
            return method.Invoke(target, null);
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
            return !string.IsNullOrEmpty(value) && value.Trim().Length > 0;
        }

        private static Dictionary<string, object> Detail(string key, object value)
        {
            return new Dictionary<string, object> { { key, value } };
        }
    }
}
