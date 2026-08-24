using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace GCAC.WindowsCompatibilityAgent
{
    internal static class CertificateTrustInspector
    {
        public static ActionResult Inspect(AgentTask task)
        {
            Dictionary<string, object> payload = task == null ? null : task.payload;
            string fingerprint = NormalizeFingerprint(AtomicValue.String(payload, "fingerprintSha256"));
            if (TextUtility.IsBlank(fingerprint))
                return ActionResult.Failed("TASK_PAYLOAD_INVALID", "fingerprintSha256 is required", null);
            try
            {
                X509Certificate2 certificate = FindInLocalMachineRoot(fingerprint);
                if (certificate == null)
                    return ActionResult.Succeeded(new Dictionary<string, object>
                    {
                        { "status", "not_found" },
                        { "fingerprintSha256", fingerprint.ToLowerInvariant() },
                        { "store", "root" },
                        { "storeLocation", "LocalMachine" },
                        { "storeName", "Root" }
                    });
                try
                {
                    string actualFingerprint = Fingerprint(certificate.RawData);
                    if (!string.Equals(actualFingerprint, fingerprint.ToLowerInvariant(), StringComparison.Ordinal))
                        return ActionResult.Failed("TRUST_FINGERPRINT_MISMATCH", "certificate fingerprint does not match requested fingerprint", null);
                    return ActionResult.Succeeded(new Dictionary<string, object>
                    {
                        { "status", "found" },
                        { "fingerprintSha256", actualFingerprint },
                        { "thumbprint", certificate.Thumbprint },
                        { "certificatePem", ExportPem(certificate) },
                        { "store", "root" },
                        { "storeLocation", "LocalMachine" },
                        { "storeName", "Root" }
                    });
                }
                finally
                {
                    certificate.Reset();
                }
            }
            catch (Exception error)
            {
                return ActionResult.Failed("TRUST_INSPECT_FAILED", error.Message, null);
            }
        }

        private static X509Certificate2 FindInLocalMachineRoot(string thumbprint)
        {
            X509Store store = new X509Store(StoreName.Root, StoreLocation.LocalMachine);
            try
            {
                store.Open(OpenFlags.ReadOnly);
                X509Certificate2Collection matches = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false);
                return matches.Count == 0 ? null : new X509Certificate2(matches[0]);
            }
            finally
            {
                store.Close();
            }
        }

        private static string ExportPem(X509Certificate2 certificate)
        {
            string base64 = Convert.ToBase64String(certificate.RawData, Base64FormattingOptions.InsertLineBreaks);
            return "-----BEGIN CERTIFICATE-----\r\n" + base64 + "\r\n-----END CERTIFICATE-----\r\n";
        }

        private static string NormalizeFingerprint(string value)
        {
            if (TextUtility.IsBlank(value)) return null;
            string normalized = value.Replace(":", string.Empty).Trim().ToUpperInvariant();
            return normalized.Length == 64 ? normalized : null;
        }

        private static string Fingerprint(byte[] bytes)
        {
            using (SHA256Managed sha256 = new SHA256Managed())
            {
                byte[] hash = sha256.ComputeHash(bytes);
                return AtomicValue.Hex(hash).ToLowerInvariant();
            }
        }
    }
}
