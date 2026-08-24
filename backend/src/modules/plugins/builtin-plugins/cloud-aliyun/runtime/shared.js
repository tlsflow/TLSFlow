/**
 * 云厂商插件当前只保留合同占位，禁止在没有真实版本和凭据时模拟生产能力。
 */
export function providerRuntimeError(message, details = {}) {
  const error = new Error(message);
  error.code = 'PROVIDER_EXTENSION_UNAVAILABLE';
  error.details = details;
  return error;
}

export function createContractOnlyPlugin(plugin, providerName, providerKey) {
  const missing = ['pluginId', 'pluginVersionId', 'capabilityKey'].filter((field) => !readString(plugin?.[field]));
  if (missing.length > 0 || readString(plugin?.providerKey) !== providerKey) {
    throw providerRuntimeError(`${providerName} 插件缺少固定 PluginVersion 合同上下文`, {
      providerKey,
      missing,
      mode: 'CONTRACT_FIXTURE_ONLY',
    });
  }

  const failClosed = async () => {
    throw providerRuntimeError(`${providerName} 插件尚未接入真实 PluginVersion、真实凭据和厂商 API，当前仅合同/Fixture`, {
      providerKey,
      pluginId: plugin.pluginId,
      pluginVersionId: plugin.pluginVersionId,
      mode: 'CONTRACT_FIXTURE_ONLY',
    });
  };

  return {
    runtimeMode: 'CONTRACT_FIXTURE_ONLY',
    testConnection: failClosed,
    discover: failClosed,
    deployCertificate: failClosed,
    rollbackCertificate: failClosed,
  };
}

function readString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
