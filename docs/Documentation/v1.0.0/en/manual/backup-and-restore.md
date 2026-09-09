---
title: Backup and Restore
description: Back up TLSFlow data directories, workflows, and user plugins, and perform restore drills
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - docker/docker-compose.yml
  - backend/src/database/migration-runner.ts
testRefs: []
lastVerified: 2026-08-22
---

# Backup and Restore

The current version does not have a platform-level backup/restore button that can be completed directly from the console. Backup and restore operations are performed by operations personnel according to the organization's backup system. Before use, confirm whether backups exist, whether restore drills have passed, and prepare related tickets and maintenance windows before making changes.

## Backup Scope

Please cover at least the following content:

- Standard deployment: `data/postgres/`, `data/workflows/`, `data/runtime/`, `data/tls-inspector/` and user plugin directories.
- Single-machine deployment: `data/pglite/`, `data/workflows/`, `data/runtime/`, `data/tls-inspector/` and user plugin directories.
- Separate custody: Platform encryption key for secrets, database passwords, and license signing materials.
- Business records: Current version number, tenant/user list, published workflow versions, certificate assets, and recent execution records.

Screenshot placeholder: Backup ticket or backup system content inventory showing database, workflows, plugins, and key materials all included in plan (sensitive values redacted).

Backup completion does not equal the ability to restore. Verify at least once in an isolated environment: can the platform start, read tenants and certificates, load workflows, discover application assets, and execute test deployments. Use database tools approved by the organization for backup and restore; do not directly overwrite data directories while services are running.

## Restore Steps

When data corruption or migration incidents occur, operate in the following order:

1. Enter maintenance window and stop Backend and Web to avoid continued writes during restore.
2. Retain the original `data/` directory and logs without direct overwrite; copy or mark as "pre-restore snapshot" first.
3. Restore platform database and data directories according to deployment type.
4. Restore workflow, runtime, TLS Inspector data directories, and user plugin directories, ensuring directory permissions match original deployment.
5. Start services using the platform version matching the backup and the same set of key materials.
6. After login, check database migration status, tenants, licenses, plugin status, and read-only discovery results in sequence.
7. After confirming normal read operations, restore write operations; first execute Dry Run or small-scale test deployments on test targets.

Screenshot placeholder: Restore acceptance page showing platform version, tenants, licenses, plugins, and read-only discovery checklist items.

## Key and Secret Considerations

Historical plaintext of secrets depends on the original encryption key. When keys are lost, resetting environment variables cannot recover historical secret content and must be handled according to key custody procedures. Do not put keys, database passwords, or license signing materials in regular backup directories, chat logs, or screenshots.

## Remote Backup in Deployment Tasks

If the SSH workflow provides a "backup manifest", the system will save old files before writing target files and attempt recovery according to the manifest upon failure. This feature only covers remote files declared in the manifest and does not equal platform database disaster recovery. When rollback fails, retain original failure information, rollback results, and remote paths for continued handling by operations personnel. Do not repeatedly overwrite target files.
