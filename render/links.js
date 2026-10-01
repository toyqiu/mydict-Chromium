/**
 * 词条内链接的行为。
 *
 * 三种：
 *   - `entry://词头` —— MDict 的交叉引用。目标是**另一个词**，在面板里就地查（带历史栈）。
 *     服务端故意保留这个 scheme 不做改写，交给客户端拦截。
 *   - 纯锚点 `#x` —— 词条内部跳转，交给浏览器默认行为。
 *   - 其它 http(s)/mailto —— 必须**新标签页打开**：面板是叠在用户正在读的页面上的，
 *     默认行为会把当前页面导航走，用户的正文就没了。
 */

import { AUDIO_BOUND } from './audio.js'

/** 目标可能被百分号编码（Weblio 系），也可能带词条内锚点（牛津系 `dirty_1#down_idmg_5`）。 */
export function normalizeEntryTarget(href) {
  let raw = href.slice('entry://'.length)
  try {
    raw = decodeURIComponent(raw)
  } catch {
    /* 编码坏了就用原串，下面照样能 trim */
  }
  const hash = raw.indexOf('#')
  if (hash >= 0) raw = raw.slice(0, hash)
  return raw.trim()
}

export function wireLinks(root, onNavigate) {
  root.querySelectorAll('a[href]').forEach((anchor) => {
    // 发音点击已经被音频那条链路接管了，别抢
    if (anchor.dataset[AUDIO_BOUND]) return
    const href = anchor.getAttribute('href') ?? ''

    if (href.startsWith('entry://')) {
      anchor.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const word = normalizeEntryTarget(href)
        if (word) onNavigate?.(word)
      })
      return
    }

    if (href.startsWith('#')) return // 词条内锚点，走默认行为

    // 外链：新标签页，并且不把来源页信息带出去
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })
}
