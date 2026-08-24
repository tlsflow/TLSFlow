using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class AtomicFileBackupRecord
    {
        public string OperationId { get; set; }
        public string TargetPath { get; set; }
        public string BackupPath { get; set; }
        public bool Existed { get; set; }
        public long Size { get; set; }
        public int Attributes { get; set; }
        public string SecurityDescriptorSddl { get; set; }
    }

    internal sealed class AtomicBindingBackupRecord
    {
        public string OperationId { get; set; }
        public string SiteName { get; set; }
        public string BindingInformation { get; set; }
        public string CertificateHash { get; set; }
        public string CertificateStoreName { get; set; }
    }

    internal sealed class AtomicPlanLedgerRecord
    {
        public string PlanId { get; set; }
        public string IdempotencyKey { get; set; }
        public string PlanDigest { get; set; }
        public string ExecutionMode { get; set; }
        public string State { get; set; }
        public List<string> CompletedOperations { get; set; }
        public List<string> CompletedRollbackOperations { get; set; }
        public List<Dictionary<string, object>> OperationResults { get; set; }
        public List<Dictionary<string, object>> RollbackResults { get; set; }
        public List<AtomicFileBackupRecord> FileBackups { get; set; }
        public List<AtomicBindingBackupRecord> BindingBackups { get; set; }
        public ActionResult FinalResult { get; set; }
        public DateTime UpdatedAtUtc { get; set; }

        public static AtomicPlanLedgerRecord Create(string planId, string idempotencyKey, string planDigest, string executionMode)
        {
            return new AtomicPlanLedgerRecord
            {
                PlanId = planId,
                IdempotencyKey = idempotencyKey,
                PlanDigest = planDigest,
                ExecutionMode = executionMode,
                State = "RUNNING",
                CompletedOperations = new List<string>(),
                CompletedRollbackOperations = new List<string>(),
                OperationResults = new List<Dictionary<string, object>>(),
                RollbackResults = new List<Dictionary<string, object>>(),
                FileBackups = new List<AtomicFileBackupRecord>(),
                BindingBackups = new List<AtomicBindingBackupRecord>(),
                UpdatedAtUtc = DateTime.UtcNow
            };
        }

        public void EnsureCollections()
        {
            if (CompletedOperations == null) CompletedOperations = new List<string>();
            if (CompletedRollbackOperations == null) CompletedRollbackOperations = new List<string>();
            if (OperationResults == null) OperationResults = new List<Dictionary<string, object>>();
            if (RollbackResults == null) RollbackResults = new List<Dictionary<string, object>>();
            if (FileBackups == null) FileBackups = new List<AtomicFileBackupRecord>();
            if (BindingBackups == null) BindingBackups = new List<AtomicBindingBackupRecord>();
        }
    }

    internal sealed class AtomicPlanLedgerStore
    {
        private readonly string directory;
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();

        public AtomicPlanLedgerStore(string dataDirectory)
        {
            if (TextUtility.IsBlank(dataDirectory)) throw new ArgumentException("dataDirectory 不能为空", "dataDirectory");
            directory = Path.Combine(Path.GetFullPath(dataDirectory), "atomic-plans");
            Directory.CreateDirectory(directory);
        }

        public string BackupDirectory
        {
            get { return Path.Combine(Path.GetDirectoryName(directory), "atomic-backups"); }
        }

        public AtomicPlanLedgerRecord Load(string idempotencyKey)
        {
            string path = PathFor(idempotencyKey);
            if (!File.Exists(path)) return null;
            string json = File.ReadAllText(path);
            AtomicPlanLedgerRecord record = serializer.Deserialize<AtomicPlanLedgerRecord>(json);
            if (record == null) throw new InvalidOperationException("原子计划账本为空：" + path);
            record.EnsureCollections();
            return record;
        }

        public void Save(AtomicPlanLedgerRecord record)
        {
            if (record == null) throw new ArgumentNullException("record");
            record.EnsureCollections();
            record.UpdatedAtUtc = DateTime.UtcNow;
            string path = PathFor(record.IdempotencyKey);
            string temporaryPath = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporaryPath, serializer.Serialize(record), Encoding.UTF8);
                if (File.Exists(path))
                {
                    File.Replace(temporaryPath, path, null);
                }
                else
                {
                    File.Move(temporaryPath, path);
                }
            }
            finally
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }
        }

        private string PathFor(string idempotencyKey)
        {
            string fileName = idempotencyKey;
            if (!IsSafeFileName(fileName))
            {
                using (SHA256 sha = SHA256.Create())
                {
                    fileName = "key-" + AtomicValue.Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(idempotencyKey ?? string.Empty)));
                }
            }
            return Path.Combine(directory, fileName + ".json");
        }

        private static bool IsSafeFileName(string value)
        {
            if (TextUtility.IsBlank(value) || value.Trim() != value || value.EndsWith(".")) return false;
            if (value.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return false;
            string baseName = value;
            int dot = baseName.IndexOf('.');
            if (dot >= 0) baseName = baseName.Substring(0, dot);
            baseName = baseName.ToUpperInvariant();
            if (baseName == "CON" || baseName == "PRN" || baseName == "AUX" || baseName == "NUL") return false;
            if (baseName.Length == 4 && (baseName.StartsWith("COM") || baseName.StartsWith("LPT")) && baseName[3] >= '1' && baseName[3] <= '9') return false;
            foreach (char valuePart in value) if (valuePart < 32) return false;
            return true;
        }
    }
}
