using System;
using System.Collections.Generic;

namespace GCAC.WindowsCompatibilityAgent
{
    internal sealed class FactRequirement
    {
        public string Id { get; set; }
        public string Fact { get; set; }
        public string Operator { get; set; }
        public object Expected { get; set; }
        public string ErrorCode { get; set; }
        public string Message { get; set; }
        public string Suggestion { get; set; }
    }

    internal sealed class PreflightEvaluator
    {
        private readonly IList<FactRequirement> requirements;

        public PreflightEvaluator(IList<FactRequirement> requirements)
        {
            this.requirements = requirements;
        }

        public PreflightResult Evaluate(CapabilitySnapshot snapshot)
        {
            List<PreflightCheck> checks = new List<PreflightCheck>();
            foreach (FactRequirement requirement in requirements)
            {
                object actual;
                snapshot.Facts.TryGetValue(requirement.Fact, out actual);
                bool passed = Match(actual, requirement.Operator, requirement.Expected);
                checks.Add(new PreflightCheck
                {
                    Id = requirement.Id,
                    Passed = passed,
                    ErrorCode = passed ? null : requirement.ErrorCode,
                    Message = passed ? "检查通过" : requirement.Message,
                    Suggestion = passed ? null : requirement.Suggestion
                });
            }
            return new PreflightResult { Supported = checks.TrueForAll(delegate(PreflightCheck check) { return check.Passed; }), Checks = checks };
        }

        public static IList<FactRequirement> MinimumRequirements()
        {
            return new List<FactRequirement>
            {
                new FactRequirement { Id = "windows-minimum-version", Fact = "windows.version", Operator = "version_gte", Expected = "6.1.7601", ErrorCode = "WINDOWS_BASELINE_UNSUPPORTED", Message = "Windows 内核版本低于最低兼容基线", Suggestion = "使用 Windows Server 2008 R2 SP1 至 Windows Server 2012 R2" },
                new FactRequirement { Id = "dotnet-framework-35", Fact = "runtime.framework_35_installed", Operator = "equals", Expected = true, ErrorCode = "DOTNET_FRAMEWORK_35_REQUIRED", Message = "未检测到 .NET Framework 3.5.1", Suggestion = "启用操作系统自带的 .NET Framework 3.5.1 功能" },
                new FactRequirement { Id = "tls12", Fact = "security.tls12_enabled", Operator = "equals", Expected = true, ErrorCode = "TLS12_REQUIRED", Message = "运行时未启用 TLS 1.2", Suggestion = "安装必要系统补丁并启用 TLS 1.2" },
                new FactRequirement { Id = "required-hotfixes", Fact = "windows.required_hotfixes_present", Operator = "equals", Expected = true, ErrorCode = "WINDOWS_HOTFIX_REQUIRED", Message = "缺少配置声明的必要 Windows 补丁", Suggestion = "安装 Compatibility Profile 要求的补丁后重新检查" },
                new FactRequirement { Id = "administrator", Fact = "identity.is_administrator", Operator = "equals", Expected = true, ErrorCode = "SERVICE_PRIVILEGE_REQUIRED", Message = "当前身份缺少服务安装和证书存储权限", Suggestion = "使用受控管理员服务账号安装和运行 Agent" },
                new FactRequirement { Id = "certificate-store", Fact = "windows.cert_store_writable", Operator = "equals", Expected = true, ErrorCode = "CERTIFICATE_STORE_PERMISSION_REQUIRED", Message = "LocalMachine 证书存储不可写", Suggestion = "授予受控服务账号证书存储写入权限" },
                new FactRequirement { Id = "control-plane", Fact = "network.control_plane_reachable", Operator = "equals", Expected = true, ErrorCode = "CONTROL_PLANE_UNREACHABLE", Message = "控制面网络或 TLS 连接不可用", Suggestion = "检查 DNS、路由、防火墙、代理和 TLS 1.2 配置" }
            };
        }

        private static bool Match(object actual, string op, object expected)
        {
            if (op == "equals") return object.Equals(ConvertValue(actual, expected), expected);
            if (op == "number_gte") return Convert.ToInt64(actual ?? 0) >= Convert.ToInt64(expected);
            if (op == "version_gte")
            {
                Version actualVersion = ParseVersion(Convert.ToString(actual));
                Version expectedVersion = ParseVersion(Convert.ToString(expected));
                return actualVersion != null && expectedVersion != null && actualVersion >= expectedVersion;
            }
            return false;
        }

        private static object ConvertValue(object actual, object expected)
        {
            if (expected is bool) return Convert.ToBoolean(actual ?? false);
            return actual;
        }

        private static Version ParseVersion(string value)
        {
            if (string.IsNullOrEmpty(value)) return null;
            string[] parts = value.Split('.');
            int major;
            int minor;
            int build = 0;
            int revision = 0;
            if (parts.Length < 2 || !int.TryParse(parts[0], out major) || !int.TryParse(parts[1], out minor)) return null;
            if (parts.Length > 2 && !int.TryParse(parts[2], out build)) return null;
            if (parts.Length > 3 && !int.TryParse(parts[3], out revision)) return null;
            return new Version(major, minor, build, revision);
        }
    }
}
