using GCAC.WindowsCompatibilityAgent;
using System;
using System.Collections.Generic;

internal static class Tests
{
    private static int failures;

    private static int Main()
    {
        Run("Registry 支持规范动作和 Alias", RegistrySupportsAlias);
        Run("Registry 拒绝重复 Alias", RegistryRejectsDuplicateAlias);
        Run("未知 Schema Version 失败关闭", RegistryRejectsUnknownSchema);
        Run("前置检查按事实和通用操作符解析", PreflightUsesFacts);
        Run("IIS Handler 拒绝不完整载荷", IisHandlerRejectsInvalidPayload);
        Run("缺失前置事实返回稳定阻塞错误", PreflightReportsStableBlocker);
        Console.WriteLine("tests=" + 6 + " failures=" + failures);
        return failures == 0 ? 0 : 1;
    }

    private static void RegistrySupportsAlias()
    {
        ActionRegistry registry = Registry();
        ActionResult result = registry.Execute(new AgentTask { type = "legacy.action", schemaVersion = ProductIdentity.ActionSchemaVersion });
        Assert(result.Success, "Alias 未解析到规范动作");
    }

    private static void RegistryRejectsDuplicateAlias()
    {
        ActionRegistry registry = Registry();
        bool failed = false;
        try { registry.Register(new ActionRegistration { CanonicalAction = "other.action", SchemaVersion = ProductIdentity.ActionSchemaVersion, Aliases = new string[] { "legacy.action" }, Handler = delegate { return ActionResult.Succeeded(null); } }); }
        catch (InvalidOperationException) { failed = true; }
        Assert(failed, "重复 Alias 被静默覆盖");
    }

    private static void RegistryRejectsUnknownSchema()
    {
        ActionResult result = Registry().Execute(new AgentTask { action = "test.action", schemaVersion = "gcac.action/v999" });
        Assert(!result.Success && result.ErrorCode == "ACTION_SCHEMA_UNSUPPORTED", "未知 Schema 未失败关闭");
    }

    private static void PreflightUsesFacts()
    {
        CapabilitySnapshot snapshot = new CapabilitySnapshot { Facts = new Dictionary<string, object> { { "custom.number", 7 } }, Capabilities = new List<string>() };
        PreflightEvaluator evaluator = new PreflightEvaluator(new List<FactRequirement> { new FactRequirement { Id = "minimum", Fact = "custom.number", Operator = "number_gte", Expected = 5, ErrorCode = "BLOCKED" } });
        Assert(evaluator.Evaluate(snapshot).Supported, "通用事实约束未通过");
    }

    private static void IisHandlerRejectsInvalidPayload()
    {
        IisCertificateDeploymentHandler handler = new IisCertificateDeploymentHandler(Environment.CurrentDirectory);
        ActionResult result = handler.Execute(new AgentTask { payload = new Dictionary<string, object>() });
        Assert(!result.Success && result.ErrorCode == "ACTION_PAYLOAD_INVALID", "IIS Handler 未校验必要参数");
    }

    private static void PreflightReportsStableBlocker()
    {
        CapabilitySnapshot snapshot = new CapabilitySnapshot { Facts = new Dictionary<string, object> { { "network.control_plane_reachable", false } }, Capabilities = new List<string>() };
        PreflightEvaluator evaluator = new PreflightEvaluator(new List<FactRequirement> { new FactRequirement { Id = "network", Fact = "network.control_plane_reachable", Operator = "equals", Expected = true, ErrorCode = "CONTROL_PLANE_UNREACHABLE", Message = "blocked" } });
        PreflightResult result = evaluator.Evaluate(snapshot);
        Assert(!result.Supported && result.Checks[0].ErrorCode == "CONTROL_PLANE_UNREACHABLE", "前置检查未返回稳定错误");
    }

    private static ActionRegistry Registry()
    {
        ActionRegistry registry = new ActionRegistry();
        registry.Register(new ActionRegistration { CanonicalAction = "test.action", SchemaVersion = ProductIdentity.ActionSchemaVersion, Aliases = new string[] { "legacy.action" }, Handler = delegate { return ActionResult.Succeeded(null); } });
        return registry;
    }

    private static void Run(string name, Action test)
    {
        try { test(); Console.WriteLine("PASS " + name); }
        catch (Exception error) { failures++; Console.WriteLine("FAIL " + name + " " + error.Message); }
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
