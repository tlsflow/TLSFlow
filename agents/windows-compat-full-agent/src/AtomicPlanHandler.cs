using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class AtomicPlanHandler
    {
        private readonly Func<string> currentAgentId;
        private readonly Dictionary<string, ActionResult> completed = new Dictionary<string, ActionResult>(StringComparer.Ordinal);

        public AtomicPlanHandler(Func<string> currentAgentIdProvider)
        {
            currentAgentId = currentAgentIdProvider;
        }

        public ActionResult Execute(AgentTask task)
        {
            string requestedSchema = AtomicValue.String(task == null ? null : task.payload, "actionSchemaVersion");
            if (!TextUtility.IsBlank(requestedSchema) && requestedSchema != "1.0")
                return ActionResult.Failed("AGENT_ACTION_SCHEMA_UNSUPPORTED", "Agent Action Schema 版本不受支持", new Dictionary<string, object> { { "actionSchemaVersion", requestedSchema } });
            Dictionary<string, object> plan;
            if (!AtomicValue.TryDictionary(task == null ? null : task.payload, "plan", out plan)) plan = task == null ? null : task.payload;
            if (plan == null || AtomicValue.String(plan, "apiVersion") != "gcac.agent-plan/v1" || TextUtility.IsBlank(AtomicValue.String(plan, "planId")) || TextUtility.IsBlank(AtomicValue.String(plan, "idempotencyKey")))
                return ActionResult.Failed("AGENT_ATOMIC_OPERATION_FAILED", "原子执行计划无效", null);
            string signatureError;
            if (!AtomicPlanSecurity.Verify(plan, out signatureError))
                return ActionResult.Failed("AGENT_PLAN_SIGNATURE_INVALID", signatureError, null);
            string targetAgentId = AtomicValue.String(plan, "agentId");
            if (!TextUtility.IsBlank(targetAgentId) && !string.Equals(targetAgentId, currentAgentId(), StringComparison.Ordinal))
                return ActionResult.Failed("AGENT_PLAN_SIGNATURE_INVALID", "执行计划目标 Agent 不匹配", null);
            DateTime expiresAt;
            if (!DateTime.TryParse(AtomicValue.String(plan, "expiresAt"), out expiresAt) || DateTime.UtcNow > expiresAt.ToUniversalTime())
                return ActionResult.Failed("AGENT_PLAN_EXPIRED", "执行计划已过期", null);

            string idempotencyKey = AtomicValue.String(plan, "idempotencyKey");
            ActionResult existing;
            if (completed.TryGetValue(idempotencyKey, out existing)) return existing;

            List<Dictionary<string, object>> operations = AtomicValue.DictionaryList(plan, "operations");
            if (operations.Count == 0) return ActionResult.Failed("AGENT_ATOMIC_OPERATION_FAILED", "原子执行计划没有 Operation", null);
            AtomicExecutionContext context = new AtomicExecutionContext(AtomicValue.PermissionMap(plan));
            bool preview = string.Equals(AtomicValue.String(plan, "executionMode"), "PREFLIGHT", StringComparison.OrdinalIgnoreCase);
            List<Dictionary<string, object>> results = new List<Dictionary<string, object>>();
            Dictionary<string, object> failure = null;
            foreach (Dictionary<string, object> operation in operations)
            {
                Dictionary<string, object> result = AtomicOperationExecutor.Execute(operation, context, preview);
                results.Add(result);
                if (!string.Equals(Convert.ToString(result["status"]), "SUCCEEDED", StringComparison.Ordinal)) { failure = result; break; }
                context.CompletedOperations.Add(AtomicValue.String(operation, "id"));
            }

            List<Dictionary<string, object>> rollbackResults = new List<Dictionary<string, object>>();
            bool rollbackFailed = false;
            if (failure != null && !preview)
            {
                List<Dictionary<string, object>> rollback = AtomicValue.DictionaryList(plan, "rollback");
                for (int index = rollback.Count - 1; index >= 0; index--)
                {
                    Dictionary<string, object> result = AtomicOperationExecutor.Execute(rollback[index], context, false);
                    rollbackResults.Add(result);
                    if (!string.Equals(Convert.ToString(result["status"]), "SUCCEEDED", StringComparison.Ordinal)) rollbackFailed = true;
                }
            }

            Dictionary<string, object> detail = new Dictionary<string, object>();
            detail["planId"] = AtomicValue.String(plan, "planId");
            detail["executionMode"] = preview ? "PREFLIGHT" : "EXECUTE";
            detail["operationResults"] = results;
            detail["rollbackResults"] = rollbackResults;
            detail["state"] = failure == null ? "SUCCEEDED" : (rollbackFailed ? "MANUAL_INTERVENTION" : (preview ? "FAILED" : "ROLLED_BACK"));
            ActionResult finalResult = failure == null
                ? ActionResult.Succeeded(detail)
                : ActionResult.Failed(rollbackFailed ? "AGENT_ROLLBACK_FAILED" : (preview ? "AGENT_ATOMIC_PREFLIGHT_FAILED" : "AGENT_ATOMIC_OPERATION_FAILED"), Convert.ToString(failure["errorMessage"]), detail);
            completed[idempotencyKey] = finalResult;
            return finalResult;
        }
    }

    internal sealed class AtomicExecutionContext
    {
        public readonly Dictionary<string, List<string>> Permissions;
        public readonly Dictionary<string, AtomicBindingSnapshot> BindingBackups = new Dictionary<string, AtomicBindingSnapshot>(StringComparer.Ordinal);
        public readonly List<string> CompletedOperations = new List<string>();

        public AtomicExecutionContext(Dictionary<string, List<string>> permissions) { Permissions = permissions; }
    }

    internal sealed class AtomicBindingSnapshot
    {
        public string SiteName;
        public string BindingInformation;
        public byte[] CertificateHash;
        public string CertificateStoreName;
    }

    internal static class AtomicOperationExecutor
    {
        public static Dictionary<string, object> Execute(Dictionary<string, object> operation, AtomicExecutionContext context, bool preview)
        {
            string id = AtomicValue.String(operation, "id");
            string operationType = AtomicValue.String(operation, "operationType");
            string stage = AtomicValue.String(operation, "stage");
            DateTime startedAt = DateTime.UtcNow;
            Dictionary<string, object> detail = null;
            string error = null;
            try
            {
                if (TextUtility.IsBlank(id) || AtomicValue.String(operation, "schemaVersion") != "1.0") throw new InvalidOperationException("Operation 标识或 Schema Version 无效");
                string dependency = AtomicValue.String(AtomicValue.Dictionary(operation, "input"), "whenOperationCompleted");
                if (!TextUtility.IsBlank(dependency) && !context.CompletedOperations.Contains(dependency))
                    detail = new Dictionary<string, object> { { "skipped", true }, { "reason", "required operation was not completed" }, { "requiredOperationId", dependency } };
                else detail = Dispatch(operationType, AtomicValue.Dictionary(operation, "input"), id, context, preview);
            }
            catch (Exception failure) { error = failure.Message; }
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["operationId"] = id;
            result["operationType"] = operationType;
            result["stage"] = stage;
            result["status"] = error == null ? "SUCCEEDED" : "FAILED";
            result["startedAt"] = startedAt.ToString("o");
            result["finishedAt"] = DateTime.UtcNow.ToString("o");
            result["detail"] = detail ?? new Dictionary<string, object>();
            if (error != null) { result["errorCode"] = preview ? "AGENT_ATOMIC_PREFLIGHT_FAILED" : "AGENT_ATOMIC_OPERATION_FAILED"; result["errorMessage"] = error; }
            return result;
        }

        private static Dictionary<string, object> Dispatch(string operationType, Dictionary<string, object> input, string operationId, AtomicExecutionContext context, bool preview)
        {
            if (operationType == "preflight.assert") return Assert(input);
            if (operationType == "windows.certificate.inspect_pfx") return InspectPfx(input, context);
            if (operationType == "windows.certificate_store.import_pfx") return ImportPfx(input, context, preview);
            if (operationType == "windows.certificate_private_key.grant") return GrantPrivateKey(input, context, preview);
            if (operationType == "windows.iis.binding.capture") return CaptureBinding(input, operationId, context);
            if (operationType == "windows.iis.binding.update_certificate") return UpdateBinding(input, context, preview);
            if (operationType == "windows.iis.binding.restore_certificate") return RestoreBinding(input, context, preview);
            throw new InvalidOperationException("unsupported atomic operation: " + operationType);
        }

        private static Dictionary<string, object> Assert(Dictionary<string, object> input)
        {
            object raw;
            if (!input.TryGetValue("value", out raw) || !(raw is bool) || !(bool)raw) throw new InvalidOperationException(AtomicValue.String(input, "message") ?? "preflight assertion failed");
            return new Dictionary<string, object> { { "passed", true } };
        }

        private static Dictionary<string, object> InspectPfx(Dictionary<string, object> input, AtomicExecutionContext context)
        {
            AtomicCertificateMaterial material = AtomicCertificateMaterial.Read(input);
            AtomicPermissions.Require("LocalMachine/My", context.Permissions, "certificate_store");
            X509Certificate2 certificate = material.Open(false);
            try
            {
                return AtomicCertificateMaterial.Detail(certificate, material.Bytes.Length);
            }
            finally { certificate.Reset(); }
        }

        private static Dictionary<string, object> ImportPfx(Dictionary<string, object> input, AtomicExecutionContext context, bool preview)
        {
            AtomicCertificateMaterial material = AtomicCertificateMaterial.Read(input);
            AtomicPermissions.Require("LocalMachine/My", context.Permissions, "certificate_store");
            X509Certificate2 certificate = material.Open(!preview);
            try
            {
                bool existed = CertificateStoreContains(certificate.Thumbprint);
                if (!preview && !existed)
                {
                    X509Store store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
                    try { store.Open(OpenFlags.ReadWrite); store.Add(certificate); }
                    finally { store.Close(); }
                }
                Dictionary<string, object> detail = AtomicCertificateMaterial.Detail(certificate, material.Bytes.Length);
                detail["alreadyPresent"] = existed;
                detail["store"] = "LocalMachine/My";
                detail["preview"] = preview;
                return detail;
            }
            finally { certificate.Reset(); }
        }

        private static Dictionary<string, object> GrantPrivateKey(Dictionary<string, object> input, AtomicExecutionContext context, bool preview)
        {
            string appPoolName = AtomicValue.String(input, "appPoolName");
            if (TextUtility.IsBlank(appPoolName)) return new Dictionary<string, object> { { "skipped", true }, { "reason", "appPoolName is empty" } };
            AtomicPermissions.Require(appPoolName, context.Permissions, "iis");
            AtomicCertificateMaterial material = AtomicCertificateMaterial.Read(input);
            X509Certificate2 inspected = material.Open(false);
            try
            {
                if (!preview)
                {
                    X509Certificate2 stored = FindStoredCertificate(inspected.Thumbprint);
                    if (stored == null) throw new InvalidOperationException("证书尚未导入 LocalMachine/My");
                    try { GrantPrivateKeyRead(stored, appPoolName); }
                    finally { stored.Reset(); }
                }
                return new Dictionary<string, object> { { "thumbprint", inspected.Thumbprint }, { "account", "IIS AppPool\\" + appPoolName }, { "preview", preview } };
            }
            finally { inspected.Reset(); }
        }

        private static Dictionary<string, object> CaptureBinding(Dictionary<string, object> input, string operationId, AtomicExecutionContext context)
        {
            string siteName = AtomicValue.String(input, "siteName");
            AtomicPermissions.Require(siteName, context.Permissions, "iis");
            string bindingInformation = AtomicValue.BindingInformation(input);
            AtomicBindingSnapshot snapshot = IisAtomicBinding.Capture(siteName, bindingInformation);
            context.BindingBackups[operationId] = snapshot;
            return new Dictionary<string, object> { { "siteName", siteName }, { "bindingInformation", bindingInformation }, { "certificateThumbprint", AtomicValue.Hex(snapshot.CertificateHash) } };
        }

        private static Dictionary<string, object> UpdateBinding(Dictionary<string, object> input, AtomicExecutionContext context, bool preview)
        {
            string siteName = AtomicValue.String(input, "siteName");
            AtomicPermissions.Require(siteName, context.Permissions, "iis");
            string bindingInformation = AtomicValue.BindingInformation(input);
            AtomicCertificateMaterial material = AtomicCertificateMaterial.Read(input);
            X509Certificate2 certificate = material.Open(false);
            try
            {
                IisAtomicBinding.Capture(siteName, bindingInformation);
                if (!preview)
                {
                    byte[] expectedHash = certificate.GetCertHash();
                    IisAtomicBinding.Update(siteName, bindingInformation, expectedHash, "My");
                    AtomicBindingSnapshot applied = IisAtomicBinding.Capture(siteName, bindingInformation);
                    if (!AtomicValue.BytesEqual(applied.CertificateHash, expectedHash)) throw new InvalidOperationException("IIS Binding 证书指纹验证失败");
                }
                return new Dictionary<string, object> { { "siteName", siteName }, { "bindingInformation", bindingInformation }, { "thumbprint", certificate.Thumbprint }, { "preview", preview } };
            }
            finally { certificate.Reset(); }
        }

        private static Dictionary<string, object> RestoreBinding(Dictionary<string, object> input, AtomicExecutionContext context, bool preview)
        {
            string siteName = AtomicValue.String(input, "siteName");
            AtomicPermissions.Require(siteName, context.Permissions, "iis");
            string reference = AtomicValue.String(input, "captureOperationId");
            AtomicBindingSnapshot snapshot;
            if (!context.BindingBackups.TryGetValue(reference, out snapshot)) throw new InvalidOperationException("IIS binding backup not found: " + reference);
            if (!string.Equals(snapshot.SiteName, siteName, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("IIS binding backup site mismatch");
            if (!preview) IisAtomicBinding.Update(snapshot.SiteName, snapshot.BindingInformation, snapshot.CertificateHash, snapshot.CertificateStoreName);
            return new Dictionary<string, object> { { "siteName", siteName }, { "bindingInformation", snapshot.BindingInformation }, { "thumbprint", AtomicValue.Hex(snapshot.CertificateHash) }, { "preview", preview } };
        }

        private static bool CertificateStoreContains(string thumbprint) { X509Certificate2 certificate = FindStoredCertificate(thumbprint); if (certificate == null) return false; certificate.Reset(); return true; }
        private static X509Certificate2 FindStoredCertificate(string thumbprint)
        {
            X509Store store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
            try { store.Open(OpenFlags.ReadOnly); X509Certificate2Collection matches = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false); return matches.Count == 0 ? null : new X509Certificate2(matches[0]); }
            finally { store.Close(); }
        }
        private static void GrantPrivateKeyRead(X509Certificate2 certificate, string appPoolName)
        {
            RSACryptoServiceProvider rsa = certificate.PrivateKey as RSACryptoServiceProvider;
            if (rsa == null) throw new InvalidOperationException("证书私钥不是旧 Windows 支持的 RSA CSP 密钥");
            string keyName = rsa.CspKeyContainerInfo.UniqueKeyContainerName;
            string path = Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Microsoft\\Crypto\\RSA\\MachineKeys"), keyName);
            FileInfo file = new FileInfo(path);
            FileSecurity security = file.GetAccessControl();
            security.AddAccessRule(new FileSystemAccessRule(new NTAccount("IIS AppPool\\" + appPoolName), FileSystemRights.Read, AccessControlType.Allow));
            file.SetAccessControl(security);
        }
    }

    internal sealed class AtomicCertificateMaterial
    {
        public byte[] Bytes;
        public string Password;
        public string ExpectedFingerprint;

        public static AtomicCertificateMaterial Read(Dictionary<string, object> input)
        {
            Dictionary<string, object> artifact = AtomicValue.Dictionary(input, "artifact");
            string encoded = AtomicValue.FirstString(input, artifact, "pfxBase64", "contentBase64");
            string password = AtomicValue.FirstString(input, artifact, "pfxPassword", "password");
            if (TextUtility.IsBlank(encoded)) throw new InvalidOperationException("PFX artifact is required");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(encoded); }
            catch (FormatException error) { throw new InvalidOperationException("PFX Base64 无效", error); }
            return new AtomicCertificateMaterial { Bytes = bytes, Password = password ?? string.Empty, ExpectedFingerprint = AtomicValue.FirstString(input, artifact, "expectedFingerprintSha256", "fingerprintSha256") };
        }

        public X509Certificate2 Open(bool persist)
        {
            X509KeyStorageFlags flags = X509KeyStorageFlags.Exportable;
            if (persist) flags |= X509KeyStorageFlags.MachineKeySet | X509KeyStorageFlags.PersistKeySet;
            X509Certificate2 certificate = new X509Certificate2(Bytes, Password, flags);
            string actual = Fingerprint(certificate.RawData);
            if (!TextUtility.IsBlank(ExpectedFingerprint) && !string.Equals(Normalize(ExpectedFingerprint), actual, StringComparison.OrdinalIgnoreCase)) { certificate.Reset(); throw new InvalidOperationException("PFX certificate fingerprint mismatch"); }
            return certificate;
        }

        public static Dictionary<string, object> Detail(X509Certificate2 certificate, int size) { return new Dictionary<string, object> { { "thumbprint", certificate.Thumbprint }, { "fingerprintSha256", Fingerprint(certificate.RawData) }, { "subject", certificate.Subject }, { "notAfter", certificate.NotAfter.ToUniversalTime().ToString("o") }, { "pfxSize", size } }; }
        private static string Fingerprint(byte[] value) { using (SHA256 sha = SHA256.Create()) return AtomicValue.Hex(sha.ComputeHash(value)).ToLowerInvariant(); }
        private static string Normalize(string value) { return value.Replace(" ", string.Empty).Replace(":", string.Empty).ToLowerInvariant(); }
    }

    internal static class IisAtomicBinding
    {
        public static AtomicBindingSnapshot Capture(string siteName, string bindingInformation)
        {
            using (IDisposable manager = CreateServerManager())
            {
                object binding = FindBinding(manager, siteName, bindingInformation);
                return new AtomicBindingSnapshot { SiteName = siteName, BindingInformation = bindingInformation, CertificateHash = (byte[])GetProperty(binding, "CertificateHash"), CertificateStoreName = Convert.ToString(GetProperty(binding, "CertificateStoreName")) };
            }
        }
        public static void Update(string siteName, string bindingInformation, byte[] hash, string storeName)
        {
            using (IDisposable manager = CreateServerManager()) { object binding = FindBinding(manager, siteName, bindingInformation); SetProperty(binding, "CertificateHash", hash); SetProperty(binding, "CertificateStoreName", TextUtility.IsBlank(storeName) ? "My" : storeName); InvokeMethod(manager, "CommitChanges"); }
        }
        private static IDisposable CreateServerManager() { return IisInspector.CreateServerManager(); }
        private static object FindBinding(object manager, string siteName, string bindingInformation)
        {
            object sites = GetProperty(manager, "Sites"); PropertyInfo indexer = sites.GetType().GetProperty("Item", new Type[] { typeof(string) }); object site = indexer == null ? null : indexer.GetValue(sites, new object[] { siteName });
            if (site == null) throw new InvalidOperationException("IIS 站点不存在：" + siteName);
            IEnumerable bindings = GetProperty(site, "Bindings") as IEnumerable;
            if (bindings != null) foreach (object binding in bindings) if (string.Equals(Convert.ToString(GetProperty(binding, "Protocol")), "https", StringComparison.OrdinalIgnoreCase) && string.Equals(Convert.ToString(GetProperty(binding, "BindingInformation")), bindingInformation, StringComparison.OrdinalIgnoreCase)) return binding;
            throw new InvalidOperationException("IIS HTTPS Binding 不存在：" + bindingInformation);
        }
        private static object GetProperty(object target, string name) { PropertyInfo property = target.GetType().GetProperty(name, BindingFlags.Instance | BindingFlags.Public); if (property == null) throw new MissingMemberException(target.GetType().FullName, name); return property.GetValue(target, null); }
        private static void SetProperty(object target, string name, object value) { PropertyInfo property = target.GetType().GetProperty(name, BindingFlags.Instance | BindingFlags.Public); if (property == null) throw new MissingMemberException(target.GetType().FullName, name); property.SetValue(target, value, null); }
        private static void InvokeMethod(object target, string name) { MethodInfo method = target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.Public, null, Type.EmptyTypes, null); if (method == null) throw new MissingMethodException(target.GetType().FullName, name); method.Invoke(target, null); }
    }

    internal static class AtomicPermissions
    {
        public static void Require(string value, Dictionary<string, List<string>> permissions, string scope)
        {
            List<string> allowed; if (!permissions.TryGetValue(scope, out allowed)) throw new InvalidOperationException("permission scope is not allowed: " + scope);
            foreach (string pattern in allowed) if (pattern == "*" || string.Equals(pattern, value, StringComparison.OrdinalIgnoreCase) || (pattern.EndsWith("*") && value.StartsWith(pattern.Substring(0, pattern.Length - 1), StringComparison.OrdinalIgnoreCase))) return;
            throw new InvalidOperationException("permission value is not allowed: " + value);
        }
    }

    internal static class AtomicPlanSecurity
    {
        public static bool Verify(Dictionary<string, object> plan, out string error)
        {
            error = null; Dictionary<string, object> authorization = AtomicValue.Dictionary(plan, "authorization"); string signature = AtomicValue.String(authorization, "signature");
            if (TextUtility.IsBlank(signature)) { error = "atomic plan signature is required"; return false; }
            string expected = ComputeSignature(plan); byte[] left; byte[] right;
            try { left = AtomicValue.FromHex(signature); right = AtomicValue.FromHex(expected); }
            catch { error = "atomic plan signature is invalid"; return false; }
            if (left.Length != right.Length) { error = "atomic plan signature mismatch"; return false; }
            int difference = 0; for (int index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
            if (difference != 0) { error = "atomic plan signature mismatch"; return false; }
            return true;
        }
        internal static string ComputeSignature(Dictionary<string, object> plan)
        {
            Dictionary<string, object> unsigned = new Dictionary<string, object>(); foreach (KeyValuePair<string, object> item in plan) if (item.Key != "authorization") unsigned[item.Key] = item.Value;
            byte[] key = Encoding.UTF8.GetBytes(TextUtility.IsBlank(Environment.GetEnvironmentVariable("GCAC_AGENT_PLAN_SIGNING_KEY")) ? "gcac-development-agent-plan-key" : Environment.GetEnvironmentVariable("GCAC_AGENT_PLAN_SIGNING_KEY").Trim());
            using (HMACSHA256 hmac = new HMACSHA256(key)) return AtomicValue.Hex(hmac.ComputeHash(Encoding.UTF8.GetBytes(AtomicValue.CanonicalJson(unsigned)))).ToLowerInvariant();
        }
    }

    internal static class AtomicValue
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
        public static string String(Dictionary<string, object> source, string key) { object value; return source != null && source.TryGetValue(key, out value) && value != null ? Convert.ToString(value).Trim() : string.Empty; }
        public static Dictionary<string, object> Dictionary(Dictionary<string, object> source, string key) { Dictionary<string, object> value; return TryDictionary(source, key, out value) ? value : new Dictionary<string, object>(); }
        public static bool TryDictionary(Dictionary<string, object> source, string key, out Dictionary<string, object> value) { value = null; object raw; if (source == null || !source.TryGetValue(key, out raw)) return false; value = raw as Dictionary<string, object>; return value != null; }
        public static List<Dictionary<string, object>> DictionaryList(Dictionary<string, object> source, string key) { List<Dictionary<string, object>> result = new List<Dictionary<string, object>>(); object raw; if (source == null || !source.TryGetValue(key, out raw)) return result; IEnumerable values = raw as IEnumerable; if (values != null) foreach (object item in values) { Dictionary<string, object> value = item as Dictionary<string, object>; if (value != null) result.Add(value); } return result; }
        public static Dictionary<string, List<string>> PermissionMap(Dictionary<string, object> plan) { Dictionary<string, List<string>> result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase); foreach (Dictionary<string, object> permission in DictionaryList(plan, "permissions")) { string scope = String(permission, "scope"); List<string> values; if (!result.TryGetValue(scope, out values)) { values = new List<string>(); result[scope] = values; } object raw; if (permission.TryGetValue("values", out raw) && raw is IEnumerable) foreach (object item in (IEnumerable)raw) values.Add(Convert.ToString(item)); } return result; }
        public static string FirstString(Dictionary<string, object> primary, Dictionary<string, object> secondary, params string[] keys) { foreach (string key in keys) { string value = String(primary, key); if (!TextUtility.IsBlank(value)) return value; value = String(secondary, key); if (!TextUtility.IsBlank(value)) return value; } return string.Empty; }
        public static string BindingInformation(Dictionary<string, object> input) { Dictionary<string, object> selector = Dictionary(input, "bindingSelector"); string value = FirstString(input, selector, "bindingInformation"); if (TextUtility.IsBlank(value)) throw new InvalidOperationException("bindingInformation is required"); return value; }
        public static string Hex(byte[] value) { if (value == null) return string.Empty; StringBuilder output = new StringBuilder(value.Length * 2); foreach (byte current in value) output.Append(current.ToString("x2")); return output.ToString(); }
        public static byte[] FromHex(string value) { string normalized = value.Trim(); if (normalized.Length % 2 != 0) throw new FormatException(); byte[] output = new byte[normalized.Length / 2]; for (int index = 0; index < output.Length; index++) output[index] = Convert.ToByte(normalized.Substring(index * 2, 2), 16); return output; }
        public static bool BytesEqual(byte[] left, byte[] right) { if (left == null || right == null || left.Length != right.Length) return false; for (int index = 0; index < left.Length; index++) if (left[index] != right[index]) return false; return true; }
        public static string CanonicalJson(object value)
        {
            Dictionary<string, object> dictionary = value as Dictionary<string, object>;
            if (dictionary != null) { List<string> keys = new List<string>(dictionary.Keys); keys.Sort(StringComparer.Ordinal); List<string> parts = new List<string>(); foreach (string key in keys) parts.Add(Serializer.Serialize(key) + ":" + CanonicalJson(dictionary[key])); return "{" + string.Join(",", parts.ToArray()) + "}"; }
            if (!(value is string) && !(value is byte[])) { IEnumerable enumerable = value as IEnumerable; if (enumerable != null) { List<string> parts = new List<string>(); foreach (object item in enumerable) parts.Add(CanonicalJson(item)); return "[" + string.Join(",", parts.ToArray()) + "]"; } }
            return Serializer.Serialize(value);
        }
    }
}
