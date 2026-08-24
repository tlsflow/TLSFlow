import assert from 'node:assert/strict';
import test from 'node:test';
import { signAliyunRpc, signHuaweiRequest, signTencentTc3, signVolcengineRequest } from './provider-signers.js';

test('阿里云 RPC 签名包含稳定的公共参数且不暴露 Secret', () => {
  const request = signAliyunRpc({
    accessKeyId: 'test-ak',
    accessKeySecret: 'test-sk',
    action: 'DescribeUserDomains',
    version: '2018-05-10',
    scope: {},
  });
  assert.match(request.url, /AccessKeyId=test-ak/);
  assert.match(request.url, /Signature=/);
  assert.doesNotMatch(request.url, /test-sk/);
});

test('腾讯云 TC3 签名生成 Authorization、Host 和时间戳', () => {
  const request = signTencentTc3({
    secretId: 'sid',
    secretKey: 'skey',
    service: 'cdn',
    action: 'DescribeDomains',
    version: '2018-06-06',
    scope: {},
    now: new Date('2026-01-02T03:04:05.000Z'),
  });
  assert.match(request.headers.authorization!, /^TC3-HMAC-SHA256 Credential=sid\//);
  assert.equal(request.headers.host, 'cdn.tencentcloudapi.com');
  assert.equal(request.headers['x-tc-timestamp'], '1767323045');
  assert.doesNotMatch(request.headers.authorization!, /skey/);
});

test('华为云签名包含 CanonicalRequest 需要的日期和签名头', () => {
  const request = signHuaweiRequest({
    accessKey: 'ak',
    secretKey: 'sk',
    method: 'PUT',
    path: '/v1.0/cdn/configuration/domains/example.com',
    payload: { certificateId: 'old' },
    scope: {},
    now: new Date('2026-01-02T03:04:05.000Z'),
  });
  assert.equal(request.headers['x-sdk-date'], '20260102T030405Z');
  assert.match(request.headers.authorization!, /^SDK-HMAC-SHA256 Access=ak/);
  assert.doesNotMatch(request.headers.authorization!, /sk/);
});

test('火山引擎签名包含作用域和请求摘要', () => {
  const request = signVolcengineRequest({
    accessKeyId: 'ak',
    secretAccessKey: 'sk',
    service: 'cdn',
    region: 'cn-north-1',
    action: 'ListCdnDomains',
    payload: { PageSize: 10 },
    scope: {},
    now: new Date('2026-01-02T03:04:05.000Z'),
  });
  assert.match(request.headers.authorization!, /Credential=ak\/20260102\/cn-north-1\/cdn\/request/);
  assert.ok(request.body?.includes('PageSize'));
  assert.doesNotMatch(request.headers.authorization!, /sk/);
});
