#!/usr/bin/env sh
set -eu

PUBLIC_KEY_FILE="${1:-}"
ARTIFACT_FILE="${2:-}"
SIGNATURE_FILE="${3:-}"
VERIFIER="${SIGNATURE_VERIFIER:-}"

[ -f "${PUBLIC_KEY_FILE}" ] || { echo "错误：发布公钥不存在" >&2; exit 1; }
[ -f "${ARTIFACT_FILE}" ] || { echo "错误：发布产物不存在" >&2; exit 1; }
[ -f "${SIGNATURE_FILE}" ] || { echo "错误：发布签名不存在" >&2; exit 1; }
[ -x "${VERIFIER}" ] || { echo "错误：签名验证器不存在或不可执行" >&2; exit 1; }

"${VERIFIER}" verify "${PUBLIC_KEY_FILE}" "${ARTIFACT_FILE}" "${SIGNATURE_FILE}"
