---
title: Upgrade and Rollback
description: Upgrade TLSFlow v1.0.0 images, agents, and certificate deployment plans
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - docker/docker-compose.yml
  - docker/docs/20260806-Docker发布说明.md
  - backend/src/modules/agents
  - backend/src/modules/executions
testRefs: []
lastVerified: 2026-08-22
---

# Upgrade and Rollback

Platform upgrade, agent upgrade, and certificate deployment rollback are three different operations. Before execution, first confirm maintenance windows, backups, and acceptance personnel; do not treat one type of rollback as another.

## Pre-Upgrade Checks

1. Record current platform version, agent version, published workflow versions, and running tasks.
2. Complete backups of platform data, workflows, user plugins, and key materials, and confirm backups are readable.
3. First verify the target version in test environment or on low-risk targets to confirm licenses, plugins, and read-only discovery are normal.
4. Notify relevant business owners to suspend automation runs and certificate changes that may conflict with the upgrade.


## Platform Upgrade

1. Prepare platform images and configurations according to target version, with version tags following the version provided in the release package.
2. During maintenance window, start platform services according to operations plan and wait for page or operations records to confirm upgrade completion.
3. Log into console to check version information, license status, plugin marketplace, and read-only discovery.
4. Perform a small-scale test deployment on a test target. Confirm the inputs, permissions, execution channels, execution record and target read-back before restoring production write operations.
5. Observe login, monitoring, notifications, and execution records for a period to confirm no new anomalies.

When upgrade fails, immediately stop continuing the upgrade and retain upgrade records and original backups. Do not switch back to old version before confirming compatibility.


## Platform Rollback

The current version does not have a universal "one-click platform rollback" button. Release rollback needs to be performed by operations personnel:

1. Stop the new version and retain logs, backups, and original `data/` directory.
2. After confirming backup is compatible with target old version, restore corresponding database, workflows, runtime, TLS Inspector, and plugin directories.
3. Start using images matching the old version and original keys, and check migration, tenants, licenses, and read-only discovery.
4. Complete read and small-scale test deployment verification on test targets before restoring production write operations.


## Agent Upgrade

1. In device details, view current agent version and available upgrade prompts.
2. After clicking "Upgrade", verify target device, current version, and target version; confirm that restart or brief service interruption is acceptable during maintenance window.
3. Confirm upgrade plan, submit upgrade transaction, and record transaction ID.
4. View transmission, installation, and restart status according to transaction ID; do not repeatedly submit upgrades for the same device during upgrade process.
5. After completion, refresh device details to confirm agent is online, version is updated, and heartbeat is normal before resuming automation tasks.


Whether automatic rollback is supported depends on that agent release package; do not assume any historical version can be directly rolled back.

## Certificate Deployment Rollback

Only initiate certificate rollback in execution details when the deployment plan declares backup manifest and rollback steps. After rollback, re-check whether target service is normal, whether TLS handshake succeeds, whether site uses expected certificate, and retain original failure and rollback results. When there is no backup manifest, do not overwrite remote certificate files yourself.
