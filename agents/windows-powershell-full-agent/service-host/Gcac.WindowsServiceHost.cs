using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

namespace Gcac.WindowsServiceHost
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            ServiceHostOptions options = ServiceHostOptions.Parse(args);
            if (options.RunConsole)
            {
                using (AgentWindowsService service = new AgentWindowsService(options))
                {
                    service.RunConsole();
                    return 0;
                }
            }

            ServiceBase.Run(new ServiceBase[] { new AgentWindowsService(options) });
            return 0;
        }
    }

    internal sealed class AgentWindowsService : ServiceBase
    {
        private readonly ServiceHostOptions _options;
        private Process _childProcess;
        private readonly object _syncRoot = new object();
        private bool _stopping;

        public AgentWindowsService(ServiceHostOptions options)
        {
            _options = options;
            ServiceName = options.ServiceName;
            AutoLog = true;
            CanStop = true;
            CanShutdown = true;
        }

        protected override void OnStart(string[] args)
        {
            StartChildProcess();
        }

        protected override void OnStop()
        {
            StopChildProcess();
        }

        protected override void OnShutdown()
        {
            StopChildProcess();
            base.OnShutdown();
        }

        public void RunConsole()
        {
            StartChildProcess();
            Console.WriteLine("GCAC Windows Service Host running in console mode. Press Enter to stop.");
            Console.ReadLine();
            StopChildProcess();
        }

        private void StartChildProcess()
        {
            lock (_syncRoot)
            {
                _stopping = false;
                if (_childProcess != null && !_childProcess.HasExited)
                {
                    return;
                }

                Directory.CreateDirectory(_options.LogDir);
                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = _options.PowerShellExe,
                        Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{_options.EntryPath}\" -ConfigPath \"{_options.ConfigPath}\" -LogDir \"{_options.LogDir}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WorkingDirectory = Path.GetDirectoryName(_options.EntryPath) ?? AppDomain.CurrentDomain.BaseDirectory,
                    },
                    EnableRaisingEvents = true,
                };

                process.Exited += (_, __) =>
                {
                    WriteHostLog($"Child process exited with code {process.ExitCode}.");
                    lock (_syncRoot)
                    {
                        if (_childProcess != null)
                        {
                            _childProcess.Dispose();
                        }
                        _childProcess = null;
                    }

                    if (!_stopping)
                    {
                        try
                        {
                            Stop();
                        }
                        catch
                        {
                            Environment.Exit(process.ExitCode == 0 ? 1 : process.ExitCode);
                        }
                    }
                };

                WriteHostLog("Starting PowerShell agent child process.");
                if (!process.Start())
                {
                    throw new InvalidOperationException("Failed to start PowerShell agent child process.");
                }

                _childProcess = process;
            }
        }

        private void StopChildProcess()
        {
            lock (_syncRoot)
            {
                _stopping = true;
                if (_childProcess == null)
                {
                    return;
                }

                try
                {
                    if (!_childProcess.HasExited)
                    {
                        WriteHostLog("Stopping PowerShell agent child process.");
                        _childProcess.Kill();
                        _childProcess.WaitForExit(15000);
                    }
                }
                finally
                {
                    _childProcess.Dispose();
                    _childProcess = null;
                }
            }
        }

        private void WriteHostLog(string message)
        {
            try
            {
                Directory.CreateDirectory(_options.LogDir);
                var path = Path.Combine(_options.LogDir, "service-host.log");
                File.AppendAllText(path, $"[{DateTime.UtcNow:O}] {message}{Environment.NewLine}");
            }
            catch
            {
            }
        }
    }

    internal sealed class ServiceHostOptions
    {
        public string ServiceName { get; private set; } = "gcac-full-agent-ps";
        public string PowerShellExe { get; private set; } = "";
        public string EntryPath { get; private set; } = "";
        public string ConfigPath { get; private set; } = "";
        public string LogDir { get; private set; } = "";
        public bool RunConsole { get; private set; }

        public static ServiceHostOptions Parse(string[] args)
        {
            var options = new ServiceHostOptions();
            for (var index = 0; index < args.Length; index += 1)
            {
                var arg = args[index];
                switch (arg)
                {
                    case "--service-name":
                        options.ServiceName = ReadValue(args, ref index, "--service-name");
                        break;
                    case "--powershell-exe":
                        options.PowerShellExe = ReadValue(args, ref index, "--powershell-exe");
                        break;
                    case "--entry-path":
                        options.EntryPath = ReadValue(args, ref index, "--entry-path");
                        break;
                    case "--config-path":
                        options.ConfigPath = ReadValue(args, ref index, "--config-path");
                        break;
                    case "--log-dir":
                        options.LogDir = ReadValue(args, ref index, "--log-dir");
                        break;
                    case "--console":
                        options.RunConsole = true;
                        break;
                    default:
                        throw new ArgumentException($"Unknown argument: {arg}");
                }
            }

            if (string.IsNullOrWhiteSpace(options.PowerShellExe)) throw new ArgumentException("Missing --powershell-exe");
            if (string.IsNullOrWhiteSpace(options.EntryPath)) throw new ArgumentException("Missing --entry-path");
            if (string.IsNullOrWhiteSpace(options.ConfigPath)) throw new ArgumentException("Missing --config-path");
            if (string.IsNullOrWhiteSpace(options.LogDir)) throw new ArgumentException("Missing --log-dir");
            return options;
        }

        private static string ReadValue(string[] args, ref int index, string name)
        {
            if (index + 1 >= args.Length) throw new ArgumentException($"Missing value for {name}");
            index += 1;
            return args[index];
        }
    }
}
