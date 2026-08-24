import { createContractOnlyPlugin } from './shared.js';

const PROVIDER_KEY = 'cloud.aliyun';
const PROVIDER_NAME = '阿里云';

export default async function createProviderPlugin({ plugin } = {}) {
  return createContractOnlyPlugin(plugin, PROVIDER_NAME, PROVIDER_KEY);
}
