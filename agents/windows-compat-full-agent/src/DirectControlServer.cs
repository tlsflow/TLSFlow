using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class DirectControlServer : IDisposable
    {
        private readonly HttpListener listener = new HttpListener();
        private readonly AuditLogger logger;
        private readonly ActionRegistry registry;
        private Thread worker;

        public DirectControlServer(AgentConfig config, AuditLogger logger, ActionRegistry registry)
        {
            this.logger = logger;
            this.registry = registry;
            string prefixHost = config.directControlListenHost == "127.0.0.1" || config.directControlListenHost == "localhost" ? config.directControlListenHost : "+";
            listener.Prefixes.Add("http://" + prefixHost + ":" + config.directControlListenPort + "/");
        }

        public void Start()
        {
            listener.Start();
            worker = new Thread(ListenLoop);
            worker.IsBackground = true;
            worker.Name = "GCAC Compatibility Direct Control";
            worker.Start();
        }

        private void ListenLoop()
        {
            while (listener.IsListening)
            {
                try { Handle(listener.GetContext()); }
                catch (HttpListenerException error)
                {
                    if (listener.IsListening)
                    {
                        logger.Write("error", "direct_control.listener_failed", error.ToString());
                        listener.Stop();
                    }
                    return;
                }
                catch (ObjectDisposedException) { return; }
                catch (Exception error) { logger.Write("error", "direct_control.request_failed", error.Message); }
            }
        }

        private void Handle(HttpListenerContext context)
        {
            string path = context.Request.Url == null ? string.Empty : context.Request.Url.AbsolutePath;
            if (string.Equals(path, "/api/v1/control/health", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(context, 200, new { success = true, protocolVersion = "v1", checkedAt = DateTime.UtcNow.ToString("o") });
                return;
            }
            if (string.Equals(path, "/api/v1/control/actions/execute", StringComparison.OrdinalIgnoreCase) && string.Equals(context.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    string json;
                    using (StreamReader reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding ?? Encoding.UTF8)) json = reader.ReadToEnd();
                    Dictionary<string, object> request = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
                    string actionType = request != null && request.ContainsKey("actionType") ? Convert.ToString(request["actionType"]) : string.Empty;
                    Dictionary<string, object> inputs = request != null && request.ContainsKey("inputs") ? request["inputs"] as Dictionary<string, object> : null;
                    Dictionary<string, object> response = ExecuteAction(registry, actionType, inputs, request != null && request.ContainsKey("requestId") ? Convert.ToString(request["requestId"]) : null);
                    WriteJson(context, Convert.ToBoolean(response["success"]) ? 200 : 400, response);
                }
                catch (Exception error)
                {
                    WriteJson(context, 400, new { success = false, errorCode = "DIRECT_ACTION_INVALID", errorMessage = error.Message });
                }
                return;
            }
            WriteJson(context, 404, new { success = false, errorCode = "DIRECT_CONTROL_ROUTE_NOT_FOUND" });
        }

        internal static Dictionary<string, object> ExecuteAction(ActionRegistry registry, string actionType, Dictionary<string, object> inputs, string requestId)
        {
            AgentTask task = new AgentTask
            {
                id = "direct_" + DateTime.UtcNow.Ticks,
                action = actionType,
                schemaVersion = ProductIdentity.ActionSchemaVersion,
                payload = inputs ?? new Dictionary<string, object>()
            };
            ActionResult result = registry.Execute(task);
            Dictionary<string, object> response = new Dictionary<string, object>();
            response["success"] = result.Success;
            response["errorCode"] = result.ErrorCode;
            response["errorMessage"] = result.ErrorMessage;
            response["detail"] = result.Detail;
            response["taskId"] = task.id;
            response["requestId"] = requestId;
            response["actionType"] = actionType;
            return response;
        }

        private static void WriteJson(HttpListenerContext context, int statusCode, object body)
        {
            byte[] payload = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(body));
            context.Response.StatusCode = statusCode;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.ContentLength64 = payload.Length;
            context.Response.OutputStream.Write(payload, 0, payload.Length);
            context.Response.OutputStream.Close();
        }

        public void Dispose()
        {
            if (listener.IsListening) listener.Stop();
            listener.Close();
            if (worker != null && worker.IsAlive) worker.Join(TimeSpan.FromSeconds(2));
        }
    }
}
