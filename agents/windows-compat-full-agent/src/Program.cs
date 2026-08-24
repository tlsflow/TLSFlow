using System;
using System.IO;
using System.ServiceProcess;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            try
            {
                if (Has(args, "--version"))
                {
                    Console.WriteLine(ProductIdentity.ProductLine + " " + ProductIdentity.Version + " runtime=" + ProductIdentity.Runtime);
                    return 0;
                }
                string configPath = Value(args, "--config") ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "agent.config.json");
                AgentRuntime runtime = new AgentRuntime(AgentConfig.Load(configPath));
                if (Has(args, "--self-test") || Has(args, "--preflight"))
                {
                    PreflightResult result = runtime.SelfCheck();
                    Console.WriteLine(new JavaScriptSerializer().Serialize(result));
                    return result.Supported ? 0 : 2;
                }
                if (Environment.UserInteractive || Has(args, "--console"))
                {
                    Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs eventArgs) { eventArgs.Cancel = true; Environment.Exit(0); };
                    runtime.Run(new System.Threading.CancellationTokenSource().Token);
                    return 0;
                }
                ServiceBase.Run(new WindowsAgentService(runtime));
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.ToString());
                return 1;
            }
        }

        private static bool Has(string[] args, string expected)
        {
            return Array.Exists(args, delegate(string value) { return string.Equals(value, expected, StringComparison.OrdinalIgnoreCase); });
        }

        private static string Value(string[] args, string name)
        {
            for (int index = 0; index < args.Length - 1; index++) if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
            return null;
        }
    }
}
