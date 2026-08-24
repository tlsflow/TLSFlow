using System;
using System.IO;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class AgentIdentityStore
    {
        private readonly string path;

        public AgentIdentityStore(string dataDirectory)
        {
            if (TextUtility.IsBlank(dataDirectory)) throw new ArgumentException("dataDirectory 不能为空", "dataDirectory");
            path = Path.Combine(dataDirectory, "agent-id.txt");
        }

        public string Load()
        {
            if (!File.Exists(path)) return null;
            string agentId = File.ReadAllText(path).Trim();
            return TextUtility.IsBlank(agentId) ? null : agentId;
        }

        public void Save(string agentId)
        {
            if (TextUtility.IsBlank(agentId)) throw new ArgumentException("agentId 不能为空", "agentId");
            string directory = Path.GetDirectoryName(path);
            if (!Directory.Exists(directory)) Directory.CreateDirectory(directory);
            string temporaryPath = path + ".tmp";
            File.WriteAllText(temporaryPath, agentId.Trim());
            if (File.Exists(path)) File.Delete(path);
            File.Move(temporaryPath, path);
        }
    }
}
