/**
 * 深色主题下的词条颜色修正。移植自 MyReader `myBooksDictProvider.ts` 的 `adaptToDarkTheme`。
 *
 * 词典的 CSS 里颜色几乎都是写死的（黑字白底），在深色面板上直接变成黑底黑字。这里按
 * **原色相**重照：文本太暗就提亮，背景太亮就压暗，纯灰的交给主题前景色（凭空编一个色相
 * 反而更糟）。
 *
 * 依赖 CSS 相对颜色语法 `hsl(from …)`；不支持就整趟跳过，不产生非法声明。
 */

const TEXT_MIN_LUMINANCE = 0.45
const TEXT_BOOST_LIGHTNESS = 66
const BG_MAX_LUMINANCE = 0.75
const BG_TAME_LIGHTNESS = 18
/** 词条可能有上万个节点，留个上限。 */
const SCAN_LIMIT = 5000

function parseRgb(value) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function relativeLuminance([r, g, b]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function supportsRelativeColor() {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('color', 'hsl(from red h s 50%)')
  )
}

export function adaptToDarkTheme(root) {
  if (!supportsRelativeColor()) return
  const nodes = Array.from(root.querySelectorAll('*')).slice(0, SCAN_LIMIT)

  for (const el of nodes) {
    const rgb = parseRgb(getComputedStyle(el).color)
    if (!rgb || relativeLuminance(rgb) >= TEXT_MIN_LUMINANCE) continue
    el.style.color =
      rgb[0] === rgb[1] && rgb[1] === rgb[2]
        ? 'inherit'
        : `hsl(from rgb(${rgb.join(',')}) h s ${TEXT_BOOST_LIGHTNESS}%)`
  }

  for (const el of nodes) {
    const rgb = parseRgb(getComputedStyle(el).backgroundColor)
    // 透明会被读成 0,0,0，永远不会「太亮」
    if (!rgb || relativeLuminance(rgb) <= BG_MAX_LUMINANCE) continue
    el.style.backgroundColor = `hsl(from rgb(${rgb.join(',')}) h s ${BG_TAME_LIGHTNESS}%)`
  }
}
