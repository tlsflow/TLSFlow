using System.ServiceProcess;
using System.Threading;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class WindowsAgentService : ServiceBase
    {
        private readonly AgentRuntime runtime;
        private CancellationTokenSource cancellation;
        private Thread worker;

        public WindowsAgentService(AgentRuntime runtime)
        {
            this.runtime = runtime;
            ServiceName = ProductIdentity.ServiceName;
            CanStop = true;
            AutoLog = true;
        }

        protected override void OnStart(string[] args)
        {
            cancellation = new CancellationTokenSource();
            worker = new Thread(delegate() { runtime.Run(cancellation.Token); });
            worker.IsBackground = true;
            worker.Start();
        }

        protected override void OnStop()
        {
            if (cancellation != null) cancellation.Cancel();
            if (worker != null) worker.Join(15000);
        }
    }
}
