/**
 * 选区捕获与判定。
 *
 * 与阅读器的差别：那边正文在 shadow DOM 里的沙箱 iframe 中，要处理 pointerdown /
 * pointermove / selectionchange 三条路径 + 双击合成整词 + Android 的时序怪癖。这里是
 * **普通网页的顶层文档**，浏览器已经做好了整词选择（双击），所以只需要：
 *   - `selectionchange`：选区变了就更新（防抖）
 *   - `dblclick`：双击选词时给一个明确的信号（`trigger=dblclick` 模式用）
 * 不需要合成事件，也不去抢浏览器的手势。
 */

import { MAX_LOOKUP_LENGTH } from '../core/lookup-candidates.js'

/** 选区变化很密集（拖选时每移动一下都触发），等手停稳一点再处理。 */
export const SELECTION_DEBOUNCE_MS = 180

/** 触屏：touchend 后留这么久，等原生的选区手柄/菜单就位再复查选区。 */
export const SELECTION_TOUCH_SETTLE_MS = 300

/** 我们的 UI 宿主都带这个属性，用来把自己排除在选区处理之外。 */
export const UI_ATTR = 'data-myreader-dict-ui'

/** 该节点是不是我们自己注入的 UI（面板/浮标）内部。 */
export function isOurUI(node) {
  if (!node) return false
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  return Boolean(element?.closest?.(`[${UI_ATTR}]`))
}

/** 光标是否落在输入框 / 可编辑区域里。 */
export function isInEditable(node) {
  if (!node) return false
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  if (!element) return false
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return element.isContentEditable === true
}

/**
 * 读当前选区。没有有效选区返回 null。
 *
 * `text` 已经 trim，`rect` 是视口坐标（`getBoundingClientRect` 的语义，滚动后会变，
 * 所以跟随滚动时要重新读）。
 */
export function readSelection() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const text = selection.toString().trim()
  if (!text) return null

  const range = selection.getRangeAt(0)
  if (isOurUI(range.startContainer) || isOurUI(range.endContainer)) return null

  const rect = range.getBoundingClientRect()
  // 某些情况下（选区在 display:none 的节点里）会是全 0，这时没法定位
  if (!rect || (rect.width === 0 && rect.height === 0)) return null

  return {
    text,
    rect,
    tooLong: text.length > MAX_LOOKUP_LENGTH,
    container: range.startContainer,
    range,
  }
}

/** 当前选区是否已经塌陷（用户点掉了）。 */
export function isSelectionCollapsed() {
  const selection = window.getSelection()
  return !selection || selection.isCollapsed
}

/**
 * 重新测量同一个选区的矩形。
 *
 * 滚动时用它更新锚点位置；**不要**缓存 rect——它是视口坐标，滚动一次就失效了。
 * 选区消失（collapsed）返回 null，调用方据此关闭面板。
 */
export function remeasureSelectionRect() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) return null
  return rect
}
