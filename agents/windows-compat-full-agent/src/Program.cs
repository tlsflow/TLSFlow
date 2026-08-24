using System;
using System.IO;
using System.ServiceProcess;
using System.Threading;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            CrashReporter.Install();
            try
            {
                if (Has(args, "--version"))
                {
                    Console.WriteLine(ProductIdentity.ProductLine + " " + ProductIdentity.Version + " runtime=" + ProductIdentity.Runtime);
                    return 0;
                }
                string configPath = Value(args, "--config") ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "agent.config.json");
                AgentConfig config = AgentConfig.Load(configPath);
                if (Has(args, "--self-test") || Has(args, "--preflight"))
                {
                    CapabilitySnapshot snapshot = new CapabilityCollector(config).Collect();
                    PreflightResult result = new PreflightEvaluator(PreflightEvaluator.MinimumRequirements()).Evaluate(snapshot);
                    Console.WriteLine(new JavaScriptSerializer().Serialize(result));
                    return result.Supported ? 0 : 2;
                }
                AgentRuntime runtime = new AgentRuntime(config);
                if (Environment.UserInteractive || Has(args, "--console"))
                {
                    ManualResetEvent stopSignal = new ManualResetEvent(false);
                    Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs eventArgs) { eventArgs.Cancel = true; stopSignal.Set(); };
                    runtime.Run(stopSignal);
                    stopSignal.Close();
                    return 0;
                }
                ServiceBase.Run(new WindowsAgentService(runtime));
                return 0;
            }
            catch (Exception error)
            {
                CrashReporter.Write("main_exception", error, false);
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
