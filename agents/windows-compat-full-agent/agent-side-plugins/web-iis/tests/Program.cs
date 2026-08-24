using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Web.Script.Serialization;

namespace GCAC.WebIis.AgentSidePlugin.Tests
{
    internal static class Program
    {
        private const string PluginVersionId = "web-iis-1-0-0-side-test";
        private const string AgentId = "agent-iis-side-test";
        private const string TenantId = "tenant-device";
        private const string PlanDigest = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        private const string PackageHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        private const string ReceiptDigest = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        private static int Main()
        {
            try
            {
                RunVersionCheck();
                RunProcessContract();
                Console.WriteLine("IIS Agent-side Plugin 定向测试 PASS");
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.Message);
                return 1;
            }
        }

        private static void RunVersionCheck()
        {
            ProcessStartInfo startInfo = CreateStartInfo("--version");
            using (Process process = Process.Start(startInfo))
            {
                Assert(process != null, "无法启动 IIS Agent-side Plugin 版本进程");
                string version = process.StandardOutput.ReadToEnd();
                process.WaitForExit();
                Assert(process.ExitCode == 0, "IIS Agent-side Plugin --version 失败");
                Assert(version.IndexOf("web.iis-agent-side-plugin 1.0.0", StringComparison.Ordinal) >= 0, "运行时版本未固定");
            }
        }

        private static void RunProcessContract()
        {
            ProcessStartInfo startInfo = CreateStartInfo(null);
            using (Process process = Process.Start(startInfo))
            {
                Assert(process != null, "无法启动 IIS Agent-side Plugin JSONL 进程");
                Dictionary<string, object> malformed = SendRaw(process, "\uFEFF{");
                AssertStatus(malformed, "FAILED");
                Assert((string)DictionaryValue(AsDictionary(DictionaryValue(malformed, "error")), "code") == "AGENT_SIDE_REQUEST_INVALID", "无效 JSON 未失败关闭");
                Dictionary<string, object> discovery = Send(process, Request("discover", "application.discover", false, FixtureFacts(), "agent-grant"));
                AssertStatus(discovery, "SUCCESS");
                Assert((string)DictionaryValue(AsDictionary(DictionaryValue(discovery, "facts")), "iisVersion") == "10.0.20348.1", "IIS discovery Fixture 未被真实进程解析");

                Dictionary<string, object> deploy = Send(process, Request("update-binding", "certificate.deploy", true, FixtureBinding("SUCCESS"), "agent-grant"));
                AssertStatus(deploy, "SUCCESS");
                Assert(DictionaryValue(deploy, "verified") is bool && (bool)DictionaryValue(deploy, "verified"), "IIS 写入未完成写后校验");

                Dictionary<string, object> unknown = Send(process, Request("update-binding", "certificate.deploy", true, FixtureBinding("UNKNOWN"), "agent-grant"));
                AssertStatus(unknown, "UNKNOWN");
                Assert((string)DictionaryValue(AsDictionary(DictionaryValue(unknown, "error")), "code") == "AGENT_EXECUTION_UNKNOWN", "IIS 写入不明未收敛为 UNKNOWN");

                Dictionary<string, object> denied = Request("discover", "application.discover", false, FixtureFacts(), "missing-grant");
                denied["grantRefs"] = new ArrayList();
                Dictionary<string, object> deniedResponse = Send(process, denied);
                AssertStatus(deniedResponse, "FAILED");
                Assert((string)DictionaryValue(AsDictionary(DictionaryValue(deniedResponse, "error")), "code") == "AGENT_SIDE_GRANT_DENIED", "缺少 Grant 未失败关闭");

                process.StandardInput.Close();
                process.WaitForExit();
                Assert(process.ExitCode == 0, "IIS Agent-side Plugin 正常关闭失败");
            }
        }

        private static ProcessStartInfo CreateStartInfo(string argument)
        {
            string executable = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web-iis-agent-side-plugin.exe");
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = executable,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            if (!string.IsNullOrEmpty(argument)) startInfo.Arguments = argument;
            startInfo.EnvironmentVariables["GCAC_PLUGIN_VERSION_ID"] = PluginVersionId;
            startInfo.EnvironmentVariables["GCAC_PLUGIN_PACKAGE_HASH"] = PackageHash;
            startInfo.EnvironmentVariables["GCAC_PLUGIN_MANIFEST_HASH"] = PackageHash;
            startInfo.EnvironmentVariables["GCAC_PLUGIN_RESOURCE_HASH"] = PackageHash;
            return startInfo;
        }

        private static Dictionary<string, object> Send(Process process, Dictionary<string, object> request)
        {
            return SendRaw(process, Serializer.Serialize(request));
        }

        private static Dictionary<string, object> SendRaw(Process process, string serialized)
        {
            process.StandardInput.WriteLine(serialized);
            process.StandardInput.Flush();
            string line = process.StandardOutput.ReadLine();
            if (string.IsNullOrEmpty(line))
            {
                string error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                throw new InvalidOperationException("IIS Agent-side Plugin 未返回 JSONL 响应；stderr=" + error);
            }
            return Serializer.Deserialize<Dictionary<string, object>>(line);
        }

        private static Dictionary<string, object> Request(string operation, string capability, bool writeEffect, Dictionary<string, object> fixture, string grantId)
        {
            string nonce = "nonce-iis-side-test";
            string tokenId = "token-iis-side-test";
            Dictionary<string, object> common = new Dictionary<string, object>
            {
                { "agentId", AgentId }, { "tenantId", TenantId }, { "pluginId", "web.iis" }, { "pluginVersion", "1.0.0" },
                { "pluginVersionId", PluginVersionId }, { "capability", capability }, { "planDigest", PlanDigest }, { "nonce", nonce }
            };
            Dictionary<string, object> token = Copy(common);
            token["tokenVersion"] = "gcac.agent-security/v1";
            token["tokenId"] = tokenId;
            token["actions"] = new List<string> { operation };
            token["signature"] = "fixture-token-signature";
            Dictionary<string, object> decision = Copy(common);
            decision["decisionVersion"] = "gcac.agent-security/v1";
            decision["decisionId"] = "decision-iis-side-test";
            decision["allowed"] = true;
            decision["actions"] = new List<string> { operation };
            decision["tokenId"] = tokenId;
            decision["signature"] = "fixture-decision-signature";
            Dictionary<string, object> grant = Copy(common);
            grant["grantId"] = grantId;
            grant["allowedActions"] = new List<string> { operation };
            grant["artifactDigests"] = new List<string> { PackageHash };
            Dictionary<string, object> receipt = Copy(common);
            receipt["receiptVersion"] = "gcac.agent-security/v1";
            receipt["planId"] = "plan-iis-side-test";
            receipt["tokenId"] = tokenId;
            receipt["status"] = "PENDING";
            receipt["digest"] = ReceiptDigest;
            Dictionary<string, object> localPolicy = new Dictionary<string, object>
            {
                { "policyVersion", "fixture-policy-v1" }, { "agentId", AgentId }, { "allowedActions", new List<string> { operation } }, { "disabled", false }
            };
            return new Dictionary<string, object>
            {
                { "requestId", "request-" + operation }, { "apiVersion", "gcac.agent-side-plugin/v1" }, { "pluginId", "web.iis" }, { "pluginVersion", "1.0.0" },
                { "pluginVersionId", PluginVersionId }, { "agentId", AgentId }, { "tenantId", TenantId }, { "capability", capability }, { "operation", operation },
                { "grantRefs", new List<string> { grantId } }, { "token", token }, { "policyDecision", decision }, { "nonce", nonce }, { "receipt", receipt },
                { "grant", grant }, { "localPolicy", localPolicy }, { "packageHash", PackageHash }, { "manifestHash", PackageHash }, { "resourceHash", PackageHash },
                { "planDigest", PlanDigest }, { "deadlineAt", DateTime.UtcNow.AddMinutes(5).ToString("o", CultureInfo.InvariantCulture) }, { "writeEffect", writeEffect },
                { "input", Input(operation) }, { "fixture", fixture }
            };
        }

        private static Dictionary<string, object> Input(string operation)
        {
            Dictionary<string, object> input = new Dictionary<string, object>
            {
                { "siteName", "Default Web Site" },
                { "bindingInformation", "192.0.2.80:443:www.example.invalid" },
                { "certificateThumbprint", "AABBCCDDEEFF00112233445566778899AABBCCDD" }
            };
            if (operation == "discover") input["deviceAddress"] = "iis-fixture-01";
            return input;
        }

        private static Dictionary<string, object> FixtureFacts()
        {
            return new Dictionary<string, object>
            {
                { "mode", "DEVELOPMENT" },
                { "facts", new Dictionary<string, object>
                    {
                        { "iisVersion", "10.0.20348.1" }, { "machineName", "iis-fixture-01" },
                        { "sites", new List<Dictionary<string, object>> { new Dictionary<string, object> { { "name", "Default Web Site" }, { "addresses", new List<string> { "192.0.2.80" } } } } },
                        { "bindings", new List<Dictionary<string, object>> { Binding() } }
                    }
                }
            };
        }

        private static Dictionary<string, object> FixtureBinding(string status)
        {
            return new Dictionary<string, object>
            {
                { "mode", "DEVELOPMENT" }, { "bindings", new List<Dictionary<string, object>> { Binding() } },
                { "writeResult", new Dictionary<string, object> { { "status", status } } }
            };
        }

        private static Dictionary<string, object> Binding()
        {
            return new Dictionary<string, object>
            {
                { "siteName", "Default Web Site" }, { "bindingInformation", "192.0.2.80:443:www.example.invalid" }, { "protocol", "https" },
                { "hostName", "www.example.invalid" }, { "certificateThumbprint", "AABBCCDDEEFF00112233445566778899AABBCCDD" }, { "certificateStoreName", "My" }
            };
        }

        private static Dictionary<string, object> Copy(Dictionary<string, object> source)
        {
            Dictionary<string, object> copy = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> item in source) copy[item.Key] = item.Value;
            return copy;
        }

        private static object DictionaryValue(Dictionary<string, object> value, string key)
        {
            object result;
            Assert(value.TryGetValue(key, out result), "响应缺少字段：" + key);
            return result;
        }

        private static Dictionary<string, object> AsDictionary(object value)
        {
            Dictionary<string, object> result = value as Dictionary<string, object>;
            Assert(result != null, "响应字段不是对象");
            return result;
        }

        private static void AssertStatus(Dictionary<string, object> value, string expected)
        {
            Assert(DictionaryValue(value, "status") as string == expected, "状态不匹配，期望 " + expected);
        }

        private static void Assert(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
