/**
 * 面板定位。
 *
 * 阅读器那套定位依赖 iframe + CSS transform 矩阵（正文是分栏并且被缩放过的），这里不需要：
 * 普通网页上选区矩形就是视口坐标，直接用 `position: fixed` 贴着它。
 *
 * 两个决定：
 *   - **上下翻转**：优先往下放，下方空间不够就改成「贴着选区上沿往上长」——用 `bottom`
 *     锚定，面板不需要先量高度就能正确向上生长。
 *   - **max-height 交给 CSS 变量**：算出来的可用空间写进 `--panel-max-height`，
 *     内容超出时面板内部滚动，而不是溢出视口。
 */

const GAP = 8
const MARGIN = 8
/** 下方至少有这么多空间才优先往下放，否则宁可翻到上面。 */
const MIN_DOWNWARD_SPACE = 200

/**
 * @param {DOMRect} anchorRect 选区矩形（视口坐标）
 * @param {{width: number}} panelSize 面板宽度（高度由内容决定，不参与计算）
 * @returns {{dir: 'down'|'up', left: number, maxHeight: number, anchor: object}}
 */
export function computePlacement(anchorRect, panelSize) {
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  // 窄屏上宽面板要收窄，否则会被 clamp 到屏幕外
  const width = Math.min(panelSize.width, viewportW - MARGIN * 2)

  const spaceBelow = viewportH - anchorRect.bottom - GAP - MARGIN
  const spaceAbove = anchorRect.top - GAP - MARGIN
  const dir = spaceBelow >= MIN_DOWNWARD_SPACE || spaceBelow >= spaceAbove ? 'down' : 'up'

  const left = Math.min(
    Math.max(anchorRect.left, MARGIN),
    Math.max(MARGIN, viewportW - width - MARGIN),
  )

  const maxHeight = Math.max(120, dir === 'down' ? spaceBelow : spaceAbove)
  const anchor = dir === 'down' ? { top: anchorRect.bottom + GAP } : { bottom: viewportH - anchorRect.top + GAP }

  return { dir, left, width, maxHeight, anchor }
}

/** 锚点是不是还在视口里（滚出视口就该关面板，而不是把它钉在屏幕边上）。 */
export function isAnchorVisible(rect) {
  if (!rect) return false
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
}

/**
 * 浮标的定位：贴在选区指定的角上（设置项 iconPlacement），clamp 在视口内。
 * placement：br=右下（默认，与旧版一致）、tr=右上、bl=左下、tl=左上。
 */
export function computeIconPlacement(anchorRect, iconSize, placement = 'br') {
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const GAP = 2
  const place = (horiz, vert) => ({
    left:
      horiz === 'r'
        ? Math.min(Math.max(anchorRect.right + GAP, MARGIN), viewportW - iconSize - MARGIN)
        : Math.min(Math.max(anchorRect.left - iconSize - GAP, MARGIN), viewportW - iconSize - MARGIN),
    top:
      vert === 'b'
        ? Math.min(Math.max(anchorRect.bottom + GAP, MARGIN), viewportH - iconSize - MARGIN)
        : Math.min(Math.max(anchorRect.top - iconSize - GAP, MARGIN), viewportH - iconSize - MARGIN),
  })
  switch (placement) {
    case 'tr': return place('r', 't')
    case 'bl': return place('l', 'b')
    case 'tl': return place('l', 't')
    default: return place('r', 'b')
  }
}

/**
 * 给宿主元素上“免疫”内联样式（所有关键属性带 !important）。
 *
 * 页面或广告拦截类扩展会用 `position: fixed` 一律改 absolute + display:none !important
 * 的样式表清理悬浮元素——我们的浮标/面板正是 fixed 定位，会被当成悬浮广告干掉。
 * 内联 !important 的优先级高于样式表里的 !important，这样写才能活下来。
 */
export function setImmuneStyles(el, props) {
  for (const [prop, value] of Object.entries(props)) {
    el.style.setProperty(prop, value, 'important')
  }
}
