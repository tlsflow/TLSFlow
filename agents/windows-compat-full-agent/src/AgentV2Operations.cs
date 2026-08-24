using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;

namespace GCAC.WindowsCompatibilityAgent
{
    /// <summary>
    /// Agent Core 只实现跨产品的事实和固定原语。这里没有产品识别、配置解析或脚本执行。
    /// </summary>
    internal static class AgentV2Operations
    {
        internal static Dictionary<string, object> CollectFacts(AgentTask task, AgentV2Authorization authorization)
        {
            List<Dictionary<string, object>> facts = new List<Dictionary<string, object>>();
            string executable = string.Empty;
            try { executable = Process.GetCurrentProcess().MainModule.FileName; } catch { }
            facts.Add(new Dictionary<string, object> { { "kind", "process" }, { "pid", Process.GetCurrentProcess().Id }, { "executablePath", string.IsNullOrEmpty(executable) ? "C:\\Windows\\System32\\svchost.exe" : executable } });
            WindowsIdentity identity = WindowsIdentity.GetCurrent();
            facts.Add(new Dictionary<string, object> { { "kind", "privilege" }, { "principal", identity == null ? "unknown" : identity.Name }, { "elevated", IsAdministrator() }, { "groups", new string[0] } });
            string[] paths = ReadRequestedPaths(task == null ? null : task.payload);
            for (int index = 0; index < paths.Length; index++)
            {
                if (!AgentV2Security.IsPathWithin(paths[index], authorization.Token.allowedPaths) || !AgentV2Security.IsPathWithin(paths[index], authorization.Decision.allowedPaths)) throw new AgentV2SecurityException("AGENT_V2_AUTHORIZATION_DENIED", "事实路径超出授权范围");
                facts.Add(FileStat(paths[index]));
            }
            Dictionary<string, object> envelope = new Dictionary<string, object>
            {
                { "contractVersion", AgentV2Security.Version }, { "factId", task == null || TextUtility.IsBlank(task.id) ? Guid.NewGuid().ToString("N") : task.id }, { "agentId", authorization.Token.agentId }, { "tenantId", authorization.Token.tenantId },
                { "collectedAt", DateTime.UtcNow.ToString("o") }, { "ttlSeconds", 300 }, { "source", "compatibility" }, { "facts", facts }, { "warnings", new string[0] }
            };
            envelope["digest"] = AgentV2Security.Sha256(AgentV2Security.CanonicalJson(AgentV2Security.RemoveFields(envelope, new string[] { "digest" })));
            return envelope;
        }

        internal static List<Dictionary<string, object>> ExecutePlan(AgentV2Authorization authorization)
        {
            List<Dictionary<string, object>> results = new List<Dictionary<string, object>>();
            for (int index = 0; index < authorization.Plan.operations.Count; index++)
            {
                AgentPlanOperationV1 operation = authorization.Plan.operations[index]; Stopwatch timer = Stopwatch.StartNew();
                Dictionary<string, object> result = ExecuteOperation(operation, authorization); timer.Stop();
                result["operationId"] = operation.operationId; result["operationType"] = operation.operationType; result["elapsedMilliseconds"] = timer.ElapsedMilliseconds; results.Add(result);
            }
            return results;
        }

        private static Dictionary<string, object> ExecuteOperation(AgentPlanOperationV1 operation, AgentV2Authorization authorization)
        {
            if (operation.operationType == "process.list") return new Dictionary<string, object> { { "status", "SUCCEEDED" }, { "facts", new List<Dictionary<string, object>> { ProcessFact() } } };
            if (operation.operationType == "service.list") return ListServices(operation.input);
            if (operation.operationType == "service.status") return ServiceStatus(ReadString(operation.input, "serviceName"));
            if (operation.operationType == "filesystem.stat") return new Dictionary<string, object> { { "status", "SUCCEEDED" }, { "fact", FileStat(ReadString(operation.input, "path")) } };
            if (operation.operationType == "filesystem.read") return ReadFile(ReadString(operation.input, "path"));
            if (operation.operationType == "filesystem.atomic_replace") { AtomicReplace(operation.input); return new Dictionary<string, object> { { "status", "SUCCEEDED" } }; }
            if (operation.operationType == "filesystem.backup") { CopyFile(ReadString(operation.input, "sourcePath"), ReadString(operation.input, "backupPath")); return new Dictionary<string, object> { { "status", "SUCCEEDED" } }; }
            if (operation.operationType == "filesystem.restore") { CopyFile(ReadString(operation.input, "restorePath"), ReadString(operation.input, "path")); return new Dictionary<string, object> { { "status", "SUCCEEDED" } }; }
            if (operation.operationType == "service.start" || operation.operationType == "service.stop" || operation.operationType == "service.reload") { ChangeService(ReadString(operation.input, "serviceName"), operation.operationType); return new Dictionary<string, object> { { "status", "SUCCEEDED" } }; }
            if (operation.operationType == "certificate.material.validate") return ValidateCertificate(operation.input);
            if (operation.operationType == "certificate.store.inspect") return InspectCertificateStore(operation.input);
            if (operation.operationType == "command.execute_allowlisted") throw new InvalidOperationException("Compatibility Agent 不执行命令进程；请使用固定服务原语");
            throw new InvalidOperationException("Agent 原语未实现");
        }

        private static Dictionary<string, object> ProcessFact()
        {
            string path = string.Empty; try { path = Process.GetCurrentProcess().MainModule.FileName; } catch { }
            return new Dictionary<string, object> { { "kind", "process" }, { "pid", Process.GetCurrentProcess().Id }, { "executablePath", path } };
        }

        private static Dictionary<string, object> FileStat(string path)
        {
            if (!AgentV2Security.IsAbsoluteWindowsPath(path)) throw new InvalidOperationException("文件路径必须是绝对路径");
            FileInfo file = new FileInfo(path); Dictionary<string, object> result = new Dictionary<string, object> { { "kind", "file_stat" }, { "path", AgentV2Security.NormalizePath(path) }, { "exists", file.Exists }, { "sizeBytes", file.Exists ? file.Length : 0L } };
            if (file.Exists) result["modifiedAt"] = file.LastWriteTimeUtc.ToString("o");
            return result;
        }

        private static Dictionary<string, object> ReadFile(string path)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("文件不存在", path);
            byte[] content; using (FileStream stream = File.OpenRead(path)) { int length = (int)Math.Min(AgentV2Security.MaximumFileContentBytes, stream.Length); content = new byte[length]; stream.Read(content, 0, length); }
            using (SHA256 sha = SHA256.Create()) return new Dictionary<string, object> { { "status", "SUCCEEDED" }, { "fact", new Dictionary<string, object> { { "kind", "file_content" }, { "path", AgentV2Security.NormalizePath(path) }, { "contentBase64", Convert.ToBase64String(content) }, { "bytesRead", content.Length }, { "truncated", new FileInfo(path).Length > content.Length }, { "sha256", Hex(sha.ComputeHash(content)) } } } };
        }

        private static void AtomicReplace(Dictionary<string, object> input)
        {
            string path = ReadString(input, "path"); string content = ReadString(input, "contentBase64"); byte[] bytes;
            try { bytes = Convert.FromBase64String(content); } catch { throw new InvalidOperationException("atomic_replace 内容必须是 Base64"); }
            if (bytes.Length > AgentV2Security.MaximumFileContentBytes) throw new InvalidOperationException("atomic_replace 内容超出上限");
            string temporary = path + ".gcac-" + Guid.NewGuid().ToString("N") + ".tmp"; File.WriteAllBytes(temporary, bytes);
            try { if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path); } finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private static void CopyFile(string source, string destination) { if (!File.Exists(source)) throw new FileNotFoundException("源文件不存在", source); File.Copy(source, destination, true); }
        private static Dictionary<string, object> ServiceStatus(string name) { using (ServiceController service = new ServiceController(name)) { service.Refresh(); return new Dictionary<string, object> { { "status", "SUCCEEDED" }, { "service", new Dictionary<string, object> { { "kind", "service" }, { "name", name }, { "status", service.Status.ToString().ToLowerInvariant() } } } }; } }

        private static Dictionary<string, object> ListServices(Dictionary<string, object> input)
        {
            string[] names = ReadStrings(input, "serviceNames"); List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
            for (int index = 0; index < names.Length && index < 100; index++) result.Add((Dictionary<string, object>)ServiceStatus(names[index])["service"]);
            return new Dictionary<string, object> { { "status", "SUCCEEDED" }, { "facts", result } };
        }

        private static void ChangeService(string name, string operation)
        {
            using (ServiceController service = new ServiceController(name))
            {
                if (operation == "service.start") service.Start(); else if (operation == "service.stop") service.Stop(); else { service.Stop(); service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30)); service.Start(); }
                service.WaitForStatus(operation == "service.stop" ? ServiceControllerStatus.Stopped : ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
            }
        }

        private static Dictionary<string, object> ValidateCertificate(Dictionary<string, object> input)
        {
            byte[] value; try { value = Convert.FromBase64String(ReadString(input, "certificateBase64")); } catch { throw new InvalidOperationException("证书材料必须是 Base64"); }
            X509Certificate2 certificate = new X509Certificate2(value);
            return new Dictionary<string, object> { { "status", "SUCCEEDED" }, { "subject", certificate.Subject }, { "thumbprint", certificate.Thumbprint }, { "notAfter", certificate.NotAfter.ToUniversalTime().ToString("o") }, { "hasPrivateKey", certificate.HasPrivateKey } };
        }

        private static Dictionary<string, object> InspectCertificateStore(Dictionary<string, object> input)
        {
            string storeName = ReadString(input, "store"); if (storeName != "My") throw new InvalidOperationException("只允许通用 My 证书存储");
            X509Store store = new X509Store(StoreName.My, StoreLocation.LocalMachine); List<Dictionary<string, object>> certificates = new List<Dictionary<string, object>>();
            try { store.Open(OpenFlags.ReadOnly); foreach (X509Certificate2 certificate in store.Certificates) { if (certificates.Count >= 100) break; certificates.Add(new Dictionary<string, object> { { "store", storeName }, { "subject", certificate.Subject }, { "thumbprint", certificate.Thumbprint }, { "notAfter", certificate.NotAfter.ToUniversalTime().ToString("o") }, { "hasPrivateKey", certificate.HasPrivateKey } }); } }
            finally { store.Close(); }
            return new Dictionary<string, object> { { "status", "SUCCEEDED" }, { "facts", certificates } };
        }

        private static string[] ReadRequestedPaths(Dictionary<string, object> payload) { object raw; return payload != null && payload.TryGetValue("paths", out raw) ? AgentV2Security.Strings(raw, "paths", true) : new string[0]; }
        private static string[] ReadStrings(Dictionary<string, object> input, string key) { object raw; return input != null && input.TryGetValue(key, out raw) ? AgentV2Security.Strings(raw, key, true) : new string[0]; }
        private static string ReadString(Dictionary<string, object> input, string key) { object raw; if (input == null || !input.TryGetValue(key, out raw) || !(raw is string) || TextUtility.IsBlank((string)raw)) throw new InvalidOperationException(key + " 缺失"); return (string)raw; }
        private static bool IsAdministrator() { WindowsPrincipal principal = new WindowsPrincipal(WindowsIdentity.GetCurrent()); return principal.IsInRole(WindowsBuiltInRole.Administrator); }
        private static string Hex(byte[] bytes) { StringBuilder result = new StringBuilder(bytes.Length * 2); for (int index = 0; index < bytes.Length; index++) result.Append(bytes[index].ToString("x2")); return result.ToString(); }
    }
}
