using System;
using System.Net;
using System.Security.Cryptography.X509Certificates;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class CertificateStoreAdapter
    {
        public bool CanOpenLocalMachineStore()
        {
            X509Store store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
            try
            {
                store.Open(OpenFlags.ReadWrite);
                return true;
            }
            finally { store.Close(); }
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
