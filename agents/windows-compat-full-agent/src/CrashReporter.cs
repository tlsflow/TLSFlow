using System;
using System.IO;
using System.Text;

namespace GCAC.WindowsCompatibilityAgent
{
    internal static class CrashReporter
    {
        private static readonly object Sync = new object();

        public static void Install()
        {
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs args)
            {
                Write("unhandled_exception", args.ExceptionObject, args.IsTerminating);
            };
        }

        public static void Write(string eventName, object error, bool terminating)
        {
            try
            {
                string root = Path.Combine(
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "GCAC"),
                    "WindowsCompatibilityAgent");
                Directory.CreateDirectory(root);
                string path = Path.Combine(root, "crash.log");
                string line = DateTime.UtcNow.ToString("o")
                    + " event=" + (eventName ?? string.Empty)
                    + " terminating=" + terminating
                    + " error=" + (error == null ? string.Empty : Convert.ToString(error))
                    + Environment.NewLine;
                lock (Sync) File.AppendAllText(path, line, new UTF8Encoding(false));
            }
            catch
            {
                // 崩溃记录不能再反过来导致进程崩溃。
            }
        }
    }
}
