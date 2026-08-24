using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class RecoveryRecord
    {
        public string TaskId { get; set; }
        public string LeaseId { get; set; }
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

        public void SavePending(string taskId, string leaseId, ActionResult result)
        {
            lock (sync)
            {
                List<RecoveryRecord> records = LoadUnsafe();
                records.RemoveAll(delegate(RecoveryRecord record) { return record.TaskId == taskId; });
                records.Add(new RecoveryRecord { TaskId = taskId, LeaseId = leaseId, Result = result, ResultReported = false, UpdatedAtUtc = DateTime.UtcNow });
                File.WriteAllText(path, serializer.Serialize(records));
            }
        }

        public void MarkReported(string taskId)
        {
            lock (sync)
            {
                List<RecoveryRecord> records = LoadUnsafe();
                RecoveryRecord record = records.Find(delegate(RecoveryRecord item) { return item.TaskId == taskId; });
                if (record == null) return;
                record.ResultReported = true;
                record.UpdatedAtUtc = DateTime.UtcNow;
                File.WriteAllText(path, serializer.Serialize(records));
            }
        }

        public List<RecoveryRecord> Pending()
        {
            lock (sync) return LoadUnsafe().FindAll(delegate(RecoveryRecord record) { return !record.ResultReported && record.Result != null; });
        }

        private List<RecoveryRecord> LoadUnsafe()
        {
            if (!File.Exists(path)) return new List<RecoveryRecord>();
            List<RecoveryRecord> records = serializer.Deserialize<List<RecoveryRecord>>(File.ReadAllText(path));
            return records ?? new List<RecoveryRecord>();
        }
    }
}
