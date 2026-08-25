import assert from 'node:assert/strict';
import test from 'node:test';
import { CookieJar, CookieSessionStore } from './cookie-session.js';

test('CookieJar 保存多个 Set-Cookie、逗号和等号，并按域名路径发送', () => {
  const jar = new CookieJar();
  jar.setCookies([
    'sid=a=b,c; Path=/; Secure',
    'prefs=dark; Path=/admin',
    'hostOnly=yes',
  ], 'https://example.test/login');
  assert.equal(jar.getCookieHeader('https://example.test/admin/index'), 'prefs=dark; sid=a=b,c; hostOnly=yes');
  assert.equal(jar.getCookieHeader('https://sub.example.test/admin/index'), undefined);
  assert.equal(jar.getCookieHeader('http://example.test/admin/index'), 'prefs=dark; hostOnly=yes');
});

test('CookieJar 支持同名更新、Max-Age=0、Expires 过期和默认 Path', () => {
  const jar = new CookieJar();
  jar.setCookie('sid=one; Path=/api', 'https://example.test/api/login');
  jar.setCookie('sid=two; Path=/api', 'https://example.test/api/login');
  assert.equal(jar.getCookieHeader('https://example.test/api/status'), 'sid=two');
  jar.setCookie('sid=gone; Max-Age=0; Path=/api', 'https://example.test/api/status');
  assert.equal(jar.getCookieHeader('https://example.test/api/status'), undefined);
  jar.setCookie('expired=yes; Expires=Wed, 21 Oct 2015 07:28:00 GMT', 'https://example.test/login');
  assert.equal(jar.getCookieHeader('https://example.test/'), undefined);
  jar.setCookie('default=yes', 'https://example.test/a/login');
  assert.equal(jar.getCookieHeader('https://example.test/a/home'), 'default=yes');
  assert.equal(jar.getCookieHeader('https://example.test/b/home'), undefined);
});

test('CookieJar 正确处理 Domain、Secure、Host-only 和 Path 边界', () => {
  const jar = new CookieJar();
  jar.setCookie('domain=yes; Domain=example.test; Path=/', 'https://api.example.test/login');
  jar.setCookie('secure=yes; Secure; Path=/', 'https://api.example.test/login');
  jar.setCookie('host=yes; Path=/', 'https://api.example.test/login');
  jar.setCookie('api=yes; Path=/api', 'https://api.example.test/login');
  assert.equal(jar.getCookieHeader('https://other.example.test/'), 'domain=yes');
  assert.equal(jar.getCookieHeader('http://api.example.test/'), 'domain=yes; host=yes');
  assert.equal(jar.getCookieHeader('https://api.example.test/api'), 'api=yes; domain=yes; secure=yes; host=yes');
  assert.equal(jar.getCookieHeader('https://api.example.test/apix'), 'domain=yes; secure=yes; host=yes');
  assert.equal(jar.getCookieHeader('https://api.example.test/other'), 'domain=yes; secure=yes; host=yes');
});

test('CookieSessionStore 按租户、运行、工作流版本和逻辑引用隔离并清理', () => {
  const store = new CookieSessionStore();
  const scope = { tenantId: 'tenant-a', runId: 'run-a', workflowVersionId: 'wf-1', cookieSessionRef: 'waf' };
  store.getOrCreate(scope).setCookie('sid=one', 'https://example.test/');
  store.getOrCreate({ ...scope, cookieSessionRef: 'other' }).setCookie('sid=two', 'https://example.test/');
  store.getOrCreate({ ...scope, tenantId: 'tenant-b' }).setCookie('sid=three', 'https://example.test/');
  assert.equal(store.get(scope)?.getCookieHeader('https://example.test/'), 'sid=one');
  assert.equal(store.size(), 3);
  store.clear({ tenantId: 'tenant-a', runId: 'run-a', workflowVersionId: 'wf-1' });
  assert.equal(store.size(), 1);
  assert.equal(store.get({ ...scope, tenantId: 'tenant-b' })?.getCookieHeader('https://example.test/'), 'sid=three');
});
