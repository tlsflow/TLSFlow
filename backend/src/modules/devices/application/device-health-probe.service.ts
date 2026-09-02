import type { DatabasePort } from '../../../database/database-port.js';
import type { StructuredLogger } from '../../../common/logging/structured-logger.js';
import type { DevicesApplicationService } from './devices.application-service.js';

interface ProbeTarget {
  tenantId: string;
  deviceId: string;
  displayName: string;
  deviceFamily: string;
  lastDiscoveredAt: string;
}

interface ProbeOptions {
  concurrency?: number;
  batchSize?: number;
}

interface ProbeResult {
  probed: number;
  succeeded: number;
  failed: number;
}

/**
 * 周期性应用层健康探测服务。
 *
 * 目标：保持网络设备和云服务的 last_discovered_at 新鲜（< 24h），避免健康状态因发现过期而降级为 UNKNOWN。
 *
 * 实现方式：
 * - 调用插件的 device.connection.test 能力（网络设备）或 cloud.service.connection-test（云服务）
 * - 成功：刷新 pg_device_assets.last_discovered_at = now()
 * - 失败：写入 pg_device_assets.last_error_code，健康状态自动降级为 UNREACHABLE
 *
 * 与 TCP liveness 探测的区别：
 * - TCP: 验证网络层连通性（端口可达）
 * - 应用层: 验证管理 API 可访问（认证通过、服务正常）
 *
 * 调度策略：
 * - 每 6 小时执行一次（可通过环境变量 DEVICE_HEALTH_PROBE_INTERVAL_HOURS 配置）
 * - 只探测 last_discovered_at IS NOT NULL 的设备（证明曾经成功发现过）
 * - 按 last_discovered_at 升序排序，优先探测最久未刷新的设备
 */
export class DeviceHealthProbeService {
  constructor(
    private readonly db: DatabasePort,
    private readonly devicesService: DevicesApplicationService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * 批量探测所有需要健康检查的设备。
   *
   * 探测目标：
   * - last_discovered_at IS NOT NULL（曾经成功发现过）
   * - deleted_at IS NULL（未删除）
   * - 网络设备或云服务（有插件能力）
   */
  async probeAll(options: ProbeOptions = {}): Promise<ProbeResult> {
    const concurrency = options.concurrency ?? 5;
    const batchSize = options.batchSize ?? 50;

    const targets = await this.listProbeTargets(batchSize);
    if (targets.length === 0) {
      return { probed: 0, succeeded: 0, failed: 0 };
    }

    this.logger.info(`Starting health probe for ${targets.length} devices`, { count: targets.length }, { module: 'device-health-probe' });

    let succeeded = 0;
    let failed = 0;

    // 并发探测，每次最多 concurrency 个
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      const results = await Promise.allSettled(batch.map((target) => this.probeOne(target)));

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          succeeded++;
        } else {
          failed++;
        }
      }
    }

    if (failed > 0) {
      this.logger.warn(`Health probe completed with failures`, {
        probed: targets.length,
        succeeded,
        failed,
      }, { module: 'device-health-probe' });
    } else {
      this.logger.info(`Health probe completed successfully`, {
        probed: targets.length,
        succeeded,
      }, { module: 'device-health-probe' });
    }

    return { probed: targets.length, succeeded, failed };
  }

  /**
   * 查询需要探测的设备列表。
   *
   * 选择标准：
   * - 有统一插件绑定（网络设备或云服务，通过 pg_device_assets.plugin_binding_id 判定）
   * - 曾经成功发现过（last_discovered_at IS NOT NULL）
   * - 未删除
   * - 按 last_discovered_at 升序排序，优先探测最久未刷新的设备
   */
  private async listProbeTargets(limit: number): Promise<ProbeTarget[]> {
    const result = await this.db.query<{
      tenant_id: string;
      device_id: string;
      display_name: string;
      device_family: string;
      last_discovered_at: string;
    }>(`
      SELECT DISTINCT
        h.tenant_id,
        h.id AS device_id,
        h.display_name,
        d.device_family,
        d.last_discovered_at
      FROM pg_hosts h
      INNER JOIN pg_device_assets d ON d.host_id = h.id AND d.tenant_id = h.tenant_id
      WHERE h.deleted_at IS NULL
        AND d.last_discovered_at IS NOT NULL
        AND d.plugin_binding_id IS NOT NULL
      ORDER BY d.last_discovered_at ASC
      LIMIT $1
    `, [limit]);

    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      deviceId: row.device_id,
      displayName: row.display_name,
      deviceFamily: row.device_family,
      lastDiscoveredAt: row.last_discovered_at,
    }));
  }

  /**
   * 探测单个设备的应用层健康状态。
   *
   * 执行流程：
   * 1. 尝试调用 device.connection.test 能力
   * 2. 如果是云服务，回退到 cloud.service.connection-test
   * 3. 成功：刷新 last_discovered_at
   * 4. 失败：写入 last_error_code
   */
  private async probeOne(target: ProbeTarget): Promise<{ success: boolean; reasonCode?: string; reasonDetail?: string }> {
    const startTime = Date.now();

    try {
      // 优先尝试 device.connection.test（网络设备）
      try {
        await this.devicesService.executeCapability(
          target.tenantId,
          target.deviceId,
          'device.connection.test',
          'system_health_probe',
          `health-probe-${target.deviceId}`,
        );

        // 执行成功，刷新 last_discovered_at
        await this.recordProbeSuccess(target);

        return { success: true };

      } catch (firstError) {
        // 如果是"能力不存在"错误，尝试 cloud.service.connection-test
        if (firstError instanceof Error && firstError.message.includes('CAPABILITY_MISSING')) {
          await this.devicesService.executeCapability(
            target.tenantId,
            target.deviceId,
            'cloud.service.connection-test',
            'system_health_probe',
            `health-probe-${target.deviceId}`,
          );

          // 执行成功，刷新 last_discovered_at
          await this.recordProbeSuccess(target);

          return { success: true };
        }

        // 其他错误直接抛出
        throw firstError;
      }

    } catch (error) {
      const elapsed = Date.now() - startTime;
      const reasonCode = 'CONNECTION_TEST_FAILED';
      const reasonDetail = error instanceof Error ? error.message : String(error);

      // 记录失败
      await this.recordProbeFailure(target, reasonCode);

      this.logger.warn(`Health probe failed for device`, {
        deviceId: target.deviceId,
        displayName: target.displayName,
        deviceFamily: target.deviceFamily,
        reasonCode,
        reasonDetail,
        elapsedMs: elapsed,
      }, { module: 'device-health-probe' });

      return { success: false, reasonCode, reasonDetail };
    }
  }

  /**
   * 记录探测成功：刷新 last_discovered_at，清除错误码。
   */
  private async recordProbeSuccess(target: ProbeTarget): Promise<void> {
    const now = new Date().toISOString();

    await this.db.query(`
      UPDATE pg_device_assets
      SET last_discovered_at = $1,
          last_error_code = NULL,
          updated_at = $1
      WHERE host_id = $2
        AND tenant_id = $3
    `, [now, target.deviceId, target.tenantId]);
  }

  /**
   * 记录探测失败：写入 last_error_code。
   */
  private async recordProbeFailure(target: ProbeTarget, reasonCode: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db.query(`
      UPDATE pg_device_assets
      SET last_error_code = $1,
          updated_at = $2
      WHERE host_id = $3
        AND tenant_id = $4
    `, [reasonCode, now, target.deviceId, target.tenantId]);
  }
}
