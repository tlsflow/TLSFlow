/**
 * 将文本复制到系统剪贴板。
 *
 * 浏览器剪贴板 API 需要安全上下文或用户授权；在本地开发、内嵌页面
 * 或权限被拒绝时，回退到传统 DOM 复制方式，避免按钮点击后静默失效。
 */
export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (!value) return false

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // 继续尝试兼容旧浏览器和受限上下文的 DOM 复制方式。
    }
  }

  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') return false

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  try {
    textarea.focus()
    textarea.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
