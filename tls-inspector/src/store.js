import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX_SNAPSHOTS = 500
const MAX_SNAPSHOTS_PER_TARGET = 12
const DEFAULT_INTERVAL_SECONDS = 86_400
const MIN_INTERVAL_SECONDS = 86_400

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

export class FileStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.filePath = path.join(dataDir, 'store.json')
    this.state = null
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true })
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      const sourceTargets = Array.isArray(parsed.targets) ? parsed.targets : []
      this.state = {
        targets: sourceTargets.map((item) => ({
          ...item,
          schedule: normalizeSchedule(item.schedule),
        })),
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      }
      if (sourceTargets.some((item, index) => (
        Number(item.schedule?.intervalSeconds) !== this.state.targets[index].schedule.intervalSeconds
      ))) {
        await this.flush()
      }
    } catch {
      this.state = {
        targets: [],
        snapshots: [],
      }
      await this.flush()
    }
  }

  async flush() {
    const tempPath = `${this.filePath}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2), 'utf8')
    await fs.rename(tempPath, this.filePath)
  }

  listTargets(tenantId) {
    return this.state.targets
      .filter((item) => !tenantId || item.tenantId === tenantId)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  }

  getTarget(id, tenantId) {
    return this.state.targets.find((item) => item.id === id && (!tenantId || item.tenantId === tenantId))
  }

  async upsertTarget(input) {
    const now = new Date().toISOString()
    const existing = input.id ? this.getTarget(input.id, input.tenantId) : undefined
    const target = existing
      ? {
          ...existing,
          ...input,
          updatedAt: now,
        }
      : {
          id: input.id ?? newId('tls_target'),
          tenantId: input.tenantId ?? 'default',
          status: input.status ?? 'active',
          schedule: normalizeSchedule(input.schedule),
          enabledViews: input.enabledViews ?? ['overview', 'trustPaths', 'protocols', 'simulations', 'protocolDetails'],
          createdAt: now,
          updatedAt: now,
          ...input,
        }

    target.schedule = normalizeSchedule(target.schedule)
    if (existing) {
      this.state.targets = this.state.targets.map((item) => (item.id === existing.id ? target : item))
    } else {
      this.state.targets.unshift(target)
    }
    await this.flush()
    return target
  }

  async deleteTarget(id, tenantId) {
    const target = this.getTarget(id, tenantId)
    if (!target) return undefined
    this.state.targets = this.state.targets.filter((item) => item.id !== id)
    await this.flush()
    return target
  }

  async saveSnapshot(snapshot) {
    const saved = {
      ...snapshot,
      id: snapshot.id ?? newId('tls_snapshot'),
    }
    const orderedSnapshots = [
      saved,
      ...this.state.snapshots.filter((item) => item.id !== saved.id),
    ]
    let sameTargetCount = 0
    this.state.snapshots = orderedSnapshots
      .filter((item) => {
        if (item.targetId !== saved.targetId || item.tenantId !== saved.tenantId) {
          return true
        }
        sameTargetCount += 1
        return sameTargetCount <= MAX_SNAPSHOTS_PER_TARGET
      })
      .slice(0, MAX_SNAPSHOTS)
    const target = this.getTarget(saved.targetId, saved.tenantId)
    if (target) {
      target.lastInspectedAt = saved.finishedAt ?? saved.startedAt
      target.lastSnapshotId = saved.id
      target.updatedAt = new Date().toISOString()
    }
    await this.flush()
    return saved
  }

  getSnapshot(id, tenantId) {
    return this.state.snapshots.find((item) => item.id === id && (!tenantId || item.tenantId === tenantId))
  }

  getLatestSnapshotForTarget(targetId, tenantId) {
    return this.state.snapshots.find((item) => item.targetId === targetId && (!tenantId || item.tenantId === tenantId))
  }

  listSnapshotsForTarget(targetId, tenantId, limit = 20) {
    return this.state.snapshots
      .filter((item) => item.targetId === targetId && (!tenantId || item.tenantId === tenantId))
      .slice(0, limit)
  }
}

function normalizeSchedule(schedule) {
  const requested = Number(schedule?.intervalSeconds ?? schedule?.interval ?? DEFAULT_INTERVAL_SECONDS)
  const intervalSeconds = Number.isFinite(requested)
    ? Math.max(MIN_INTERVAL_SECONDS, requested)
    : DEFAULT_INTERVAL_SECONDS
  return { intervalSeconds }
}
