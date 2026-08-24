import { createContractOnlyPlugin } from './shared.js';

const PROVIDER_KEY = 'cloud.tencent';
const PROVIDER_NAME = '腾讯云';

export default async function createProviderPlugin({ plugin } = {}) {
  return createContractOnlyPlugin(plugin, PROVIDER_NAME, PROVIDER_KEY);
}
