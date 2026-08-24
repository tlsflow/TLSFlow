using System;
using System.IO;
using System.Net;
using System.Security.Cryptography.X509Certificates;
using System.ServiceProcess;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class AtomicFileAdapter
    {
        public string Replace(string targetPath, byte[] content, string backupDirectory)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath));
            Directory.CreateDirectory(backupDirectory);
            string backupPath = Path.Combine(backupDirectory, Path.GetFileName(targetPath) + "." + DateTime.UtcNow.Ticks + ".bak");
            if (File.Exists(targetPath)) File.Copy(targetPath, backupPath, true);
            string temporaryPath = targetPath + ".gcac.tmp";
            File.WriteAllBytes(temporaryPath, content);
            if (File.Exists(targetPath)) File.Replace(temporaryPath, targetPath, null); else File.Move(temporaryPath, targetPath);
            return backupPath;
        }
    }

    internal sealed class WindowsServiceControllerAdapter
    {
        public bool IsRunning(string serviceName)
        {
            using (ServiceController controller = new ServiceController(serviceName)) return controller.Status == ServiceControllerStatus.Running;
        }
    }

    internal sealed class CertificateStoreAdapter
    {
        public bool CanOpenLocalMachineStore()
        {
            using (X509Store store = new X509Store(StoreName.My, StoreLocation.LocalMachine))
            {
                store.Open(OpenFlags.ReadWrite);
                return true;
            }
        }
    }

    internal sealed class TlsVerifierAdapter
    {
        public bool CanReach(string url, int timeoutMilliseconds)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "HEAD";
            request.Timeout = timeoutMilliseconds;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) return (int)response.StatusCode < 500;
        }
    }
}
