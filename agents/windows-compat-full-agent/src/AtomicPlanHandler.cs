using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class AtomicPlanHandler
    {
        private readonly Func<string> currentAgentId;
        private readonly AtomicPlanLedgerStore ledgerStore;
        private readonly Dictionary<string, ActionResult> completed = new Dictionary<string, ActionResult>(StringComparer.Ordinal);
        private readonly object sync = new object();

        public AtomicPlanHandler(Func<string> currentAgentIdProvider)
            : this(currentAgentIdProvider, null)
        {
        }

        public AtomicPlanHandler(Func<string> currentAgentIdProvider, string dataDirectory)
        {
            currentAgentId = currentAgentIdProvider;
            if (!TextUtility.IsBlank(dataDirectory)) ledgerStore = new AtomicPlanLedgerStore(dataDirectory);
        }

        public ActionResult Execute(AgentTask task)
        {
            lock (sync) return ExecuteCore(task);
        }

        private ActionResult ExecuteCore(AgentTask task)
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
            List<Dictionary<string, object>> operations = AtomicValue.DictionaryList(plan, "operations");
            if (operations.Count == 0) return ActionResult.Failed("AGENT_ATOMIC_OPERATION_FAILED", "原子执行计划没有 Operation", null);
            bool preview = string.Equals(AtomicValue.String(plan, "executionMode"), "PREFLIGHT", StringComparison.OrdinalIgnoreCase);

            string planDigest = AtomicValue.Sha256Hex(AtomicValue.CanonicalJson(plan));
            AtomicPlanLedgerRecord record = ledgerStore == null ? null : ledgerStore.Load(idempotencyKey);
            if (record != null)
            {
                if (!string.Equals(record.PlanDigest, planDigest, StringComparison.OrdinalIgnoreCase))
                    return ActionResult.Failed("AGENT_ATOMIC_OPERATION_FAILED", "相同幂等键对应的执行计划内容不一致", null);
                record.EnsureCollections();
                if (record.State == "SUCCEEDED" || record.State == "ROLLED_BACK" || record.State == "MANUAL_INTERVENTION")
                {
                    if (record.FinalResult != null)
                    {
                        record.FinalResult.Detail["cached"] = true;
                        return record.FinalResult;
                    }
                    if (record.State == "SUCCEEDED") return ActionResult.Succeeded(BuildDetail(record, "SUCCEEDED"));
                    return ActionResult.Failed(record.State == "MANUAL_INTERVENTION" ? "AGENT_ROLLBACK_FAILED" : "AGENT_ATOMIC_OPERATION_FAILED", FailureMessage(null, record), BuildDetail(record, record.State));
                }
            }

            if (ledgerStore == null && completed.ContainsKey(idempotencyKey)) return completed[idempotencyKey];
            if (preview) return ExecutePreflight(plan, operations);

            if (record == null)
            {
                record = AtomicPlanLedgerRecord.Create(AtomicValue.String(plan, "planId"), idempotencyKey, planDigest, "EXECUTE");
            }
            AtomicExecutionContext context = new AtomicExecutionContext(AtomicValue.PermissionMap(plan), record, ledgerStore == null ? Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-backups") : ledgerStore.BackupDirectory);

            if (record.State == "ROLLING_BACK") return ContinueRollback(plan, record, context, null);
            record.State = "RUNNING";
            SaveLedger(record);

            Dictionary<string, object> failure = null;
            foreach (Dictionary<string, object> operation in operations)
            {
                string operationId = AtomicValue.String(operation, "id");
                if (record.CompletedOperations.Contains(operationId)) continue;
                Dictionary<string, object> result = AtomicOperationExecutor.Execute(operation, context, false);
                record.OperationResults.Add(result);
                if (string.Equals(Convert.ToString(result["status"]), "SUCCEEDED", StringComparison.Ordinal))
                {
                    context.CompletedOperations.Add(operationId);
                    record.CompletedOperations.Add(operationId);
                }
                SaveLedger(record);
                if (!string.Equals(Convert.ToString(result["status"]), "SUCCEEDED", StringComparison.Ordinal))
                {
                    failure = result;
                    break;
                }
            }

            if (failure != null)
            {
                record.State = "ROLLING_BACK";
                SaveLedger(record);
                return ContinueRollback(plan, record, context, failure);
            }

            record.State = "SUCCEEDED";
            record.FinalResult = ActionResult.Succeeded(BuildDetail(record, "SUCCEEDED"));
            SaveLedger(record);
            completed[idempotencyKey] = record.FinalResult;
            return record.FinalResult;
        }

        private ActionResult ExecutePreflight(Dictionary<string, object> plan, List<Dictionary<string, object>> operations)
        {
            List<Dictionary<string, object>> results = new List<Dictionary<string, object>>();
            AtomicExecutionContext context = new AtomicExecutionContext(AtomicValue.PermissionMap(plan), AtomicPlanLedgerRecord.Create(AtomicValue.String(plan, "planId"), AtomicValue.String(plan, "idempotencyKey"), string.Empty, "PREFLIGHT"), Path.Combine(Path.GetTempPath(), "gcac-compat-atomic-backups"));
            Dictionary<string, object> failure = null;
            foreach (Dictionary<string, object> operation in operations)
            {
                Dictionary<string, object> result = AtomicOperationExecutor.Execute(operation, context, true);
                results.Add(result);
                if (!string.Equals(Convert.ToString(result["status"]), "SUCCEEDED", StringComparison.Ordinal))
                {
                    if (failure == null) failure = result;
                }
                else context.CompletedOperations.Add(AtomicValue.String(operation, "id"));
            }
            Dictionary<string, object> detail = new Dictionary<string, object>();
            detail["planId"] = AtomicValue.String(plan, "planId");
            detail["executionMode"] = "PREFLIGHT";
            detail["operationResults"] = results;
            detail["rollbackResults"] = new List<Dictionary<string, object>>();
            detail["state"] = failure == null ? "SUCCEEDED" : "FAILED";
            detail["preview"] = true;
            detail["mutating"] = false;
            ActionResult resultValue = failure == null
                ? ActionResult.Succeeded(detail)
                : ActionResult.Failed("AGENT_ATOMIC_PREFLIGHT_FAILED", Convert.ToString(failure["errorMessage"]), detail);
            return resultValue;
        }

        private ActionResult ContinueRollback(Dictionary<string, object> plan, AtomicPlanLedgerRecord record, AtomicExecutionContext context, Dictionary<string, object> originalFailure)
        {
            List<Dictionary<string, object>> rollback = AtomicValue.DictionaryList(plan, "rollback");
            bool rollbackFailed = false;
            for (int index = rollback.Count - 1; index >= 0; index--)
            {
                Dictionary<string, object> operation = rollback[index];
                string operationId = AtomicValue.String(operation, "id");
                if (record.CompletedRollbackOperations.Contains(operationId)) continue;
                Dictionary<string, object> result = AtomicOperationExecutor.Execute(operation, context, false);
                record.RollbackResults.Add(result);
                SaveLedger(record);
                if (!string.Equals(Convert.ToString(result["status"]), "SUCCEEDED", StringComparison.Ordinal))
                {
                    rollbackFailed = true;
                    break;
                }
                record.CompletedRollbackOperations.Add(operationId);
                SaveLedger(record);
            }
            if (rollbackFailed)
            {
                record.State = "MANUAL_INTERVENTION";
                record.FinalResult = ActionResult.Failed("AGENT_ROLLBACK_FAILED", FailureMessage(originalFailure, record), BuildDetail(record, "MANUAL_INTERVENTION"));
            }
            else
            {
                record.State = "ROLLED_BACK";
                record.FinalResult = ActionResult.Failed("AGENT_ATOMIC_OPERATION_FAILED", FailureMessage(originalFailure, record), BuildDetail(record, "ROLLED_BACK"));
            }
            SaveLedger(record);
            completed[record.IdempotencyKey] = record.FinalResult;
            return record.FinalResult;
        }

        private string FailureMessage(Dictionary<string, object> originalFailure, AtomicPlanLedgerRecord record)
        {
            if (originalFailure != null && originalFailure.ContainsKey("errorMessage")) return Convert.ToString(originalFailure["errorMessage"]);
            for (int index = record.OperationResults.Count - 1; index >= 0; index--)
            {
                Dictionary<string, object> result = record.OperationResults[index];
                if (Convert.ToString(result["status"]) == "FAILED") return Convert.ToString(result["errorMessage"]);
            }
            return "原子计划执行失败";
        }

        private Dictionary<string, object> BuildDetail(AtomicPlanLedgerRecord record, string state)
        {
            Dictionary<string, object> detail = new Dictionary<string, object>();
            detail["planId"] = record.PlanId;
            detail["executionMode"] = record.ExecutionMode;
            detail["operationResults"] = record.OperationResults;
            detail["rollbackResults"] = record.RollbackResults;
            detail["completedOperations"] = record.CompletedOperations;
            detail["state"] = state;
            return detail;
        }

        private void SaveLedger(AtomicPlanLedgerRecord record)
        {
            if (ledgerStore != null) ledgerStore.Save(record);
        }
    }

    internal sealed class AtomicExecutionContext
    {
        public readonly Dictionary<string, List<string>> Permissions;
        public readonly AtomicPlanLedgerRecord Ledger;
        public readonly string BackupDirectory;
        public readonly Dictionary<string, AtomicBindingSnapshot> BindingBackups = new Dictionary<string, AtomicBindingSnapshot>(StringComparer.Ordinal);
        public readonly List<string> CompletedOperations = new List<string>();

        public AtomicExecutionContext(Dictionary<string, List<string>> permissions, AtomicPlanLedgerRecord ledger, string backupDirectory)
        {
            Permissions = permissions;
            Ledger = ledger;
            BackupDirectory = backupDirectory;
            if (ledger != null)
            {
                foreach (string operationId in ledger.CompletedOperations) CompletedOperations.Add(operationId);
                foreach (AtomicBindingBackupRecord backup in ledger.BindingBackups)
                {
                    BindingBackups[backup.OperationId] = new AtomicBindingSnapshot
                    {
                        SiteName = backup.SiteName,
                        BindingInformation = backup.BindingInformation,
                        CertificateHash = AtomicValue.FromHex(backup.CertificateHash),
                        CertificateStoreName = backup.CertificateStoreName
                    };
                }
            }
        }
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
            if (operationType == "file.backup") return BackupFile(input, operationId, context, preview);
            if (operationType == "file.atomic_replace") return ReplaceFile(input, context, preview);
            if (operationType == "file.restore") return RestoreFile(input, context, preview);
            if (operationType == "file.set_permissions") return SetFilePermissions(input, context, preview);
            if (operationType == "command.execute") return ExecuteCommand(input, context, preview);
            if (operationType == "service.control") return ControlService(input, context, preview);
            if (operationType == "windows.certificate.inspect_pfx") return InspectPfx(input, context);
            if (operationType == "windows.certificate_store.import_pfx") return ImportPfx(input, context, preview);
            if (operationType == "windows.certificate_private_key.grant") return GrantPrivateKey(input, context, preview);
            if (operationType == "windows.iis.binding.capture") return CaptureBinding(input, operationId, context);
            if (operationType == "windows.iis.binding.update_certificate") return UpdateBinding(input, context, preview);
            if (operationType == "windows.iis.binding.restore_certificate") return RestoreBinding(input, context, preview);
            throw new InvalidOperationException("unsupported atomic operation: " + operationType);
        }

        private static Dictionary<string, object> BackupFile(Dictionary<string, object> input, string operationId, AtomicExecutionContext context, bool preview)
        {
            string path = AtomicValue.FirstString(input, null, "path", "targetPath");
            path = AtomicFileOperations.RequirePath(path, context.Permissions);
            FileInfo info = AtomicFileOperations.ExistingFile(path);
            if (preview)
            {
                Dictionary<string, object> detail = new Dictionary<string, object>
                {
                    { "path", path },
                    { "exists", info != null },
                    { "preview", true },
                    { "mutating", false },
                    { "plannedAction", "backup" }
                };
                if (info != null) detail["size"] = info.Length;
                return detail;
            }
            AtomicFileBackupRecord backup = new AtomicFileBackupRecord
            {
                OperationId = operationId,
                TargetPath = path,
                Existed = info != null
            };
            if (info != null)
            {
                AtomicFileOperations.ValidateExistingFile(info);
                string backupDirectory = context.BackupDirectory;
                Directory.CreateDirectory(backupDirectory);
                string backupPath = Path.Combine(backupDirectory, AtomicValue.Sha256Hex(context.Ledger.PlanId + ":" + operationId) + ".bak");
                File.Copy(path, backupPath, true);
                File.SetAttributes(backupPath, info.Attributes);
                FileSecurity security = info.GetAccessControl(AccessControlSections.All);
                backup.SecurityDescriptorSddl = security.GetSecurityDescriptorSddlForm(AccessControlSections.All);
                backup.BackupPath = backupPath;
                backup.Size = info.Length;
                backup.Attributes = (int)info.Attributes;
            }
            context.Ledger.FileBackups.RemoveAll(delegate(AtomicFileBackupRecord item) { return item.OperationId == operationId; });
            context.Ledger.FileBackups.Add(backup);
            return new Dictionary<string, object>
            {
                { "path", path },
                { "existed", backup.Existed },
                { "backupPath", backup.BackupPath ?? string.Empty },
                { "size", backup.Size }
            };
        }

        private static Dictionary<string, object> ReplaceFile(Dictionary<string, object> input, AtomicExecutionContext context, bool preview)
        {
            string path = AtomicValue.FirstString(input, null, "path", "targetPath");
            path = AtomicFileOperations.RequirePath(path, context.Permissions);
            byte[] content = AtomicValue.Content(input);
            FileInfo existing = AtomicFileOperations.ExistingFile(path);
            if (preview)
            {
                return new Dictionary<string, object>
                {
                    { "path", path },
                    { "bytes", content.Length },
                    { "sha256", AtomicValue.Sha256Hex(content) },
                    { "preview", true },
                    { "mutating", false },
                    { "plannedAction", "replace" },
                    { "targetExists", existing != null }
                };
            }
            AtomicFileOperations.WriteAtomic(path, content);
            if (existing != null) File.SetAttributes(path, existing.Attributes);
            return new Dictionary<string, object>
            {
                { "path", path },
                { "bytes", content.Length },
                { "sha256", AtomicValue.Sha256Hex(content) }
            };
        }

        private static Dictionary<string, object> RestoreFile(Dictionary<string, object> input, AtomicExecutionContext context, bool preview)
        {
            string reference = AtomicValue.String(input, "backupOperationId");
            AtomicFileBackupRecord backup = context.Ledger.FileBackups.Find(delegate(AtomicFileBackupRecord item) { return item.OperationId == reference; });
            if (backup == null) throw new InvalidOperationException("file backup not found: " + reference);
            string path = AtomicFileOperations.RequirePath(backup.TargetPath, context.Permissions);
            if (preview)
            {
                return new Dictionary<string, object>
                {
                    { "path", path },
                    { "backupOperationId", reference },
                    { "existed", backup.Existed },
                    { "preview", true },
                    { "mutating", false },
                    { "plannedAction", "restore" }
                };
            }
            if (!backup.Existed)
            {
                if (File.Exists(path)) File.Delete(path);
                else if (Directory.Exists(path)) throw new InvalidOperationException("恢复目标不是文件：" + path);
                return new Dictionary<string, object> { { "path", path }, { "removed", true } };
            }
            if (TextUtility.IsBlank(backup.BackupPath) || !File.Exists(backup.BackupPath))
                throw new InvalidOperationException("file backup content not found: " + reference);
            byte[] content = File.ReadAllBytes(backup.BackupPath);
            AtomicFileOperations.WriteAtomic(path, content);
            File.SetAttributes(path, (FileAttributes)backup.Attributes);
            if (!TextUtility.IsBlank(backup.SecurityDescriptorSddl))
            {
                FileInfo restored = new FileInfo(path);
                FileSecurity security = restored.GetAccessControl(AccessControlSections.All);
                security.SetSecurityDescriptorSddlForm(backup.SecurityDescriptorSddl);
                restored.SetAccessControl(security);
            }
            return new Dictionary<string, object>
            {
                { "path", path },
                { "backupOperationId", reference },
                { "bytes", content.Length },
                { "sha256", AtomicValue.Sha256Hex(content) }
            };
        }

        private static Dictionary<string, object> SetFilePermissions(Dictionary<string, object> input, AtomicExecutionContext context, bool preview)
        {
            string path = AtomicFileOperations.RequirePath(AtomicValue.FirstString(input, null, "path", "targetPath"), context.Permissions);
            string acl = AtomicValue.String(input, "acl");
            if (TextUtility.IsBlank(acl)) return new Dictionary<string, object> { { "path", path }, { "unchanged", true }, { "preview", preview } };
            if (preview)
            {
                return new Dictionary<string, object>
                {
                    { "path", path },
                    { "acl", acl },
                    { "preview", true },
                    { "mutating", false },
                    { "plannedAction", "set_permissions" }
                };
            }
            string icacls = Path.Combine(Environment.SystemDirectory, "icacls.exe");
            Dictionary<string, object> result = AtomicFileOperations.RunProcess(icacls, new string[] { path, "/grant:r", acl }, 30);
            result["path"] = path;
            return result;
        }

        private static Dictionary<string, object> ExecuteCommand(Dictionary<string, object> input, AtomicExecutionContext context, bool preview)
        {
            string program = AtomicValue.String(input, "program");
            AtomicFileOperations.RequireProgram(program, context.Permissions);
            AtomicValue.RequireArgumentArray(input);
            if (AtomicValue.IsShellProgram(program) || AtomicValue.ShellEnabled(input)) throw new InvalidOperationException("shell mode is disabled");
            List<string> arguments = AtomicValue.StringList(input, "args");
            if (preview)
            {
                return new Dictionary<string, object>
                {
                    { "program", program },
                    { "args", arguments.ToArray() },
                    { "preview", true },
                    { "mutating", false },
                    { "plannedAction", "execute" }
                };
            }
            int timeoutSeconds = AtomicValue.Integer(input, "timeoutSeconds", 60);
            return AtomicFileOperations.RunProcess(program, arguments.ToArray(), timeoutSeconds);
        }

        private static Dictionary<string, object> ControlService(Dictionary<string, object> input, AtomicExecutionContext context, bool preview)
        {
            string serviceName = AtomicValue.FirstString(input, null, "service", "serviceName");
            AtomicPermissions.Require(serviceName, context.Permissions, "service");
            string action = AtomicValue.String(input, "action").ToLowerInvariant();
            if (action != "status" && action != "start" && action != "stop" && action != "restart" && action != "reload")
                throw new InvalidOperationException("unsupported service action: " + action);
            ServiceController service = new ServiceController(serviceName);
            try
            {
                ServiceControllerStatus status = service.Status;
                if (preview)
                {
                    return new Dictionary<string, object>
                    {
                        { "service", serviceName },
                        { "action", action },
                        { "status", status.ToString() },
                        { "preview", true },
                        { "mutating", false },
                        { "plannedAction", action }
                    };
                }
                if (action == "start" && status != ServiceControllerStatus.Running)
                {
                    service.Start();
                    service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
                }
                else if (action == "stop" && status != ServiceControllerStatus.Stopped)
                {
                    service.Stop();
                    service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
                }
                else if (action == "restart" || action == "reload")
                {
                    if (status != ServiceControllerStatus.Stopped)
                    {
                        service.Stop();
                        service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
                    }
                    service.Start();
                    service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
                }
                service.Refresh();
                return new Dictionary<string, object>
                {
                    { "service", serviceName },
                    { "action", action },
                    { "performedAction", action == "reload" ? "restart" : action },
                    { "status", service.Status.ToString() }
                };
            }
            finally
            {
                service.Dispose();
            }
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
            context.Ledger.BindingBackups.RemoveAll(delegate(AtomicBindingBackupRecord item) { return item.OperationId == operationId; });
            context.Ledger.BindingBackups.Add(new AtomicBindingBackupRecord
            {
                OperationId = operationId,
                SiteName = snapshot.SiteName,
                BindingInformation = snapshot.BindingInformation,
                CertificateHash = AtomicValue.Hex(snapshot.CertificateHash),
                CertificateStoreName = snapshot.CertificateStoreName
            });
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

    internal static class AtomicFileOperations
    {
        public static string RequirePath(string value, Dictionary<string, List<string>> permissions)
        {
            if (TextUtility.IsBlank(value) || !Path.IsPathRooted(value)) throw new InvalidOperationException("absolute path is required");
            string path = Path.GetFullPath(value);
            AtomicPermissions.Require(path, permissions, "filesystem");
            RejectReparseParents(path);
            return path;
        }

        public static void RequireProgram(string program, Dictionary<string, List<string>> permissions)
        {
            if (TextUtility.IsBlank(program) || !Path.IsPathRooted(program)) throw new InvalidOperationException("absolute program path is required");
            string path = Path.GetFullPath(program);
            AtomicPermissions.Require(path, permissions, "process");
            if (!File.Exists(path)) throw new FileNotFoundException("program not found", path);
            FileAttributes attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("symbolic link or reparse point is not allowed");
        }

        public static FileInfo ExistingFile(string path)
        {
            if (Directory.Exists(path)) throw new InvalidOperationException("target path is a directory: " + path);
            return File.Exists(path) ? new FileInfo(path) : null;
        }

        public static void ValidateExistingFile(FileInfo info)
        {
            if (info == null) return;
            if ((info.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("symbolic link or reparse point is not allowed");
        }

        public static void WriteAtomic(string path, byte[] content)
        {
            FileInfo existing = ExistingFile(path);
            string directory = Path.GetDirectoryName(path);
            if (TextUtility.IsBlank(directory) || !Directory.Exists(directory)) throw new DirectoryNotFoundException("target directory not found: " + directory);
            string temporaryPath = Path.Combine(directory, ".gcac-agent-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream stream = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    stream.Write(content, 0, content.Length);
                    stream.Flush();
                }
                if (existing == null) File.Move(temporaryPath, path);
                else File.Replace(temporaryPath, path, null);
            }
            finally
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }
        }

        public static Dictionary<string, object> RunProcess(string program, string[] arguments, int timeoutSeconds)
        {
            if (timeoutSeconds <= 0) timeoutSeconds = 60;
            if (timeoutSeconds > 600) timeoutSeconds = 600;
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = program,
                Arguments = BuildArguments(arguments),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            Process process = new Process { StartInfo = startInfo };
            try
            {
                StringBuilder output = new StringBuilder();
                StringBuilder errorOutput = new StringBuilder();
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
                {
                    if (eventArgs.Data != null && output.Length < 65536)
                    {
                        if (output.Length > 0) output.AppendLine();
                        output.Append(eventArgs.Data);
                    }
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
                {
                    if (eventArgs.Data != null && errorOutput.Length < 65536)
                    {
                        if (errorOutput.Length > 0) errorOutput.AppendLine();
                        errorOutput.Append(eventArgs.Data);
                    }
                };
                if (!process.Start()) throw new InvalidOperationException("program could not be started: " + program);
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(timeoutSeconds * 1000))
                {
                    try { process.Kill(); }
                    catch (Exception) { }
                    throw new System.TimeoutException("command timed out: " + program);
                }
                process.WaitForExit();
                Dictionary<string, object> detail = new Dictionary<string, object>
                {
                    { "program", program },
                    { "args", arguments ?? new string[0] },
                    { "exitCode", process.ExitCode },
                    { "output", output.ToString() },
                    { "errorOutput", errorOutput.ToString() }
                };
                if (process.ExitCode != 0) throw new InvalidOperationException("command exited with code " + process.ExitCode + ": " + errorOutput.ToString());
                return detail;
            }
            finally
            {
                process.Close();
            }
        }

        private static string BuildArguments(string[] arguments)
        {
            if (arguments == null || arguments.Length == 0) return string.Empty;
            List<string> quoted = new List<string>();
            foreach (string argument in arguments) quoted.Add(QuoteArgument(argument ?? string.Empty));
            return string.Join(" ", quoted.ToArray());
        }

        private static string QuoteArgument(string argument)
        {
            if (argument.Length > 0 && argument.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return argument;
            StringBuilder result = new StringBuilder();
            result.Append('"');
            int backslashes = 0;
            foreach (char current in argument)
            {
                if (current == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (current == '"')
                {
                    result.Append('\\', backslashes * 2 + 1);
                    result.Append('"');
                    backslashes = 0;
                    continue;
                }
                if (backslashes > 0)
                {
                    result.Append('\\', backslashes);
                    backslashes = 0;
                }
                result.Append(current);
            }
            result.Append('\\', backslashes * 2);
            result.Append('"');
            return result.ToString();
        }

        private static void RejectReparseParents(string path)
        {
            string current = Path.GetFullPath(path);
            FileInfo file = ExistingFile(current);
            if (file != null) ValidateExistingFile(file);
            string parent = Path.GetDirectoryName(current);
            string root = Path.GetPathRoot(current);
            while (!TextUtility.IsBlank(parent) && !string.Equals(parent, root, StringComparison.OrdinalIgnoreCase))
            {
                if (Directory.Exists(parent))
                {
                    FileAttributes attributes = File.GetAttributes(parent);
                    if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("symbolic link or reparse point is not allowed");
                }
                parent = Path.GetDirectoryName(parent);
            }
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
            if (TextUtility.IsBlank(value)) throw new InvalidOperationException("permission value is required: " + scope);
            List<string> allowed; if (permissions == null || !permissions.TryGetValue(scope, out allowed)) throw new InvalidOperationException("permission scope is not allowed: " + scope);
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
        public static string Sha256Hex(string value) { return Sha256Hex(Encoding.UTF8.GetBytes(value ?? string.Empty)); }
        public static string Sha256Hex(byte[] value) { using (SHA256 sha = SHA256.Create()) return Hex(sha.ComputeHash(value ?? new byte[0])).ToLowerInvariant(); }
        public static byte[] Content(Dictionary<string, object> input)
        {
            object raw;
            if (input != null && input.TryGetValue("content", out raw) && raw is string) return Encoding.UTF8.GetBytes((string)raw);
            if (input != null && input.TryGetValue("contentBase64", out raw) && raw is string)
            {
                try { return Convert.FromBase64String((string)raw); }
                catch (FormatException error) { throw new InvalidOperationException("文件内容 Base64 无效", error); }
            }
            Dictionary<string, object> artifact = Dictionary(input, "artifact");
            if (artifact.TryGetValue("content", out raw) && raw is string) return Encoding.UTF8.GetBytes((string)raw);
            if (artifact.TryGetValue("contentBase64", out raw) && raw is string)
            {
                try { return Convert.FromBase64String((string)raw); }
                catch (FormatException error) { throw new InvalidOperationException("文件 Artifact Base64 无效", error); }
            }
            throw new InvalidOperationException("file content is required");
        }
        public static void RequireArgumentArray(Dictionary<string, object> input)
        {
            object raw;
            if (input == null || !input.TryGetValue("args", out raw) || raw == null || raw is string || !(raw is IEnumerable))
                throw new InvalidOperationException("command args array is required");
            foreach (object item in (IEnumerable)raw) if (!(item is string)) throw new InvalidOperationException("command args must be strings");
        }
        public static List<string> StringList(Dictionary<string, object> input, string key)
        {
            List<string> result = new List<string>();
            object raw;
            if (input == null || !input.TryGetValue(key, out raw) || raw == null) return result;
            IEnumerable values = raw as IEnumerable;
            if (values == null || raw is string) throw new InvalidOperationException(key + " must be an array");
            foreach (object item in values)
            {
                if (!(item is string)) throw new InvalidOperationException(key + " must contain strings");
                result.Add((string)item);
            }
            return result;
        }
        public static int Integer(Dictionary<string, object> input, string key, int fallback)
        {
            object raw;
            if (input == null || !input.TryGetValue(key, out raw) || raw == null) return fallback;
            try { return Convert.ToInt32(raw); }
            catch (Exception) { throw new InvalidOperationException(key + " must be an integer"); }
        }
        public static bool ShellEnabled(Dictionary<string, object> input)
        {
            Dictionary<string, object> shell;
            if (!TryDictionary(input, "shell", out shell)) return false;
            object raw;
            return shell.TryGetValue("enabled", out raw) && raw is bool && (bool)raw;
        }
        public static bool IsShellProgram(string program)
        {
            string name = Path.GetFileName(program).ToLowerInvariant();
            return name == "cmd.exe" || name == "command.com" || name == "powershell.exe" || name == "pwsh.exe" || name == "wscript.exe" || name == "cscript.exe" || name == "sh.exe" || name == "bash.exe";
        }
        public static string CanonicalJson(object value)
        {
            Dictionary<string, object> dictionary = value as Dictionary<string, object>;
            if (dictionary != null) { List<string> keys = new List<string>(dictionary.Keys); keys.Sort(StringComparer.Ordinal); List<string> parts = new List<string>(); foreach (string key in keys) parts.Add(Serializer.Serialize(key) + ":" + CanonicalJson(dictionary[key])); return "{" + string.Join(",", parts.ToArray()) + "}"; }
            if (!(value is string) && !(value is byte[])) { IEnumerable enumerable = value as IEnumerable; if (enumerable != null) { List<string> parts = new List<string>(); foreach (object item in enumerable) parts.Add(CanonicalJson(item)); return "[" + string.Join(",", parts.ToArray()) + "]"; } }
            return Serializer.Serialize(value);
        }
    }
}
