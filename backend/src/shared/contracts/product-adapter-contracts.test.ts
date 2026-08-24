import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInProductAdapterContracts, validateProductAdapterContract } from './product-adapter-contracts.js';

test('四类产品合同只声明产品语义和平台能力需求', () => {
  assert.deepEqual(builtInProductAdapterContracts.map((item) => item.productId), ['iis', 'nginx', 'apache', 'tomcat']);
  for (const contract of builtInProductAdapterContracts) {
    assert.equal(validateProductAdapterContract(contract), contract);
    const serialized = JSON.stringify(contract);
    assert.doesNotMatch(serialized, /osType|distribution|windowsVersion|systemctl|Restart-Service|apache2ctl|httpd\.exe/i);
    assert.ok(contract.operation.verify.length > 0);
    assert.ok(contract.operation.recover.length > 0);
  }
});

test('未知产品合同失败关闭', () => {
  assert.throws(() => validateProductAdapterContract({ ...builtInProductAdapterContracts[0]!, productId: 'unknown' as never }), /PRODUCT_ADAPTER_UNKNOWN/);
});
