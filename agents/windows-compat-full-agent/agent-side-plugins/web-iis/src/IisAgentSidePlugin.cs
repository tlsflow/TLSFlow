using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace GCAC.WebIis.AgentSidePlugin
{
    /// <summary>
    /// IIS 专用 API 的唯一承载进程。Agent Core 不引用本程序集，也不注册本类的动作。
    /// </summary>
    internal static class IisAgentSidePlugin
    {
        private const string ApiVersion = "gcac.agent-side-plugin/v1";
        private const string PluginId = "web.iis";
        private const string PluginVersion = "1.0.0";
        private const string HashPattern = "^sha256:[a-f0-9]{64}$";
        private const string DigestPattern = "^[a-f0-9]{64}$";
        private static readonly Regex IdentifierPattern = new Regex("^[A-Za-z0-9._:-]{1,256}$", RegexOptions.Compiled);
        private static readonly Regex HashRegex = new Regex(HashPattern, RegexOptions.Compiled);
        private static readonly Regex DigestRegex = new Regex(DigestPattern, RegexOptions.Compiled);
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };

        internal static Dictionary<string, object> Handle(Dictionary<string, object> request)
        {
            string requestId = SafeRequestId(request);
            bool writeEffect = false;
            bool writeStarted = false;
            try
            {
                writeEffect = request != null && ReadBoolean(request, "writeEffect", false);
                Authorization authorization = ValidateEnvelope(request, writeEffect);
                Dictionary<string, object> result = Execute(request, authorization, ref writeStarted);
                result["requestId"] = requestId;
                result["apiVersion"] = ApiVersion;
                result["pluginId"] = PluginId;
                result["pluginVersion"] = PluginVersion;
                return result;
            }
            catch (PluginException error)
            {
                bool unknown = writeEffect && (writeStarted || error.WriteStarted || error.Unknown);
                return Failure(requestId, unknown ? "UNKNOWN" : "FAILED", unknown ? "AGENT_EXECUTION_UNKNOWN" : error.Code, unknown ? "IIS 写操作结果无法确认，必须进入恢复流程" : error.Message, writeStarted || error.WriteStarted);
            }
            catch (Exception)
            {
                bool unknown = writeEffect && writeStarted;
                return Failure(requestId, unknown ? "UNKNOWN" : "FAILED", unknown ? "AGENT_EXECUTION_UNKNOWN" : "AGENT_SIDE_PLUGIN_FAILED", unknown ? "IIS 写操作结果无法确认，必须进入恢复流程" : "IIS Agent-side Plugin 执行失败", writeStarted);
            }
        }

        private static Authorization ValidateEnvelope(Dictionary<string, object> request, bool writeEffect)
        {
            if (request == null) throw Reject("AGENT_SIDE_REQUEST_INVALID", "请求必须是 JSON 对象");
            RequireExact(request, new string[] { "requestId", "apiVersion", "pluginId", "pluginVersion", "pluginVersionId", "agentId", "tenantId", "capability", "operation", "grantRefs", "token", "policyDecision", "nonce", "receipt", "grant", "localPolicy", "packageHash", "manifestHash", "resourceHash", "planDigest", "deadlineAt", "writeEffect", "input", "fixture" });
            Require(request, "apiVersion", ApiVersion);
            Require(request, "pluginId", PluginId);
            Require(request, "pluginVersion", PluginVersion);
            string pluginVersionId = RequiredEnvironment("GCAC_PLUGIN_VERSION_ID", IdentifierPattern);
            if (RequiredIdentifier(request, "pluginVersionId") != pluginVersionId) throw Reject("AGENT_SIDE_BINDING_INVALID", "PluginVersionId 未绑定适配器注入值");
            string agentId = RequiredIdentifier(request, "agentId");
            string tenantId = RequiredIdentifier(request, "tenantId");
            string capability = RequiredIdentifier(request, "capability");
            string operation = RequiredOperation(request, capability);
            bool expectedWrite = operation == "update-binding" || operation == "rollback-binding";
            if (writeEffect != expectedWrite) throw Reject("AGENT_SIDE_REQUEST_INVALID", "writeEffect 与固定 IIS 操作不一致");
            RequiredDeadline(request, "deadlineAt");

            string planDigest = RequiredDigest(request, "planDigest");
            RequireEnvironmentHash(request, "packageHash", "GCAC_PLUGIN_PACKAGE_HASH");
            RequireEnvironmentHash(request, "manifestHash", "GCAC_PLUGIN_MANIFEST_HASH");
            RequireEnvironmentHash(request, "resourceHash", "GCAC_PLUGIN_RESOURCE_HASH");

            Dictionary<string, object> token = RequiredDictionary(request, "token");
            Dictionary<string, object> decision = RequiredDictionary(request, "policyDecision");
            Dictionary<string, object> receipt = RequiredDictionary(request, "receipt");
            Dictionary<string, object> grant = RequiredDictionary(request, "grant");
            Dictionary<string, object> localPolicy = RequiredDictionary(request, "localPolicy");
            string nonce = RequiredIdentifier(request, "nonce");
            ValidateToken(token, agentId, tenantId, pluginVersionId, capability, operation, planDigest, nonce);
            ValidateDecision(decision, agentId, tenantId, pluginVersionId, capability, operation, planDigest, nonce, token["tokenId"] as string);
            ValidateGrant(grant, agentId, tenantId, pluginVersionId, operation, planDigest, nonce);
            ValidateReceipt(receipt, agentId, tenantId, planDigest, nonce, token["tokenId"] as string);
            ValidateLocalPolicy(localPolicy, agentId, operation);
            string grantId = RequiredIdentifier(grant, "grantId");
            string[] grantRefs = RequiredIdentifiers(request, "grantRefs");
            if (Array.IndexOf(grantRefs, grantId) < 0) throw Reject("AGENT_SIDE_GRANT_DENIED", "Grant 引用未绑定到当前请求");
            if (expectedWrite && !ContainsString(Strings(grant["allowedActions"], "grant.allowedActions"), operation)) throw Reject("AGENT_SIDE_GRANT_DENIED", "Grant 未授权 IIS 写操作");
            if (request.ContainsKey("fixture")) ValidateFixtureMode(request["fixture"]);
            return new Authorization
            {
                AgentId = agentId,
                TenantId = tenantId,
                PluginVersionId = pluginVersionId,
                Capability = capability,
                Operation = operation,
                PlanDigest = planDigest,
                Nonce = nonce,
                TokenId = RequiredIdentifier(token, "tokenId"),
                GrantId = grantId,
                Receipt = receipt
            };
        }

        private static Dictionary<string, object> Execute(Dictionary<string, object> request, Authorization authorization, ref bool writeStarted)
        {
            Dictionary<string, object> fixture = OptionalDictionary(request, "fixture");
            if (authorization.Operation == "discover") return Discover(request, authorization, fixture);
            if (authorization.Operation == "capture-binding") return CaptureBinding(request, authorization, fixture);
            if (authorization.Operation == "verify-binding") return VerifyBinding(request, authorization, fixture);
            if (authorization.Operation == "update-binding") return UpdateBinding(request, authorization, fixture, ref writeStarted);
            if (authorization.Operation == "rollback-binding") return RollbackBinding(request, authorization, fixture, ref writeStarted);
            throw Reject("AGENT_SIDE_OPERATION_UNSUPPORTED", "IIS 操作未登记");
        }

        private static Dictionary<string, object> Discover(Dictionary<string, object> request, Authorization authorization, Dictionary<string, object> fixture)
        {
            Dictionary<string, object> facts = fixture == null ? CollectLiveFacts() : NormalizeFacts(RequiredDictionary(fixture, "facts"));
            return Success(authorization, new Dictionary<string, object> { { "facts", facts }, { "requestCount", 1 } });
        }

        private static Dictionary<string, object> CaptureBinding(Dictionary<string, object> request, Authorization authorization, Dictionary<string, object> fixture)
        {
            Dictionary<string, object> binding = fixture == null
                ? ReadLiveBinding(RequiredInput(request, "siteName"), RequiredInput(request, "bindingInformation"))
                : FindFixtureBinding(fixture, RequiredInput(request, "siteName"), RequiredInput(request, "bindingInformation"));
            return Success(authorization, new Dictionary<string, object> { { "binding", binding }, { "verified", true } });
        }

        private static Dictionary<string, object> VerifyBinding(Dictionary<string, object> request, Authorization authorization, Dictionary<string, object> fixture)
        {
            string siteName = RequiredInput(request, "siteName");
            string bindingInformation = RequiredInput(request, "bindingInformation");
            Dictionary<string, object> binding = fixture == null ? ReadLiveBinding(siteName, bindingInformation) : FindFixtureBinding(fixture, siteName, bindingInformation);
            string expected = OptionalInput(request, "certificateThumbprint");
            if (!IsBlank(expected) && !SameThumbprint(expected, RequiredString(binding, "certificateThumbprint"))) throw Reject("AGENT_BINDING_VERIFY_FAILED", "IIS Binding 证书指纹不匹配");
            return Success(authorization, new Dictionary<string, object> { { "binding", binding }, { "verified", true } });
        }

        private static Dictionary<string, object> UpdateBinding(Dictionary<string, object> request, Authorization authorization, Dictionary<string, object> fixture, ref bool writeStarted)
        {
            string siteName = RequiredInput(request, "siteName");
            string bindingInformation = RequiredInput(request, "bindingInformation");
            string certificateThumbprint = RequiredInput(request, "certificateThumbprint");
            Dictionary<string, object> previous = fixture == null ? ReadLiveBinding(siteName, bindingInformation) : FindFixtureBinding(fixture, siteName, bindingInformation);
            Dictionary<string, object> updated;
            if (fixture != null)
            {
                ApplyFixtureWrite(fixture, ref writeStarted);
                updated = CopyBinding(previous);
                updated["certificateThumbprint"] = NormalizeThumbprint(certificateThumbprint);
            }
            else updated = UpdateLiveBinding(siteName, bindingInformation, certificateThumbprint, previous, ref writeStarted);
            if (!SameThumbprint(certificateThumbprint, RequiredString(updated, "certificateThumbprint"))) throw Reject("AGENT_BINDING_VERIFY_FAILED", "IIS Binding 写入后校验失败", true);
            return Success(authorization, new Dictionary<string, object> { { "previousBinding", previous }, { "binding", updated }, { "verified", true } });
        }

        private static Dictionary<string, object> RollbackBinding(Dictionary<string, object> request, Authorization authorization, Dictionary<string, object> fixture, ref bool writeStarted)
        {
            string siteName = RequiredInput(request, "siteName");
            string bindingInformation = RequiredInput(request, "bindingInformation");
            Dictionary<string, object> previous = RequiredDictionary(RequiredInputObject(request, "previousBinding"), "previousBinding");
            string thumbprint = RequiredString(previous, "certificateThumbprint");
            Dictionary<string, object> restored;
            if (fixture != null)
            {
                ApplyFixtureWrite(fixture, ref writeStarted);
                restored = CopyBinding(previous);
                restored["siteName"] = siteName;
                restored["bindingInformation"] = bindingInformation;
            }
            else restored = UpdateLiveBinding(siteName, bindingInformation, thumbprint, previous, ref writeStarted);
            if (!SameThumbprint(thumbprint, RequiredString(restored, "certificateThumbprint"))) throw Reject("AGENT_BINDING_VERIFY_FAILED", "IIS Binding 回滚后校验失败", true);
            return Success(authorization, new Dictionary<string, object> { { "binding", restored }, { "verified", true } });
        }

        private static void ApplyFixtureWrite(Dictionary<string, object> fixture, ref bool writeStarted)
        {
            Dictionary<string, object> writeResult = OptionalDictionary(fixture, "writeResult");
            if (writeResult == null) { writeStarted = true; return; }
            string status = RequiredString(writeResult, "status").ToUpperInvariant();
            if (status == "UNKNOWN" || ReadBoolean(writeResult, "transportError", false)) { writeStarted = true; throw Reject("AGENT_EXECUTION_UNKNOWN", "IIS Fixture 在写操作后失去连接", true, true); }
            if (status != "SUCCESS") throw Reject("AGENT_OPERATION_FAILED", "IIS Fixture 拒绝写操作", false);
            writeStarted = true;
        }

        private static Dictionary<string, object> UpdateLiveBinding(string siteName, string bindingInformation, string thumbprint, Dictionary<string, object> previous, ref bool writeStarted)
        {
            object manager = null;
            try
            {
                manager = CreateServerManager();
                BindingLocation location = FindLiveBinding(manager, siteName, bindingInformation);
                SetProperty(location.Binding, "CertificateHash", HexBytes(NormalizeThumbprint(thumbprint)));
                SetProperty(location.Binding, "CertificateStoreName", OptionalText(previous, "certificateStoreName") ?? "My");
                writeStarted = true;
                Call(manager, "CommitChanges");
                Dictionary<string, object> verified = ReadLiveBinding(manager, siteName, bindingInformation);
                if (!SameThumbprint(thumbprint, RequiredString(verified, "certificateThumbprint")))
                {
                    TryRestoreLiveBinding(manager, location, previous);
                    throw Reject("AGENT_BINDING_VERIFY_FAILED", "IIS Binding 写入后校验失败", true);
                }
                return verified;
            }
            catch (PluginException) { throw; }
            catch (Exception error) { throw Reject("AGENT_EXECUTION_UNKNOWN", "IIS CommitChanges 结果无法确认", true, true, error); }
            finally { Dispose(manager); }
        }

        private static void TryRestoreLiveBinding(object manager, BindingLocation location, Dictionary<string, object> previous)
        {
            try
            {
                SetProperty(location.Binding, "CertificateHash", HexBytes(RequiredString(previous, "certificateThumbprint")));
                SetProperty(location.Binding, "CertificateStoreName", OptionalText(previous, "certificateStoreName") ?? "My");
                Call(manager, "CommitChanges");
            }
            catch { }
        }

        private static Dictionary<string, object> CollectLiveFacts()
        {
            object manager = null;
            try
            {
                manager = CreateServerManager();
                List<Dictionary<string, object>> sites = new List<Dictionary<string, object>>();
                List<Dictionary<string, object>> bindings = new List<Dictionary<string, object>>();
                foreach (object site in Items(GetProperty(manager, "Sites")))
                {
                    string siteName = RequiredStringValue(GetProperty(site, "Name"), "IIS site.name");
                    sites.Add(new Dictionary<string, object> { { "name", siteName }, { "addresses", new string[] { "*" } } });
                    foreach (object binding in Items(GetProperty(site, "Bindings"))) bindings.Add(BindingDictionary(siteName, binding));
                }
                return new Dictionary<string, object> { { "iisVersion", "Microsoft.Web.Administration" }, { "machineName", Environment.MachineName }, { "sites", sites }, { "bindings", bindings } };
            }
            finally { Dispose(manager); }
        }

        private static Dictionary<string, object> ReadLiveBinding(string siteName, string bindingInformation)
        {
            object manager = null;
            try { manager = CreateServerManager(); return ReadLiveBinding(manager, siteName, bindingInformation); }
            finally { Dispose(manager); }
        }

        private static Dictionary<string, object> ReadLiveBinding(object manager, string siteName, string bindingInformation)
        {
            BindingLocation location = FindLiveBinding(manager, siteName, bindingInformation);
            return BindingDictionary(siteName, location.Binding);
        }

        private static BindingLocation FindLiveBinding(object manager, string siteName, string bindingInformation)
        {
            foreach (object site in Items(GetProperty(manager, "Sites")))
            {
                if (!string.Equals(RequiredStringValue(GetProperty(site, "Name"), "IIS site.name"), siteName, StringComparison.Ordinal)) continue;
                foreach (object binding in Items(GetProperty(site, "Bindings")))
                {
                    if (string.Equals(RequiredStringValue(GetProperty(binding, "BindingInformation"), "bindingInformation"), bindingInformation, StringComparison.Ordinal)) return new BindingLocation { Site = site, Binding = binding };
                }
            }
            throw Reject("AGENT_BINDING_NOT_FOUND", "IIS Binding 不存在");
        }

        private static Dictionary<string, object> FindFixtureBinding(Dictionary<string, object> fixture, string siteName, string bindingInformation)
        {
            object raw = fixture.ContainsKey("bindings") ? fixture["bindings"] : null;
            IList values = raw as IList;
            if (values == null) throw Reject("AGENT_FIXTURE_INVALID", "IIS Fixture 缺少 bindings");
            foreach (object item in values)
            {
                Dictionary<string, object> binding = item as Dictionary<string, object>;
                if (binding == null) throw Reject("AGENT_FIXTURE_INVALID", "IIS Fixture binding 必须是对象");
                if (string.Equals(OptionalText(binding, "siteName"), siteName, StringComparison.Ordinal) && string.Equals(OptionalText(binding, "bindingInformation"), bindingInformation, StringComparison.Ordinal)) return NormalizeBinding(binding);
            }
            throw Reject("AGENT_BINDING_NOT_FOUND", "IIS Fixture Binding 不存在");
        }

        private static Dictionary<string, object> NormalizeFacts(Dictionary<string, object> raw)
        {
            string version = RequiredString(raw, "iisVersion");
            string machine = RequiredString(raw, "machineName");
            IList rawSites = RequiredList(raw, "sites");
            IList rawBindings = RequiredList(raw, "bindings");
            List<Dictionary<string, object>> sites = new List<Dictionary<string, object>>();
            foreach (object item in rawSites) sites.Add(NormalizeSite(item as Dictionary<string, object>));
            List<Dictionary<string, object>> bindings = new List<Dictionary<string, object>>();
            foreach (object item in rawBindings) bindings.Add(NormalizeBinding(item as Dictionary<string, object>));
            return new Dictionary<string, object> { { "iisVersion", version }, { "machineName", machine }, { "sites", sites }, { "bindings", bindings } };
        }

        private static Dictionary<string, object> NormalizeSite(Dictionary<string, object> site)
        {
            if (site == null) throw Reject("AGENT_FIXTURE_INVALID", "IIS site 必须是对象");
            string name = RequiredString(site, "name");
            IList addresses = site.ContainsKey("addresses") ? site["addresses"] as IList : null;
            List<string> safeAddresses = new List<string>();
            if (addresses != null) foreach (object address in addresses) if (!IsBlank(Convert.ToString(address, CultureInfo.InvariantCulture))) safeAddresses.Add(Convert.ToString(address, CultureInfo.InvariantCulture));
            if (safeAddresses.Count == 0) safeAddresses.Add("*");
            Dictionary<string, object> result = new Dictionary<string, object> { { "name", name }, { "addresses", safeAddresses.ToArray() } };
            string applicationPool = OptionalText(site, "applicationPool");
            if (!IsBlank(applicationPool)) result["applicationPool"] = applicationPool;
            if (site.ContainsKey("port")) result["port"] = RequiredInteger(site, "port");
            return result;
        }

        private static Dictionary<string, object> NormalizeBinding(Dictionary<string, object> binding)
        {
            if (binding == null) throw Reject("AGENT_FIXTURE_INVALID", "IIS binding 必须是对象");
            Dictionary<string, object> result = new Dictionary<string, object>
            {
                { "siteName", RequiredString(binding, "siteName") },
                { "bindingInformation", RequiredString(binding, "bindingInformation") },
                { "protocol", RequiredString(binding, "protocol").ToLowerInvariant() },
                { "certificateThumbprint", NormalizeThumbprint(RequiredString(binding, "certificateThumbprint")) },
                { "certificateStoreName", OptionalText(binding, "certificateStoreName") ?? "My" }
            };
            foreach (string key in new string[] { "hostName", "subject", "issuer", "notAfter", "sha256Fingerprint" })
            {
                string value = OptionalText(binding, key);
                if (!IsBlank(value)) result[key] = key == "sha256Fingerprint" ? RequiredSha256(value) : value;
            }
            return result;
        }

        private static Dictionary<string, object> BindingDictionary(string siteName, object binding)
        {
            byte[] certificateHash = GetProperty(binding, "CertificateHash") as byte[];
            Dictionary<string, object> result = new Dictionary<string, object>
            {
                { "siteName", siteName },
                { "bindingInformation", RequiredStringValue(GetProperty(binding, "BindingInformation"), "bindingInformation") },
                { "protocol", RequiredStringValue(GetProperty(binding, "Protocol"), "protocol").ToLowerInvariant() },
                { "certificateThumbprint", certificateHash == null ? string.Empty : Hex(certificateHash) },
                { "certificateStoreName", Convert.ToString(GetProperty(binding, "CertificateStoreName"), CultureInfo.InvariantCulture) ?? "My" }
            };
            string[] parts = result["bindingInformation"].ToString().Split(new char[] { ':' });
            if (parts.Length >= 3) result["hostName"] = parts[2];
            return result;
        }

        private static object CreateServerManager()
        {
            Type type = Type.GetType("Microsoft.Web.Administration.ServerManager, Microsoft.Web.Administration", false);
            if (type == null) throw Reject("AGENT_IIS_API_UNAVAILABLE", "Microsoft.Web.Administration 未安装");
            try { return Activator.CreateInstance(type); }
            catch { throw Reject("AGENT_IIS_API_UNAVAILABLE", "IIS 管理程序集无法实例化"); }
        }

        private static object GetProperty(object target, string name)
        {
            if (target == null) throw Reject("AGENT_IIS_API_UNAVAILABLE", "IIS API 返回空对象");
            PropertyInfo property = target.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (property == null) throw Reject("AGENT_IIS_API_UNAVAILABLE", "IIS API 缺少固定属性");
            return property.GetValue(target, null);
        }

        private static void SetProperty(object target, string name, object value)
        {
            PropertyInfo property = target.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (property == null || !property.CanWrite) throw Reject("AGENT_IIS_API_UNAVAILABLE", "IIS API 缺少固定可写属性");
            property.SetValue(target, value, null);
        }

        private static object Call(object target, string name)
        {
            MethodInfo method = target.GetType().GetMethod(name, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (method == null) throw Reject("AGENT_IIS_API_UNAVAILABLE", "IIS API 缺少固定方法");
            try { return method.Invoke(target, null); }
            catch (TargetInvocationException error) { throw error.InnerException ?? error; }
        }

        private static IEnumerable Items(object value)
        {
            IEnumerable items = value as IEnumerable;
            if (items == null) throw Reject("AGENT_IIS_API_UNAVAILABLE", "IIS API 集合无效");
            return items;
        }

        private static void Dispose(object value)
        {
            IDisposable disposable = value as IDisposable;
            if (disposable != null) disposable.Dispose();
        }

        private static Dictionary<string, object> Success(Authorization authorization, Dictionary<string, object> fields)
        {
            Dictionary<string, object> result = new Dictionary<string, object> { { "status", "SUCCESS" }, { "operation", authorization.Operation }, { "receipt", ReceiptReference(authorization.Receipt, authorization.PlanDigest, authorization.Nonce) } };
            foreach (KeyValuePair<string, object> item in fields) result[item.Key] = item.Value;
            return result;
        }

        private static Dictionary<string, object> ReceiptReference(Dictionary<string, object> receipt, string planDigest, string nonce)
        {
            return new Dictionary<string, object> { { "planDigest", planDigest }, { "nonce", nonce }, { "digest", RequiredHash(receipt, "digest") }, { "status", RequiredString(receipt, "status") } };
        }

        private static Dictionary<string, object> Failure(string requestId, string status, string code, string message, bool writeStarted)
        {
            return new Dictionary<string, object>
            {
                { "apiVersion", ApiVersion }, { "requestId", requestId }, { "pluginId", PluginId }, { "pluginVersion", PluginVersion },
                { "status", status }, { "writeStarted", writeStarted }, { "error", new Dictionary<string, object> { { "code", code }, { "message", message }, { "secretRedacted", true } } },
            };
        }

        private static void ValidateToken(Dictionary<string, object> token, string agentId, string tenantId, string pluginVersionId, string capability, string operation, string planDigest, string nonce)
        {
            RequireFields(token, new string[] { "tokenVersion", "tokenId", "agentId", "tenantId", "pluginId", "pluginVersionId", "capability", "actions", "planDigest", "nonce", "signature" }, "Token");
            Require(token, "tokenVersion", "gcac.agent-security/v1");
            ValidateIdentity(token, agentId, tenantId, pluginVersionId, capability);
            if (!ContainsString(Strings(token["actions"], "Token.actions"), operation)) throw Reject("AGENT_SIDE_AUTHORIZATION_DENIED", "Token 未授权固定 IIS 操作");
            if (RequiredDigest(token, "planDigest") != planDigest || RequiredIdentifier(token, "nonce") != nonce || IsBlank(RequiredString(token, "signature"))) throw Reject("AGENT_SIDE_AUTHORIZATION_DENIED", "Token 绑定字段缺失");
        }

        private static void ValidateDecision(Dictionary<string, object> decision, string agentId, string tenantId, string pluginVersionId, string capability, string operation, string planDigest, string nonce, string tokenId)
        {
            RequireFields(decision, new string[] { "decisionVersion", "decisionId", "allowed", "agentId", "tenantId", "pluginId", "pluginVersionId", "capability", "actions", "planDigest", "tokenId", "nonce", "signature" }, "Policy Decision");
            Require(decision, "decisionVersion", "gcac.agent-security/v1");
            if (!ReadBoolean(decision, "allowed", false)) throw Reject("AGENT_SIDE_AUTHORIZATION_DENIED", "Policy Authority Decision 拒绝执行");
            ValidateIdentity(decision, agentId, tenantId, pluginVersionId, capability);
            if (!ContainsString(Strings(decision["actions"], "Decision.actions"), operation)) throw Reject("AGENT_SIDE_AUTHORIZATION_DENIED", "Decision 未授权固定 IIS 操作");
            if (RequiredDigest(decision, "planDigest") != planDigest || RequiredIdentifier(decision, "tokenId") != tokenId || RequiredIdentifier(decision, "nonce") != nonce || IsBlank(RequiredString(decision, "signature"))) throw Reject("AGENT_SIDE_AUTHORIZATION_DENIED", "Decision 绑定字段缺失");
        }

        private static void ValidateGrant(Dictionary<string, object> grant, string agentId, string tenantId, string pluginVersionId, string operation, string planDigest, string nonce)
        {
            RequireFields(grant, new string[] { "grantId", "agentId", "tenantId", "pluginId", "pluginVersionId", "allowedActions", "artifactDigests", "planDigest", "nonce" }, "Grant");
            if (RequiredIdentifier(grant, "agentId") != agentId || RequiredIdentifier(grant, "tenantId") != tenantId || RequiredString(grant, "pluginId") != PluginId || RequiredIdentifier(grant, "pluginVersionId") != pluginVersionId) throw Reject("AGENT_SIDE_GRANT_DENIED", "Grant 身份绑定不一致");
            if (RequiredDigest(grant, "planDigest") != planDigest || RequiredIdentifier(grant, "nonce") != nonce) throw Reject("AGENT_SIDE_GRANT_DENIED", "Grant 绑定字段缺失");
            Strings(grant["allowedActions"], "Grant.allowedActions");
            foreach (object digest in List(grant["artifactDigests"], "Grant.artifactDigests")) if (!HashRegex.IsMatch(Convert.ToString(digest, CultureInfo.InvariantCulture))) throw Reject("AGENT_SIDE_GRANT_DENIED", "Grant Artifact 摘要无效");
        }

        private static void ValidateReceipt(Dictionary<string, object> receipt, string agentId, string tenantId, string planDigest, string nonce, string tokenId)
        {
            RequireFields(receipt, new string[] { "receiptVersion", "planId", "planDigest", "agentId", "tenantId", "tokenId", "nonce", "status", "digest" }, "Receipt");
            Require(receipt, "receiptVersion", "gcac.agent-security/v1");
            if (RequiredDigest(receipt, "planDigest") != planDigest || RequiredIdentifier(receipt, "agentId") != agentId || RequiredIdentifier(receipt, "tenantId") != tenantId || RequiredIdentifier(receipt, "tokenId") != tokenId || RequiredIdentifier(receipt, "nonce") != nonce) throw Reject("AGENT_SIDE_RECEIPT_INVALID", "Receipt 绑定字段不一致");
            string status = RequiredString(receipt, "status");
            if (status != "PENDING" && status != "SUCCESS" && status != "FAILED" && status != "UNKNOWN") throw Reject("AGENT_SIDE_RECEIPT_INVALID", "Receipt 状态无效");
            RequiredHash(receipt, "digest");
        }

        private static void ValidateLocalPolicy(Dictionary<string, object> policy, string agentId, string operation)
        {
            RequireFields(policy, new string[] { "policyVersion", "agentId", "allowedActions", "disabled" }, "本地策略");
            if (RequiredIdentifier(policy, "agentId") != agentId || ReadBoolean(policy, "disabled", true)) throw Reject("AGENT_SIDE_POLICY_UNAVAILABLE", "Agent 本地策略缺失或已禁用");
            if (!ContainsString(Strings(policy["allowedActions"], "LocalPolicy.allowedActions"), operation)) throw Reject("AGENT_SIDE_POLICY_DENIED", "本地策略未授权固定 IIS 操作");
        }

        private static void ValidateIdentity(Dictionary<string, object> value, string agentId, string tenantId, string pluginVersionId, string capability)
        {
            if (RequiredIdentifier(value, "agentId") != agentId || RequiredIdentifier(value, "tenantId") != tenantId || RequiredString(value, "pluginId") != PluginId || RequiredIdentifier(value, "pluginVersionId") != pluginVersionId || RequiredIdentifier(value, "capability") != capability) throw Reject("AGENT_SIDE_AUTHORIZATION_DENIED", "授权身份绑定不一致");
        }

        private static string RequiredOperation(Dictionary<string, object> request, string capability)
        {
            string operation = RequiredString(request, "operation");
            string expectedCapability;
            if (operation == "discover") expectedCapability = "application.discover";
            else if (operation == "capture-binding" || operation == "update-binding") expectedCapability = "certificate.deploy";
            else if (operation == "verify-binding") expectedCapability = "certificate.verify";
            else if (operation == "rollback-binding") expectedCapability = "certificate.rollback";
            else throw Reject("AGENT_SIDE_OPERATION_UNSUPPORTED", "IIS 操作未登记");
            if (expectedCapability != capability) throw Reject("AGENT_SIDE_BINDING_INVALID", "IIS 操作与 Capability 未绑定");
            return operation;
        }

        private static void ValidateFixtureMode(object value)
        {
            Dictionary<string, object> fixture = value as Dictionary<string, object>;
            if (fixture == null || RequiredString(fixture, "mode") != "DEVELOPMENT") throw Reject("AGENT_FIXTURE_DENIED", "只有显式 DEVELOPMENT Fixture 才能替代 IIS API");
        }

        private static void RequireEnvironmentHash(Dictionary<string, object> request, string field, string environmentName)
        {
            string expected = RequiredEnvironment(environmentName, HashRegex);
            if (RequiredHash(request, field) != expected) throw Reject("AGENT_SIDE_BINDING_INVALID", field + " 未绑定适配器摘要");
        }

        private static string RequiredEnvironment(string name, Regex pattern)
        {
            string value = Environment.GetEnvironmentVariable(name);
            if (IsBlank(value) || !pattern.IsMatch(value)) throw Reject("AGENT_SIDE_TRUST_MATERIAL_MISSING", name + " 缺失或无效");
            return value;
        }

        private static void Require(Dictionary<string, object> value, string key, string expected)
        {
            if (!value.ContainsKey(key) || !string.Equals(Convert.ToString(value[key], CultureInfo.InvariantCulture), expected, StringComparison.Ordinal)) throw Reject("AGENT_SIDE_REQUEST_INVALID", key + " 未固定为标准值");
        }

        private static void RequireExact(Dictionary<string, object> value, string[] fields)
        {
            foreach (string key in value.Keys) if (Array.IndexOf(fields, key) < 0) throw Reject("AGENT_SIDE_REQUEST_INVALID", "请求包含未知字段");
        }

        private static void RequireFields(Dictionary<string, object> value, string[] fields, string name)
        {
            foreach (string field in fields) if (!value.ContainsKey(field)) throw Reject("AGENT_SIDE_AUTHORIZATION_MISSING", name + " 缺少固定字段");
        }

        private static Dictionary<string, object> RequiredDictionary(Dictionary<string, object> value, string key)
        {
            Dictionary<string, object> result = value.ContainsKey(key) ? value[key] as Dictionary<string, object> : null;
            if (result == null) throw Reject("AGENT_SIDE_AUTHORIZATION_MISSING", key + " 必须是对象");
            return result;
        }

        private static Dictionary<string, object> OptionalDictionary(Dictionary<string, object> value, string key)
        {
            if (!value.ContainsKey(key) || value[key] == null) return null;
            Dictionary<string, object> result = value[key] as Dictionary<string, object>;
            if (result == null) throw Reject("AGENT_SIDE_REQUEST_INVALID", key + " 必须是对象");
            return result;
        }

        private static Dictionary<string, object> RequiredInputObject(Dictionary<string, object> request, string key)
        {
            Dictionary<string, object> input = RequiredDictionary(request, "input");
            return RequiredDictionary(input, key);
        }

        private static Dictionary<string, object> RequiredInputDictionary(Dictionary<string, object> request)
        {
            return RequiredDictionary(request, "input");
        }

        private static string RequiredInput(Dictionary<string, object> request, string key)
        {
            return RequiredString(RequiredInputDictionary(request), key);
        }

        private static string OptionalInput(Dictionary<string, object> request, string key)
        {
            return OptionalText(RequiredInputDictionary(request), key);
        }

        private static string RequiredString(Dictionary<string, object> value, string key)
        {
            if (!value.ContainsKey(key) || !(value[key] is string) || IsBlank((string)value[key])) throw Reject("AGENT_SIDE_REQUEST_INVALID", key + " 缺失");
            return (string)value[key];
        }

        private static string RequiredIdentifier(Dictionary<string, object> value, string key)
        {
            string result = RequiredString(value, key);
            if (!IdentifierPattern.IsMatch(result)) throw Reject("AGENT_SIDE_REQUEST_INVALID", key + " 不是固定标识符");
            return result;
        }

        private static string RequiredHash(Dictionary<string, object> value, string key)
        {
            string result = RequiredString(value, key);
            if (!HashRegex.IsMatch(result)) throw Reject("AGENT_SIDE_TRUST_MATERIAL_MISSING", key + " 不是固定摘要");
            return result;
        }

        private static string RequiredDigest(Dictionary<string, object> value, string key)
        {
            string result = RequiredString(value, key);
            if (!DigestRegex.IsMatch(result)) throw Reject("AGENT_SIDE_TRUST_MATERIAL_MISSING", key + " 不是固定计划摘要");
            return result;
        }

        private static string RequiredSha256(string value)
        {
            if (IsBlank(value) || !Regex.IsMatch(value, "^[a-fA-F0-9]{64}$")) throw Reject("AGENT_FIXTURE_INVALID", "sha256Fingerprint 无效");
            return value.ToLowerInvariant();
        }

        private static int RequiredInteger(Dictionary<string, object> value, string key)
        {
            if (!value.ContainsKey(key)) throw Reject("AGENT_FIXTURE_INVALID", key + " 缺失");
            try { int result = Convert.ToInt32(value[key], CultureInfo.InvariantCulture); if (result < 0 || result > 65535) throw new Exception(); return result; }
            catch { throw Reject("AGENT_FIXTURE_INVALID", key + " 必须是非负整数"); }
        }

        private static DateTime RequiredDeadline(Dictionary<string, object> value, string key)
        {
            DateTime deadline;
            if (!DateTime.TryParse(RequiredString(value, key), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out deadline) || deadline <= DateTime.UtcNow) throw Reject("AGENT_SIDE_DEADLINE_EXPIRED", "请求已超过固定截止时间");
            return deadline;
        }

        private static bool ReadBoolean(Dictionary<string, object> value, string key, bool defaultValue)
        {
            if (!value.ContainsKey(key)) return defaultValue;
            if (!(value[key] is bool)) throw Reject("AGENT_SIDE_REQUEST_INVALID", key + " 必须是布尔值");
            return (bool)value[key];
        }

        private static string[] RequiredIdentifiers(Dictionary<string, object> value, string key)
        {
            if (!value.ContainsKey(key)) throw Reject("AGENT_SIDE_GRANT_DENIED", key + " 缺失");
            return Strings(value[key], key);
        }

        private static string[] Strings(object value, string name)
        {
            List<string> result = new List<string>();
            foreach (object item in List(value, name))
            {
                string text = Convert.ToString(item, CultureInfo.InvariantCulture);
                if (IsBlank(text) || !IdentifierPattern.IsMatch(text)) throw Reject("AGENT_SIDE_REQUEST_INVALID", name + " 包含无效标识符");
                result.Add(text);
            }
            return result.ToArray();
        }

        private static IList List(object value, string name)
        {
            IList result = value as IList;
            if (result == null) throw Reject("AGENT_SIDE_REQUEST_INVALID", name + " 必须是数组");
            return result;
        }

        private static IList RequiredList(Dictionary<string, object> value, string key)
        {
            if (!value.ContainsKey(key)) throw Reject("AGENT_FIXTURE_INVALID", key + " 缺失");
            return List(value[key], key);
        }

        private static int? OptionalInteger(Dictionary<string, object> value, string key)
        {
            if (!value.ContainsKey(key)) return null;
            return RequiredInteger(value, key);
        }

        private static string OptionalText(Dictionary<string, object> value, string key)
        {
            if (!value.ContainsKey(key) || value[key] == null) return null;
            return value[key] is string ? (string)value[key] : null;
        }

        private static string RequiredStringValue(object value, string name)
        {
            if (!(value is string) || IsBlank((string)value)) throw Reject("AGENT_IIS_API_UNAVAILABLE", name + " 缺失");
            return (string)value;
        }

        private static string NormalizeThumbprint(string value)
        {
            string result = value == null ? string.Empty : value.Replace(" ", string.Empty).Replace("\t", string.Empty).ToUpperInvariant();
            if (IsBlank(result) || !Regex.IsMatch(result, "^[A-F0-9]{40,128}$")) throw Reject("AGENT_BINDING_INVALID", "IIS 证书指纹格式无效");
            return result;
        }

        private static bool SameThumbprint(string left, string right)
        {
            return string.Equals(NormalizeThumbprint(left), NormalizeThumbprint(right), StringComparison.OrdinalIgnoreCase);
        }

        private static Dictionary<string, object> CopyBinding(Dictionary<string, object> value)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> item in value) result[item.Key] = item.Value;
            return result;
        }

        private static byte[] HexBytes(string value)
        {
            string normalized = NormalizeThumbprint(value);
            if ((normalized.Length & 1) != 0) throw Reject("AGENT_BINDING_INVALID", "证书指纹字节长度无效");
            byte[] result = new byte[normalized.Length / 2];
            for (int index = 0; index < result.Length; index++) result[index] = Convert.ToByte(normalized.Substring(index * 2, 2), 16);
            return result;
        }

        private static string Hex(byte[] value)
        {
            if (value == null) return string.Empty;
            StringBuilder result = new StringBuilder(value.Length * 2);
            foreach (byte item in value) result.Append(item.ToString("X2", CultureInfo.InvariantCulture));
            return result.ToString();
        }

        private static bool ContainsString(string[] values, string expected)
        {
            foreach (string value in values) if (string.Equals(value, expected, StringComparison.Ordinal)) return true;
            return false;
        }

        private static bool IsBlank(string value)
        {
            return string.IsNullOrEmpty(value) || value.Trim().Length == 0;
        }

        private static string SafeRequestId(Dictionary<string, object> request)
        {
            if (request == null || !request.ContainsKey("requestId") || !(request["requestId"] is string) || !IdentifierPattern.IsMatch((string)request["requestId"])) return "invalid-request";
            return (string)request["requestId"];
        }

        private static PluginException Reject(string code, string message)
        {
            return new PluginException(code, message, false, false, null);
        }

        private static PluginException Reject(string code, string message, bool writeStarted)
        {
            return new PluginException(code, message, writeStarted, false, null);
        }

        private static PluginException Reject(string code, string message, bool writeStarted, bool unknown)
        {
            return new PluginException(code, message, writeStarted, unknown, null);
        }

        private static PluginException Reject(string code, string message, bool writeStarted, bool unknown, Exception inner)
        {
            return new PluginException(code, message, writeStarted, unknown, inner);
        }

        private sealed class Authorization
        {
            internal string AgentId;
            internal string TenantId;
            internal string PluginVersionId;
            internal string Capability;
            internal string Operation;
            internal string PlanDigest;
            internal string Nonce;
            internal string TokenId;
            internal string GrantId;
            internal Dictionary<string, object> Receipt;
        }

        private sealed class BindingLocation
        {
            internal object Site;
            internal object Binding;
        }

        private sealed class PluginException : Exception
        {
            internal readonly string Code;
            internal readonly bool WriteStarted;
            internal readonly bool Unknown;

            internal PluginException(string code, string message, bool writeStarted, bool unknown, Exception inner)
                : base(message, inner)
            {
                Code = code;
                WriteStarted = writeStarted;
                Unknown = unknown;
            }
        }
    }
}
