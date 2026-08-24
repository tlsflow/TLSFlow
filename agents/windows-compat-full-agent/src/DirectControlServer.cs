using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    internal delegate Dictionary<string, object> DirectControlHealthProvider();

    /// <summary>
    /// 为 AgentDirectClient 提供真实 HTTP 直连入口。所有动作仍通过 Agent Core Registry 执行。
    /// </summary>
    internal sealed class DirectControlServer : IDisposable
    {
        private const int MaxRequestBytes = 1 << 20;
        private const int MaxActions = 256;
        private const string Queued = "queued";
        private const string Running = "running";
        private const string Completed = "completed";

        private readonly AgentConfig config;
        private readonly ActionRegistry registry;
        private readonly DirectControlHealthProvider healthProvider;
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
        private readonly Dictionary<string, DirectControlAction> actions = new Dictionary<string, DirectControlAction>(StringComparer.Ordinal);
        private readonly object sync = new object();
        private readonly DirectControlState state;
        private HttpListener listener;
        private Thread listenerThread;
        private bool stopped;
        private int sequence;

        internal DirectControlServer(AgentConfig config, ActionRegistry registry, DirectControlHealthProvider healthProvider)
        {
            if (config == null) throw new ArgumentNullException("config");
            if (registry == null) throw new ArgumentNullException("registry");
            this.config = config;
            this.registry = registry;
            this.healthProvider = healthProvider;
            state = new DirectControlState
            {
                enabled = config.directControlEnabled,
                reachable = false,
                listenAddress = config.directControlEnabled ? AdvertiseAddress(config) : null,
                protocolVersion = "v1",
                supportedActions = AgentV2Actions.All()
            };
        }

        internal DirectControlState Snapshot()
        {
            lock (sync) return state.Clone();
        }

        internal void Start()
        {
            lock (sync)
            {
                if (!state.enabled) return;
                if (listener != null) throw new InvalidOperationException("Direct Control 服务已启动");
                listener = new HttpListener();
                listener.Prefixes.Add(BindPrefix(config));
                try
                {
                    listener.Start();
                    state.reachable = true;
                    state.lastReadyAt = UtcNow();
                    state.lastDirectError = null;
                }
                catch (Exception error)
                {
                    state.reachable = false;
                    state.lastDirectError = error.Message;
                    listener.Close();
                    listener = null;
                    throw;
                }
                stopped = false;
                listenerThread = new Thread(ListenLoop);
                listenerThread.IsBackground = true;
                listenerThread.Start();
            }
        }

        public void Dispose()
        {
            Stop();
        }

        internal void Stop()
        {
            HttpListener current;
            Thread currentThread;
            lock (sync)
            {
                if (stopped && listener == null) return;
                stopped = true;
                current = listener;
                currentThread = listenerThread;
                listener = null;
                listenerThread = null;
                state.reachable = false;
            }
            if (current != null)
            {
                try { current.Stop(); } catch { }
                try { current.Close(); } catch { }
            }
            if (currentThread != null && currentThread != Thread.CurrentThread && currentThread.IsAlive)
                currentThread.Join(1000);
        }

        private void ListenLoop()
        {
            while (true)
            {
                HttpListener current;
                HttpListenerContext context;
                try
                {
                    lock (sync)
                    {
                        if (stopped || listener == null) return;
                        current = listener;
                    }
                    context = current.GetContext();
                }
                catch (HttpListenerException)
                {
                    return;
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                Handle(context);
            }
        }

        private void Handle(HttpListenerContext context)
        {
            try
            {
                string path = context.Request.Url == null ? string.Empty : context.Request.Url.AbsolutePath;
                if (string.Equals(path, "/api/v1/control/health", StringComparison.Ordinal))
                {
                    HandleHealth(context);
                }
                else if (string.Equals(path, "/api/v1/control/actions/start", StringComparison.Ordinal))
                {
                    HandleStart(context);
                }
                else if (string.Equals(path, "/api/v1/control/actions/status", StringComparison.Ordinal))
                {
                    HandleStatus(context);
                }
                else
                {
                    WriteJson(context, 404, Error("NOT_FOUND", "直连路径不存在"));
                }
            }
            catch (Exception error)
            {
                try { WriteJson(context, 500, Error("DIRECT_CONTROL_INTERNAL_ERROR", error.Message)); } catch { }
                SetDirectError(error.Message);
            }
            finally
            {
                try { context.Response.Close(); } catch { }
            }
        }

        private void HandleHealth(HttpListenerContext context)
        {
            if (!string.Equals(context.Request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(context, 405, Error("METHOD_NOT_ALLOWED", "只允许 GET"));
                return;
            }
            Dictionary<string, object> response = new Dictionary<string, object>();
            response["success"] = true;
            response["checkedAt"] = UtcNow();
            response["protocolVersion"] = "v1";
            response["platform"] = "windows";
            response["service"] = new Dictionary<string, object>
            {
                { "name", ProductIdentity.ServiceName },
                { "displayName", ProductIdentity.DisplayName }
            };
            response["directControl"] = Snapshot();
            response["runtime"] = healthProvider == null ? new Dictionary<string, object>() : healthProvider();
            WriteJson(context, 200, response);
        }

        private void HandleStart(HttpListenerContext context)
        {
            if (!string.Equals(context.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(context, 405, Error("METHOD_NOT_ALLOWED", "只允许 POST"));
                return;
            }
            Dictionary<string, object> payload;
            try { payload = ReadPayload(context.Request); }
            catch (Exception error)
            {
                WriteJson(context, 400, Error("AGENT_V2_MESSAGE_INVALID", error.Message));
                return;
            }
            object actionValue;
            string action = payload.TryGetValue("action", out actionValue) ? Convert.ToString(actionValue) : string.Empty;
            action = action == null ? string.Empty : action.Trim();
            if (!AgentV2Actions.Contains(action))
            {
                WriteJson(context, 400, Error("AGENT_V2_ACTION_UNSUPPORTED", "action 不在 Agent v2 四动作合同内"));
                return;
            }
            string requestId = ReadString(payload, "requestId");
            string actionId;
            try
            {
                actionId = StartAction(action, requestId, payload);
            }
            catch (InvalidOperationException error)
            {
                WriteJson(context, 503, Error("DIRECT_CONTROL_CAPACITY_EXHAUSTED", error.Message));
                return;
            }
            WriteJson(context, 202, new Dictionary<string, object>
            {
                { "actionId", actionId },
                { "actionType", action },
                { "status", Queued }
            });
        }

        private void HandleStatus(HttpListenerContext context)
        {
            if (!string.Equals(context.Request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(context, 405, Error("METHOD_NOT_ALLOWED", "只允许 GET"));
                return;
            }
            string actionId = context.Request.QueryString["actionId"];
            if (TextUtility.IsBlank(actionId))
            {
                WriteJson(context, 400, Error("ACTION_ID_REQUIRED", "actionId 不能为空"));
                return;
            }
            DirectControlAction action;
            lock (sync)
            {
                if (!actions.TryGetValue(actionId.Trim(), out action))
                {
                    WriteJson(context, 404, Error("ACTION_NOT_FOUND", "直连 action 不存在"));
                    return;
                }
                action = action.Clone();
            }
            WriteJson(context, 200, action.ToResponse());
        }

        private string StartAction(string actionType, string requestId, Dictionary<string, object> payload)
        {
            DirectControlAction action = new DirectControlAction
            {
                Id = "agent-v2-" + DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture) + "-" + NextSequence(),
                ActionType = actionType,
                RequestId = requestId,
                Status = Queued,
                CreatedAt = DateTime.UtcNow,
                Payload = payload
            };
            lock (sync)
            {
                if (actions.Count >= MaxActions && !PruneCompleted())
                    throw new InvalidOperationException("direct control action capacity is exhausted");
                actions.Add(action.Id, action);
            }
            ThreadPool.QueueUserWorkItem(delegate { ExecuteAction(action.Id); });
            return action.Id;
        }

        private void ExecuteAction(string actionId)
        {
            DirectControlAction action;
            lock (sync)
            {
                if (!actions.TryGetValue(actionId, out action)) return;
                action.Status = Running;
                action.StartedAt = DateTime.UtcNow;
            }
            ActionResult result;
            try
            {
                AgentTask task = new AgentTask
                {
                    id = action.Id,
                    action = action.ActionType,
                    schemaVersion = ProductIdentity.ActionSchemaVersion,
                    payload = action.Payload
                };
                result = registry.Execute(task);
            }
            catch (Exception error)
            {
                if (AgentV2Actions.IsWrite(action.ActionType))
                {
                    result = ActionResult.Unknown("AGENT_EXECUTION_UNKNOWN", error.Message, new Dictionary<string, object>
                    {
                        { "fallback", false },
                        { "replayed", false }
                    });
                }
                else
                {
                    result = ActionResult.Failed("AGENT_EXECUTION_FAILED", error.Message, new Dictionary<string, object>
                    {
                        { "fallback", false },
                        { "replayed", false }
                    });
                }
            }
            lock (sync)
            {
                if (!actions.ContainsKey(actionId)) return;
                action.Status = Completed;
                action.Success = result.Success;
                action.ErrorCode = result.ErrorCode;
                action.ErrorMessage = result.ErrorMessage;
                action.Detail = result.Detail;
                action.Outcome = Outcome(result);
                action.CompletedAt = DateTime.UtcNow;
            }
        }

        private static string Outcome(ActionResult result)
        {
            return result == null || TextUtility.IsBlank(result.Outcome)
                ? (result != null && result.Success ? "SUCCESS" : "FAILED")
                : result.Outcome;
        }

        private Dictionary<string, object> ReadPayload(HttpListenerRequest request)
        {
            if (request.ContentLength64 > MaxRequestBytes) throw new InvalidOperationException("请求载荷超过 1 MiB");
            MemoryStream buffer = new MemoryStream();
            byte[] chunk = new byte[4096];
            int total = 0;
            int read;
            while ((read = request.InputStream.Read(chunk, 0, chunk.Length)) > 0)
            {
                total += read;
                if (total > MaxRequestBytes) throw new InvalidOperationException("请求载荷超过 1 MiB");
                buffer.Write(chunk, 0, read);
            }
            string json = Encoding.UTF8.GetString(buffer.ToArray());
            Dictionary<string, object> payload = serializer.Deserialize<Dictionary<string, object>>(json);
            if (payload == null) throw new InvalidOperationException("请求载荷不能为空");
            return payload;
        }

        private static string ReadString(Dictionary<string, object> payload, string key)
        {
            object value;
            return payload.TryGetValue(key, out value) && value != null ? Convert.ToString(value).Trim() : string.Empty;
        }

        private bool PruneCompleted()
        {
            string oldestId = null;
            DateTime oldest = DateTime.MaxValue;
            foreach (KeyValuePair<string, DirectControlAction> pair in actions)
            {
                if (pair.Value.Status == Completed && pair.Value.CreatedAt < oldest)
                {
                    oldestId = pair.Key;
                    oldest = pair.Value.CreatedAt;
                }
            }
            if (oldestId == null) return false;
            actions.Remove(oldestId);
            return true;
        }

        private int NextSequence()
        {
            lock (sync)
            {
                sequence++;
                return sequence;
            }
        }

        private void SetDirectError(string message)
        {
            lock (sync)
            {
                state.lastDirectError = message;
                state.reachable = false;
            }
        }

        private static Dictionary<string, object> Error(string code, string message)
        {
            return new Dictionary<string, object> { { "errorCode", code }, { "message", message } };
        }

        private void WriteJson(HttpListenerContext context, int statusCode, object payload)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(serializer.Serialize(payload));
            context.Response.StatusCode = statusCode;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.ContentLength64 = bytes.Length;
            using (Stream stream = context.Response.OutputStream) stream.Write(bytes, 0, bytes.Length);
        }

        private static string BindPrefix(AgentConfig config)
        {
            string host = TextUtility.IsBlank(config.directControlListenHost) ? "0.0.0.0" : config.directControlListenHost.Trim();
            if (string.Equals(host, "0.0.0.0", StringComparison.Ordinal)) host = "+";
            return "http://" + host + ":" + config.directControlListenPort.ToString(CultureInfo.InvariantCulture) + "/";
        }

        private static string AdvertiseAddress(AgentConfig config)
        {
            string host = TextUtility.IsBlank(config.directControlAdvertiseHost) ? config.directControlListenHost : config.directControlAdvertiseHost;
            if (TextUtility.IsBlank(host)) host = Environment.MachineName;
            return host.Trim() + ":" + config.directControlListenPort.ToString(CultureInfo.InvariantCulture);
        }

        private static string UtcNow()
        {
            return DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        }

        private sealed class DirectControlAction
        {
            public string Id;
            public string ActionType;
            public string RequestId;
            public string Status;
            public bool Success;
            public string ErrorCode;
            public string ErrorMessage;
            public Dictionary<string, object> Detail;
            public string Outcome;
            public DateTime CreatedAt;
            public DateTime StartedAt;
            public DateTime CompletedAt;
            public Dictionary<string, object> Payload;

            public DirectControlAction Clone()
            {
                return (DirectControlAction)MemberwiseClone();
            }

            public Dictionary<string, object> ToResponse()
            {
                Dictionary<string, object> response = new Dictionary<string, object>
                {
                    { "actionId", Id },
                    { "actionType", ActionType },
                    { "requestId", RequestId },
                    { "status", Status },
                    { "createdAt", CreatedAt.ToString("o", CultureInfo.InvariantCulture) }
                };
                if (StartedAt != DateTime.MinValue) response["startedAt"] = StartedAt.ToString("o", CultureInfo.InvariantCulture);
                if (Status != Completed)
                {
                    response["detail"] = new Dictionary<string, object> { { "status", Status } };
                    return response;
                }
                response["success"] = Success;
                response["outcome"] = Outcome;
                response["completedAt"] = CompletedAt.ToString("o", CultureInfo.InvariantCulture);
                if (!TextUtility.IsBlank(ErrorCode)) response["errorCode"] = ErrorCode;
                if (!TextUtility.IsBlank(ErrorMessage)) response["errorMessage"] = ErrorMessage;
                if (Detail != null) response["detail"] = Detail;
                return response;
            }
        }
    }
}
