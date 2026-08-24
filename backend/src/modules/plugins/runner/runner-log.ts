import { REDACTED_VALUE, redactSensitive } from '../../../common/logging/redact.js';

/** Runner 的 stderr、协议错误和执行器异常只能以脱敏文本输出。 */
export function redactRunnerLog(input: unknown): string {
  return String(redactSensitive(input))
    .replace(/Bearer\s+\S*/gi, REDACTED_VALUE)
    .replace(/(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi, (value) => value.replace(/:.*/, `: ${REDACTED_VALUE}`))
    .replace(/(?:[A-Z_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|COOKIE|AUTH)[A-Z_]*)\s*=\s*[^\s]+/gi, (value) => value.replace(/=.*/, `=${REDACTED_VALUE}`))
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gi, REDACTED_VALUE)
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\r\n\s"'<>]+/g, REDACTED_VALUE)
    .replace(/(?<![A-Za-z0-9])\/(?:[^\r\n\s"'<>]+\/)+[^\r\n\s"'<>]*/g, REDACTED_VALUE);
}
