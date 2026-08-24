#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
OUTPUT_DIR="${OUTPUT_DIR:-${AGENT_DIR}/dist}"
VERSION_VALUE="${VERSION:-0.1.11}"
COMMIT_VALUE="${COMMIT:-$(git -C "${AGENT_DIR}" rev-parse HEAD)}"
SOURCE_DATE_EPOCH_VALUE="${SOURCE_DATE_EPOCH:-$(git -C "${AGENT_DIR}" log -1 --format=%ct)}"
BUILD_TIME_VALUE="${BUILD_TIME:-$(date -u -d "@${SOURCE_DATE_EPOCH_VALUE}" '+%Y-%m-%dT%H:%M:%SZ')}"
SIGNING_PRIVATE_KEY_FILE="${SIGNING_PRIVATE_KEY_FILE:-}"

[ -n "${SIGNING_PRIVATE_KEY_FILE}" ] || { echo "错误：正式发布必须提供 Ed25519 签名私钥" >&2; exit 1; }
[ -f "${SIGNING_PRIVATE_KEY_FILE}" ] || { echo "错误：签名私钥不存在" >&2; exit 1; }
[ -r "${SIGNING_PRIVATE_KEY_FILE}" ] || { echo "错误：签名私钥不可读" >&2; exit 1; }

mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_DIR}/gcac-linux-agent-linux-amd64" "${OUTPUT_DIR}/gcac-linux-agent-linux-arm64" "${OUTPUT_DIR}/SHA256SUMS"
rm -f "${OUTPUT_DIR}/gcac-linux-agent-linux-amd64.sig" "${OUTPUT_DIR}/gcac-linux-agent-linux-arm64.sig"

build_arch() {
  arch="$1"
  output="${OUTPUT_DIR}/gcac-linux-agent-linux-${arch}"
  OUTPUT_NAME="${output}" GOOS=linux GOARCH="${arch}" VERSION="${VERSION_VALUE}" COMMIT="${COMMIT_VALUE}" SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH_VALUE}" BUILD_TIME="${BUILD_TIME_VALUE}" "${AGENT_DIR}/build.sh"
}

build_verifier() {
  arch="$1"
  output="${OUTPUT_DIR}/gcac-release-sign-linux-${arch}"
  CGO_ENABLED=0 GOOS=linux GOARCH="${arch}" go build -trimpath -ldflags "-s -w -buildid=" -o "${output}" "${AGENT_DIR}/cmd/release-sign"
}

build_arch amd64
build_arch arm64
build_verifier amd64
build_verifier arm64

sign_artifact() {
  artifact="$1"
  signature="${artifact}.sig"
  go run "${AGENT_DIR}/cmd/release-sign" sign "${SIGNING_PRIVATE_KEY_FILE}" "${artifact}" "${signature}"
  [ -s "${signature}" ] || { echo "错误：签名产物为空：${signature}" >&2; exit 1; }
}

sign_artifact "${OUTPUT_DIR}/gcac-linux-agent-linux-amd64"
sign_artifact "${OUTPUT_DIR}/gcac-linux-agent-linux-arm64"

(
  cd "${OUTPUT_DIR}"
  sha256sum gcac-linux-agent-linux-amd64 gcac-linux-agent-linux-arm64 gcac-release-sign-linux-amd64 gcac-release-sign-linux-arm64 > SHA256SUMS
)

cat > "${OUTPUT_DIR}/build-environment.txt" <<EOF
version=${VERSION_VALUE}
commit=${COMMIT_VALUE}
source_date_epoch=${SOURCE_DATE_EPOCH_VALUE}
build_time=${BUILD_TIME_VALUE}
go_version=$(go version)
cgo_enabled=0
targets=linux/amd64,linux/arm64
signature_algorithm=Ed25519
signed=true
EOF

cat > "${OUTPUT_DIR}/sbom.spdx.json" <<EOF
{
  "spdxVersion": "SPDX-2.3",
  "dataLicense": "CC0-1.0",
  "SPDXID": "SPDXRef-DOCUMENT",
  "name": "gcac-linux-agent-${VERSION_VALUE}",
  "documentNamespace": "https://gcac.local/spdx/gcac-linux-agent/${COMMIT_VALUE}",
  "creationInfo": {
    "created": "${BUILD_TIME_VALUE}",
    "creators": ["Tool: gcac-linux-agent/release/build-release.sh"]
  },
  "packages": [
    {
      "name": "gcac-linux-agent",
      "SPDXID": "SPDXRef-Package-gcac-linux-agent",
      "versionInfo": "${VERSION_VALUE}",
      "downloadLocation": "NOASSERTION",
      "filesAnalyzed": false
    }
  ]
}
EOF

printf '发布构建完成：%s\n' "${OUTPUT_DIR}"
