using System;
using System.IO;
using System.Text;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class AuditLogger
    {
        private readonly string path;
        private readonly object sync = new object();

        public AuditLogger(string directory)
        {
            Directory.CreateDirectory(directory);
            path = Path.Combine(directory, "agent-audit.log");
        }

        public void Write(string level, string eventName, string message)
        {
            try
            {
                string line = DateTime.UtcNow.ToString("o") + " level=" + level + " event=" + eventName + " message=" + Sanitize(message) + Environment.NewLine;
                lock (sync) File.AppendAllText(path, line, new UTF8Encoding(false));
            }
            catch
            {
                // 日志故障不能影响 Agent 主流程。
            }
        }

        private static string Sanitize(string value)
        {
            return (value ?? string.Empty).Replace("\r", " ").Replace("\n", " ");
        }
    }
}
