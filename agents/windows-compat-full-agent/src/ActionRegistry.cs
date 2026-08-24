using System;
using System.Collections.Generic;

namespace GCAC.WindowsCompatibilityAgent
{
    internal delegate ActionResult ActionHandler(AgentTask task);

    internal sealed class ActionRegistration
    {
        public string CanonicalAction { get; set; }
        public string SchemaVersion { get; set; }
        public string[] Aliases { get; set; }
        public ActionHandler Handler { get; set; }
    }

    internal sealed class ActionRegistry
    {
        private readonly Dictionary<string, ActionRegistration> registrations = new Dictionary<string, ActionRegistration>(StringComparer.OrdinalIgnoreCase);

        public void Register(ActionRegistration registration)
        {
            if (registration == null || TextUtility.IsBlank(registration.CanonicalAction) || registration.Handler == null)
                throw new InvalidOperationException("动作注册信息不完整");
            Add(registration.CanonicalAction, registration);
            foreach (string alias in registration.Aliases ?? new string[0]) Add(alias, registration);
        }

        public ActionResult Execute(AgentTask task)
        {
            string action = task == null ? null : (!TextUtility.IsBlank(task.action) ? task.action : task.type);
            ActionRegistration registration;
            if (TextUtility.IsBlank(action) || !registrations.TryGetValue(action, out registration))
                return ActionResult.Failed("ACTION_NOT_REGISTERED", "动作未注册", Detail("action", action));
            string schemaVersion = TextUtility.IsBlank(task.schemaVersion) ? ProductIdentity.ActionSchemaVersion : task.schemaVersion;
            if (!string.Equals(schemaVersion, registration.SchemaVersion, StringComparison.Ordinal))
                return ActionResult.Failed("ACTION_SCHEMA_UNSUPPORTED", "动作 Schema Version 不受支持", Detail("schemaVersion", schemaVersion));
            return registration.Handler(task);
        }

        public string[] ListCanonicalActions()
        {
            List<string> actions = new List<string>();
            foreach (ActionRegistration registration in registrations.Values)
                if (!actions.Contains(registration.CanonicalAction)) actions.Add(registration.CanonicalAction);
            actions.Sort(StringComparer.Ordinal);
            return actions.ToArray();
        }

        private void Add(string key, ActionRegistration registration)
        {
            if (TextUtility.IsBlank(key)) throw new InvalidOperationException("动作标识不能为空");
            if (registrations.ContainsKey(key)) throw new InvalidOperationException("动作或 Alias 重复注册：" + key);
            registrations.Add(key, registration);
        }

        private static Dictionary<string, object> Detail(string key, object value)
        {
            Dictionary<string, object> detail = new Dictionary<string, object>();
            detail[key] = value;
            return detail;
        }
    }
}
