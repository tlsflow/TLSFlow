export type ProductAdapterId = 'iis' | 'nginx' | 'apache' | 'tomcat';

export interface ProductOperationContract {
  discover: string[];
  mutate: string[];
  verify: string[];
  recover: string[];
  requiredPlatformCapabilities: string[];
}

export interface ProductAdapterContract {
  schemaVersion: 'gcac.product-adapter/v1';
  productId: ProductAdapterId;
  artifactFormats: Array<'pem' | 'pkcs12' | 'jks'>;
  operation: ProductOperationContract;
}

export const builtInProductAdapterContracts: readonly ProductAdapterContract[] = [
  contract('iis', ['pkcs12'], ['iis.discover', 'iis.binding.list'], ['iis.binding.update'], ['tls.remote_probe', 'tls.fingerprint.compare'], ['rollback.snapshot', 'rollback.restore'], ['windows.certstore.import_pfx', 'windows.certstore.private_key_acl', 'service.restart']),
  contract('nginx', ['pem'], ['nginx.discover', 'nginx.config_parse'], ['nginx.cert.install'], ['nginx.config_test', 'tls.remote_probe'], ['file.backup', 'file.restore'], ['file.atomic_replace', 'service.reload']),
  contract('apache', ['pem'], ['apache.discover', 'apache.config_parse'], ['apache.cert.install'], ['apache.config_test', 'tls.remote_probe'], ['file.backup', 'file.restore'], ['file.atomic_replace', 'service.reload']),
  contract('tomcat', ['pem', 'pkcs12', 'jks'], ['tomcat.discover', 'tomcat.server_xml.parse'], ['tomcat.keystore.replace'], ['tomcat.connector.verify', 'tls.remote_probe'], ['file.backup', 'file.restore'], ['file.atomic_replace', 'service.restart']),
] as const;

export function validateProductAdapterContract(value: ProductAdapterContract): ProductAdapterContract {
  if (value.schemaVersion !== 'gcac.product-adapter/v1') throw new Error('PRODUCT_ADAPTER_SCHEMA_UNSUPPORTED');
  if (!['iis', 'nginx', 'apache', 'tomcat'].includes(value.productId)) throw new Error('PRODUCT_ADAPTER_UNKNOWN');
  for (const [section, items] of Object.entries(value.operation)) {
    if (!Array.isArray(items) || items.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`PRODUCT_ADAPTER_${section.toUpperCase()}_INVALID`);
  }
  return value;
}

function contract(
  productId: ProductAdapterId,
  artifactFormats: ProductAdapterContract['artifactFormats'],
  discover: string[],
  mutate: string[],
  verify: string[],
  recover: string[],
  requiredPlatformCapabilities: string[],
): ProductAdapterContract {
  return { schemaVersion: 'gcac.product-adapter/v1', productId, artifactFormats, operation: { discover, mutate, verify, recover, requiredPlatformCapabilities } };
}
