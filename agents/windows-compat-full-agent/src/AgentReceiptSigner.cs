using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace GCAC.WindowsCompatibilityAgent
{
    /// <summary>
    /// Agent 自有 Receipt 签名器。私钥只在本地使用，公钥必须来自部署的受信 KeySet。
    /// </summary>
    internal sealed class AgentReceiptSigner
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
        private static readonly Regex IdentifierPattern = new Regex("^[A-Za-z0-9._:-]{1,256}$", RegexOptions.Compiled);
        private readonly string keyId;
        private readonly string agentId;
        private readonly byte[] privateKey;
        private readonly string publicKeyPem;

        private AgentReceiptSigner(string keyId, string agentId, byte[] privateKey, string publicKeyPem)
        {
            this.keyId = keyId;
            this.agentId = agentId;
            this.privateKey = privateKey;
            this.publicKeyPem = publicKeyPem;
        }

        internal string KeyId { get { return keyId; } }

        internal static AgentReceiptSigner Load(AgentConfig config, string agentId)
        {
            if (config == null || TextUtility.IsBlank(agentId)) Unavailable("Agent Receipt 签名配置未装配");
            string keyId = RequiredIdentifier(config.receiptKeyId, "receiptKeyId");
            if (IsDevelopmentKey(keyId)) Unavailable("Agent Receipt 签名 KeyId 不得使用开发默认值");
            if (TextUtility.IsBlank(config.receiptSigningKeyPath) || !File.Exists(config.receiptSigningKeyPath))
                Unavailable("Agent Receipt 签名私钥缺失");
            if (TextUtility.IsBlank(config.receiptKeySetPath) || !File.Exists(config.receiptKeySetPath))
                Unavailable("Agent Receipt 受信 KeySet 缺失");

            byte[] privateKey = ReadPrivateKey(config.receiptSigningKeyPath);
            Dictionary<string, object> keySet;
            try { keySet = Serializer.DeserializeObject(File.ReadAllText(config.receiptKeySetPath)) as Dictionary<string, object>; }
            catch { Unavailable("Agent Receipt 受信 KeySet 无法解析"); return null; }
            if (keySet == null) Unavailable("Agent Receipt 受信 KeySet 格式无效");
            Dictionary<string, object> key = FindKey(keySet, keyId);
            if (RequiredString(key, "algorithm") != "Ed25519" || RequiredString(key, "status") != "ACTIVE")
                Unavailable("Agent Receipt 受信公钥不可用");
            if (RequiredString(key, "agentId") != agentId) Unavailable("Agent Receipt 签名密钥与 Agent 身份不匹配");
            string publicKeyPem = RequiredString(key, "publicKeyPem");
            byte[] expectedPublicKey;
            try { expectedPublicKey = Ed25519Verifier.PublicKeyFromPem(publicKeyPem); }
            catch { Unavailable("Agent Receipt 受信公钥格式无效"); return null; }
            if (!SameBytes(expectedPublicKey, Ed25519Verifier.PublicKeyFromSeed(privateKey)))
                Unavailable("Agent Receipt 签名私钥与受信公钥不匹配");
            return new AgentReceiptSigner(keyId, agentId, privateKey, publicKeyPem);
        }

        internal void Sign(Dictionary<string, object> receipt)
        {
            if (receipt == null || RequiredString(receipt, "agentId") != agentId) Unavailable("Receipt Agent 身份绑定无效");
            if (receipt.ContainsKey("agentKeyId") && RequiredString(receipt, "agentKeyId") != keyId)
                Unavailable("Receipt 签名密钥绑定无效");
            receipt["agentKeyId"] = keyId;
            receipt["signature"] = Ed25519Verifier.Sign(privateKey, Encoding.UTF8.GetBytes(global::GCAC.WindowsCompatibilityAgent.CanonicalJson.Serialize(RemoveSignature(receipt))));
        }

        internal void Verify(Dictionary<string, object> receipt)
        {
            if (receipt == null || RequiredString(receipt, "agentId") != agentId || RequiredIdentifier(Get(receipt, "agentKeyId"), "agentKeyId") != keyId)
                Reject("AGENT_RECEIPT_INVALID", "Receipt Agent 身份或签名密钥绑定不一致");
            string signature = RequiredString(receipt, "signature");
            if (!Ed25519Verifier.Verify(publicKeyPem, signature, Encoding.UTF8.GetBytes(global::GCAC.WindowsCompatibilityAgent.CanonicalJson.Serialize(RemoveSignature(receipt)))))
                Reject("AGENT_RECEIPT_INVALID", "Receipt Agent 签名校验失败");
        }

        internal static Dictionary<string, object> RemoveSignature(Dictionary<string, object> receipt)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> item in receipt)
                if (item.Key != "signature") result[item.Key] = item.Value;
            return result;
        }

        private static Dictionary<string, object> FindKey(Dictionary<string, object> keySet, string keyId)
        {
            object raw = null;
            if (!keySet.TryGetValue("keys", out raw) || !(raw is IList)) Unavailable("Agent Receipt 受信 KeySet 缺少 keys");
            foreach (object item in (IList)raw)
            {
                Dictionary<string, object> key = item as Dictionary<string, object>;
                if (key != null && RequiredString(key, "keyId") == keyId) return key;
            }
            Unavailable("Agent Receipt 签名 KeyId 未被受信 KeySet 登记");
            return null;
        }

        private static byte[] ReadPrivateKey(string path)
        {
            string value;
            try { value = File.ReadAllText(path).Trim(); }
            catch { Unavailable("Agent Receipt 签名私钥无法读取"); return null; }
            try
            {
                string normalized = value.Replace('-', '+').Replace('_', '/');
                while (normalized.Length % 4 != 0) normalized += "=";
                byte[] decoded = Convert.FromBase64String(normalized);
                if (decoded.Length == 32 || decoded.Length == 64) return decoded;
            }
            catch { }
            Unavailable("Agent Receipt 签名私钥必须是 Base64 编码的 Ed25519 32/64 字节密钥");
            return null;
        }

        private static string RequiredIdentifier(string value, string field)
        {
            if (TextUtility.IsBlank(value) || !IdentifierPattern.IsMatch(value)) Unavailable("Agent Receipt 字段无效：" + field);
            return value;
        }

        private static string RequiredString(Dictionary<string, object> value, string field)
        {
            object item = null;
            if (value == null || !value.TryGetValue(field, out item) || item == null || TextUtility.IsBlank(Convert.ToString(item, CultureInfo.InvariantCulture)))
                Unavailable("Agent Receipt 字段缺失：" + field);
            return Convert.ToString(item, CultureInfo.InvariantCulture);
        }

        private static string Get(Dictionary<string, object> value, string field)
        {
            object item;
            return value != null && value.TryGetValue(field, out item) && item != null ? Convert.ToString(item, CultureInfo.InvariantCulture) : string.Empty;
        }

        private static bool IsDevelopmentKey(string value)
        {
            string normalized = value.ToLowerInvariant();
            return normalized == "default" || normalized == "development" || normalized == "dev" || normalized == "test" || normalized == "agent-receipt-key-id" || normalized.IndexOf("development", StringComparison.Ordinal) >= 0;
        }

        private static bool SameBytes(byte[] left, byte[] right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            int difference = 0;
            for (int index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
            return difference == 0;
        }

        private static void Unavailable(string message)
        {
            throw new AgentV2SecurityException("AGENT_RECEIPT_SIGNER_UNAVAILABLE", message, false);
        }

        private static void Reject(string code, string message)
        {
            throw new AgentV2SecurityException(code, message, false);
        }
    }
}
