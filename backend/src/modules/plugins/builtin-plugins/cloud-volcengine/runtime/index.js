import { createContractOnlyPlugin } from './shared.js';

const PROVIDER_KEY = 'cloud.volcengine';
const PROVIDER_NAME = '火山引擎';

export default async function createProviderPlugin({ plugin } = {}) {
  return createContractOnlyPlugin(plugin, PROVIDER_NAME, PROVIDER_KEY);
}
