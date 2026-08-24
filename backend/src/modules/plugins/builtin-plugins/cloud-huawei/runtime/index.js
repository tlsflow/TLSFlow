import { createContractOnlyPlugin } from './shared.js';

const PROVIDER_KEY = 'cloud.huawei';
const PROVIDER_NAME = '华为云';

export default async function createProviderPlugin({ plugin } = {}) {
  return createContractOnlyPlugin(plugin, PROVIDER_NAME, PROVIDER_KEY);
}
