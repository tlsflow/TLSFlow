using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace GCAC.WebIis.AgentSidePlugin
{
    internal static class Program
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };

        private static int Main(string[] args)
        {
            if (Has(args, "--version"))
            {
                Console.WriteLine("web.iis-agent-side-plugin 1.0.0 runtime=csharp-dotnet-framework");
                return 0;
            }

            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    if (line.Length > 4 * 1024 * 1024) throw new InvalidOperationException("Agent-side request exceeds size limit");
                    if (line.Length > 0 && line[0] == '\uFEFF') line = line.Substring(1);
                    Dictionary<string, object> request;
                    try { request = Serializer.Deserialize<Dictionary<string, object>>(line); }
                    catch (Exception error)
                    {
                        Console.Error.WriteLine(Redact(error.Message));
                        request = null;
                    }
                    Dictionary<string, object> response = IisAgentSidePlugin.Handle(request);
                    Console.WriteLine(Serializer.Serialize(response));
                    Console.Out.Flush();
                }
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(Redact(error.Message));
                return 2;
            }
        }

        private static bool Has(string[] args, string value)
        {
            if (args == null) return false;
            foreach (string arg in args) if (string.Equals(arg, value, StringComparison.Ordinal)) return true;
            return false;
        }

        private static string Redact(string value)
        {
            if (value == null) return string.Empty;
            return value.Replace("\r", " ").Replace("\n", " ").Replace("password", "[REDACTED]").Replace("secret", "[REDACTED]").Replace("token", "[REDACTED]");
        }
    }
}
