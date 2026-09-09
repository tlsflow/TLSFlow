import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { createPersistedSecurityServices } from '../security/security-services.persistence.js';
import { PgSystemUpdateSettingsRepository } from './system-update.repository.js';
import {
  GitHubReleaseManifestClient,
  parseGitHubReleases,
  parseReleaseManifest,
  StaticReleaseManifestClient,
} from './system-update.manifest.js';
import { SystemUpdateService } from './system-update.service.js';

const manifest = {
  schemaVersion: 1,
  product: 'GCAC',
  channels: {
    stable: {
      version: '99.0.0',
      publishedAt: '2026-09-01T10:00:00Z',
      releaseNotes: '稳定版测试说明',
      images: {
        backend: 'tlsflow/tlsflow-backend:99.0.0',
        web: 'tlsflow/tlsflow-web:99.0.0',
        browserRuntime: 'tlsflow/tlsflow-browser-runtime:99.0.0',
      },
    },
    dev: {
      version: '99.1.0-dev.20260909.test',
      publishedAt: '2026-09-09T10:00:00Z',
      releaseNotes: '开发版测试说明',
      images: {
        backend: 'tlsflow/tlsflow-backend:99.1.0-dev.20260909.test',
        web: 'tlsflow/tlsflow-web:99.1.0-dev.20260909.test',
        browserRuntime: 'tlsflow/tlsflow-browser-runtime:99.1.0-dev.20260909.test',
      },
    },
  },
} as const;

describe('系统更新通道 API', () => {
  it('保存通道并按通道检查具体版本', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db, join(process.cwd(), 'src/database/migrations'));
    const repository = new PgSystemUpdateSettingsRepository(db);
    const service = new SystemUpdateService(repository, new StaticReleaseManifestClient(manifest));

    const initial = await service.getSettings();
    assert.equal(initial.channel, 'stable');
    const updated = await service.updateChannel({
      channel: 'dev',
      version: initial.version,
      actorId: 'user-test',
      context: { requestId: 'request-test', sourceIp: '127.0.0.1', tenantId: 'tenant-test' },
    });
    assert.equal(updated.channel, 'dev');
    assert.equal(updated.version, initial.version + 1);

    const check = await service.check();
    assert.equal(check.channel, 'dev');
    assert.equal(check.targetVersion, '99.1.0-dev.20260909.test');
    assert.equal(check.updateAvailable, true);
    assert.equal(check.relation, 'upgrade');
    assert.match(check.commands.installScript, /99\.1\.0-dev/);
    assert.match(check.commands.compose, /export GCAC_RELEASE_VERSION=99\.1\.0-dev/);

    const channelSwitchCheck = await service.check('stable');
    assert.equal(channelSwitchCheck.relation, 'channel_switch');
    assert.equal(channelSwitchCheck.channel, 'stable');
  });

  it('拒绝不完整、latest 和不受支持镜像的清单', () => {
    assert.throws(
      () => parseReleaseManifest({
        ...manifest,
        channels: {
          ...manifest.channels,
          stable: {
            ...manifest.channels.stable,
            version: 'latest',
          },
        },
      }),
      (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'RELEASE_MANIFEST_INVALID',
    );
    assert.throws(
      () => parseReleaseManifest({
        ...manifest,
        channels: {
          ...manifest.channels,
          stable: {
            ...manifest.channels.stable,
            images: {
              ...manifest.channels.stable.images,
              web: 'tlsflow/tlsflow-web:99.0.0+build.1',
            },
          },
        },
      }),
      (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'RELEASE_MANIFEST_INVALID',
    );
    assert.throws(
      () => parseReleaseManifest({
        ...manifest,
        channels: {
          ...manifest.channels,
          dev: {
            ...manifest.channels.dev,
            images: {
              ...manifest.channels.dev.images,
              backend: 'evil.example/gcac-backend:99.1.0',
            },
          },
        },
      }),
      (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'RELEASE_MANIFEST_INVALID',
    );
  });

  it('从 GitHub Releases API 映射 stable/dev，跳过 draft 并保留 prerelease 开发版', async () => {
    const releases = [
      {
        tag_name: 'v99.2.0-dev.20260909',
        draft: true,
        prerelease: true,
        published_at: null,
        body: '草稿不应被选中',
      },
      {
        tag_name: 'v99.1.0-rc.1',
        draft: false,
        prerelease: true,
        published_at: '2026-09-09T11:00:00Z',
        body: '开发版说明',
      },
      {
        tag_name: 'v99.0.0',
        draft: false,
        prerelease: false,
        published_at: '2026-09-01T10:00:00Z',
        body: '稳定版说明',
      },
    ];
    const parsed = parseGitHubReleases(releases);
    assert.equal(parsed.channels.stable.version, '99.0.0');
    assert.equal(parsed.channels.dev.version, '99.1.0-rc.1');
    assert.equal(parsed.channels.dev.releaseNotes, '开发版说明');
    assert.equal(parsed.channels.dev.images.backend, 'tlsflow/tlsflow-backend:99.1.0-rc.1');

    let requestUrl = '';
    const client = new GitHubReleaseManifestClient({
      request: async (request) => {
        requestUrl = request.url;
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify(releases),
          body: releases,
        };
      },
    });
    const fetched = await client.getManifest();
    assert.equal(requestUrl, 'https://api.github.com/repos/tlsflow/TLSFlow/releases');
    assert.equal(fetched.channels.stable.version, '99.0.0');
  });

  it('GitHub Releases 没有稳定版或选中标签不是 SemVer 时失败关闭', () => {
    assert.throws(
      () => parseGitHubReleases([
        {
          tag_name: 'v99.1.0-rc.1',
          draft: false,
          prerelease: true,
          published_at: '2026-09-09T11:00:00Z',
          body: '',
        },
      ]),
      (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'RELEASE_MANIFEST_INVALID',
    );
    assert.throws(
      () => parseGitHubReleases([
        {
          tag_name: 'release-99',
          draft: false,
          prerelease: false,
          published_at: '2026-09-09T11:00:00Z',
          body: '',
        },
      ]),
      (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'RELEASE_MANIFEST_INVALID',
    );
  });

  it('通过应用路由读取和保存通道', async () => {
    const previousSeed = process.env.GCAC_ENABLE_LEGACY_ADMIN_SEED;
    const previousSecretKek = process.env.GCAC_SECRET_KEK;
    process.env.GCAC_ENABLE_LEGACY_ADMIN_SEED = 'false';
    process.env.GCAC_SECRET_KEK = 'system-update-test-secret-kek';
    try {
      const db = new PgliteDatabase();
      await runMigrations(db, join(process.cwd(), 'src/database/migrations'));
      const security = createPersistedSecurityServices(db).services;
      const app = createApp({
        db,
        security,
        corePersistence: { mode: 'memory', strict: false },
        systemUpdateManifestClient: new StaticReleaseManifestClient(manifest),
      });
      const initialized = await app.inject({
        method: 'POST',
        path: '/api/v1/system/initialization',
        body: {
          username: 'system-update-owner',
          displayName: 'System Update Owner',
          password: 'correct-horse',
          passwordConfirmation: 'correct-horse',
          locale: 'en-US',
          theme: 'light',
        },
      });
      assert.equal(initialized.statusCode, 200);
      const cookie = initialized.headers['Set-Cookie'];
      assert.ok(cookie);

      const current = await app.inject({
        method: 'GET',
        path: '/api/v1/system/update-channel',
        headers: { cookie },
      });
      assert.equal(current.statusCode, 200);
      assert.equal((current.body as { channel: string }).channel, 'stable');

      const updated = await app.inject({
        method: 'PUT',
        path: '/api/v1/system/update-channel',
        headers: { cookie },
        body: { channel: 'dev', version: 1 },
      });
      assert.equal(updated.statusCode, 200);
      assert.equal((updated.body as { channel: string }).channel, 'dev');

      const check = await app.inject({
        method: 'GET',
        path: '/api/v1/system/update-check',
        headers: { cookie },
      });
      assert.equal(check.statusCode, 200);
      assert.equal((check.body as { targetVersion: string }).targetVersion, '99.1.0-dev.20260909.test');
    } finally {
      if (previousSeed === undefined) delete process.env.GCAC_ENABLE_LEGACY_ADMIN_SEED;
      else process.env.GCAC_ENABLE_LEGACY_ADMIN_SEED = previousSeed;
      if (previousSecretKek === undefined) delete process.env.GCAC_SECRET_KEK;
      else process.env.GCAC_SECRET_KEK = previousSecretKek;
    }
  });
});
