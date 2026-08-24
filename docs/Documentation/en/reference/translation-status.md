---
title: Translation status
description: Status of translated documentation pages
docStatus: implemented
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/010-官方文档库与多语言文档治理
codeRefs:
  - docs/Documentation/.vitepress/config.mts
  - docs/Documentation/.vitepress/theme/i18n.ts
testRefs: []
lastVerified: 2026-08-02
---

# Translation status

The Chinese pages are authoritative. English is the first complete translation target for the initial batch. The other locales expose a stable entry and an explicit `missing` or `needs_sync` status.

| Locale | Language | Initial status |
| --- | --- | --- |
| `zh-CN` | Simplified Chinese | `current` |
| `en-US` | English | `current` for the first-batch pages; other pages remain `missing` |
| `fr-FR` | French | `missing` |
| `ja-JP` | Japanese | `missing` |
| `ko-KR` | Korean | `missing` |
| `pt-BR` | Portuguese | `missing` |
| `ru-RU` | Russian | `missing` |
| `zh-TW` | Traditional Chinese | `missing` |

Missing translations are never silently replaced by Chinese content.
