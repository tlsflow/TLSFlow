using System;
using System.Diagnostics;
using System.ServiceProcess;
using System.Threading;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class WindowsAgentService : ServiceBase
    {
        private readonly AgentRuntime runtime;
        private ManualResetEvent stopSignal;
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
            stopSignal = new ManualResetEvent(false);
            worker = new Thread(delegate()
            {
                try
                {
                    runtime.Run(stopSignal);
                }
                catch (Exception error)
                {
                    CrashReporter.Write("service_worker_exception", error, false);
                    try { runtime.RecordFatal(error); }
                    catch (Exception loggingError) { CrashReporter.Write("service_worker_logging_exception", loggingError, false); }
                    try { EventLog.WriteEntry(ProductIdentity.DisplayName, error.ToString(), EventLogEntryType.Error); }
                    catch { }
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        protected override void OnStop()
        {
            if (stopSignal != null) stopSignal.Set();
            if (worker != null) worker.Join(15000);
            if (stopSignal != null) stopSignal.Close();
        }
    }
}
