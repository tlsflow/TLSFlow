using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class RecoveryRecord
    {
        public string TaskId { get; set; }
        public string LeaseId { get; set; }
        public string PlanId { get; set; }
        public string IdempotencyKey { get; set; }
        public string PlanDigest { get; set; }
        public string ResultDigest { get; set; }
        public string State { get; set; }
        public int RetryCount { get; set; }
        public string LastError { get; set; }
        public DateTime? NextRetryAtUtc { get; set; }
        public bool ResultReported { get; set; }
        public ActionResult Result { get; set; }
        public DateTime UpdatedAtUtc { get; set; }
    }

    internal sealed class RecoveryLedger
    {
        private readonly string path;
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
        private readonly object sync = new object();

        public RecoveryLedger(string directory)
        {
            Directory.CreateDirectory(directory);
            path = Path.Combine(directory, "recovery-ledger.json");
        }

        public void SavePending(AgentTask task, ActionResult result)
        {
            lock (sync)
            {
                List<RecoveryRecord> records = LoadUnsafe();
                string taskId = task == null ? string.Empty : task.id;
                RecoveryRecord existing = records.Find(delegate(RecoveryRecord record) { return record.TaskId == taskId; });
                Dictionary<string, object> plan = ExtractPlan(task);
                RecoveryRecord pendingRecord = existing ?? new RecoveryRecord();
                pendingRecord.TaskId = taskId;
                pendingRecord.LeaseId = task == null ? string.Empty : task.leaseId;
                pendingRecord.PlanId = AtomicValue.String(plan, "planId");
                pendingRecord.IdempotencyKey = AtomicValue.String(plan, "idempotencyKey");
                pendingRecord.PlanDigest = TextUtility.IsBlank(plan == null ? null : AtomicValue.CanonicalJson(plan)) ? string.Empty : AtomicValue.Sha256Hex(AtomicValue.CanonicalJson(plan));
                pendingRecord.Result = RecoverySanitizer.Sanitize(result);
                pendingRecord.ResultDigest = AtomicValue.Sha256Hex(serializer.Serialize(pendingRecord.Result));
                pendingRecord.State = "PENDING_UPLOAD";
                pendingRecord.ResultReported = false;
                pendingRecord.LastError = null;
                pendingRecord.NextRetryAtUtc = null;
                pendingRecord.UpdatedAtUtc = DateTime.UtcNow;
                records.RemoveAll(delegate(RecoveryRecord item) { return item.TaskId == taskId; });
                records.Add(pendingRecord);
                SaveUnsafe(records);
            }
        }

        public void SavePending(string taskId, string leaseId, ActionResult result)
        {
            SavePending(new AgentTask { id = taskId, leaseId = leaseId, payload = new Dictionary<string, object>() }, result);
        }

        public void MarkReported(string taskId)
        {
            lock (sync)
            {
                List<RecoveryRecord> records = LoadUnsafe();
                RecoveryRecord record = records.Find(delegate(RecoveryRecord item) { return item.TaskId == taskId; });
                if (record == null) return;
                record.ResultReported = true;
                record.State = "REPORTED";
                record.LastError = null;
                record.NextRetryAtUtc = null;
                record.UpdatedAtUtc = DateTime.UtcNow;
                SaveUnsafe(records);
            }
        }

        public void MarkRetryFailure(string taskId, string error)
        {
            lock (sync)
            {
                List<RecoveryRecord> records = LoadUnsafe();
                MarkRetryFailureUnsafe(records, taskId, error, DateTime.UtcNow);
                SaveUnsafe(records);
            }
        }

        internal void MarkRetryFailure(string taskId, string error, DateTime nowUtc)
        {
            lock (sync)
            {
                List<RecoveryRecord> records = LoadUnsafe();
                MarkRetryFailureUnsafe(records, taskId, error, nowUtc);
                SaveUnsafe(records);
            }
        }

        public List<RecoveryRecord> Pending()
        {
            lock (sync)
            {
                DateTime now = DateTime.UtcNow;
                return LoadUnsafe().FindAll(delegate(RecoveryRecord record)
                {
                    return !record.ResultReported &&
                        (TextUtility.IsBlank(record.State) || record.State == "PENDING_UPLOAD") &&
                        record.Result != null &&
                        (!record.NextRetryAtUtc.HasValue || record.NextRetryAtUtc.Value <= now);
                });
            }
        }

        public List<RecoveryRecord> ManualIntervention()
        {
            lock (sync) return LoadUnsafe().FindAll(delegate(RecoveryRecord record) { return record.State == "MANUAL_INTERVENTION"; });
        }

        internal List<RecoveryRecord> Records()
        {
            lock (sync) return LoadUnsafe();
        }

        private static void MarkRetryFailureUnsafe(List<RecoveryRecord> records, string taskId, string error, DateTime nowUtc)
        {
            RecoveryRecord record = records.Find(delegate(RecoveryRecord item) { return item.TaskId == taskId; });
            if (record == null) return;
            record.RetryCount++;
            record.LastError = error;
            record.State = "PENDING_UPLOAD";
            int delaySeconds = 5;
            for (int index = 1; index < record.RetryCount && index < 5; index++) delaySeconds *= 2;
            record.NextRetryAtUtc = nowUtc.AddSeconds(delaySeconds);
            record.UpdatedAtUtc = nowUtc;
        }

        private List<RecoveryRecord> LoadUnsafe()
        {
            if (!File.Exists(path)) return new List<RecoveryRecord>();
            try
            {
                List<RecoveryRecord> records = serializer.Deserialize<List<RecoveryRecord>>(File.ReadAllText(path));
                return records ?? new List<RecoveryRecord>();
            }
            catch (Exception error)
            {
                string corruptPath = path + ".corrupt." + Guid.NewGuid().ToString("N");
                try { File.Move(path, corruptPath); }
                catch { }
                List<RecoveryRecord> manualRecords = new List<RecoveryRecord>
                {
                    new RecoveryRecord
                    {
                        TaskId = "recovery-ledger",
                        State = "MANUAL_INTERVENTION",
                        LastError = "Recovery Ledger 无法安全解析：" + error.Message,
                        UpdatedAtUtc = DateTime.UtcNow
                    }
                };
                try { SaveUnsafe(manualRecords); }
                catch { }
                return manualRecords;
            }
        }

        private void SaveUnsafe(List<RecoveryRecord> records)
        {
            string temporaryPath = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporaryPath, serializer.Serialize(records), Encoding.UTF8);
                if (File.Exists(path)) File.Replace(temporaryPath, path, null);
                else File.Move(temporaryPath, path);
            }
            finally
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }
        }

        private Dictionary<string, object> ExtractPlan(AgentTask task)
        {
            Dictionary<string, object> plan;
            return task != null && AtomicValue.TryDictionary(task.payload, "plan", out plan) ? plan : null;
        }
    }

    internal static class RecoverySanitizer
    {
        public static ActionResult Sanitize(ActionResult result)
        {
            if (result == null) return null;
            return new ActionResult
            {
                Success = result.Success,
                ErrorCode = result.ErrorCode,
                ErrorMessage = result.ErrorMessage,
                Detail = SanitizeDictionary(result.Detail)
            };
        }

        private static Dictionary<string, object> SanitizeDictionary(Dictionary<string, object> source)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            if (source == null) return result;
            foreach (KeyValuePair<string, object> item in source)
                result[item.Key] = IsSensitiveKey(item.Key) ? "[REDACTED]" : SanitizeValue(item.Value);
            return result;
        }

        private static object SanitizeValue(object value)
        {
            Dictionary<string, object> dictionary = value as Dictionary<string, object>;
            if (dictionary != null) return SanitizeDictionary(dictionary);
            IEnumerable values = value as IEnumerable;
            if (values != null && !(value is string))
            {
                List<object> result = new List<object>();
                foreach (object item in values) result.Add(SanitizeValue(item));
                return result;
            }
            string text = value as string;
            if (!TextUtility.IsBlank(text) && (text.IndexOf("BEGIN PRIVATE KEY", StringComparison.OrdinalIgnoreCase) >= 0 || text.IndexOf("BEGIN RSA PRIVATE KEY", StringComparison.OrdinalIgnoreCase) >= 0))
                return "[REDACTED]";
            return value;
        }

        private static bool IsSensitiveKey(string key)
        {
            string normalized = (key ?? string.Empty).Replace("_", string.Empty).Replace("-", string.Empty).ToLowerInvariant();
            return normalized.Contains("password") ||
                normalized.Contains("secret") ||
                normalized.Contains("privatekey") ||
                normalized.Contains("pfxpassword") ||
                normalized.Contains("keystorepassword") ||
                normalized == "content";
        }
    }
}
