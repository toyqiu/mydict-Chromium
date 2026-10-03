/**
 * 划选后浮在选区旁边的小图标。点它才开面板（`trigger=icon`，默认）。
 *
 * 用独立的 shadow root：页面 CSS 里「button { ... }」「* { ... }」这类规则太常见了，
 * 不隔离的话这个按钮会被改成各种样子。位置用 `position: fixed`，跟随滚动时重算。
 */

import { UI_ATTR } from './selection.js'
import { computeIconPlacement } from './position.js'

const ICON_SIZE = 24

const ICON_CSS = `
  :host { all: initial; }
  button {
    all: unset;
    box-sizing: border-box;
    width: ${ICON_SIZE}px;
    height: ${ICON_SIZE}px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #2f6f5e;
    color: #fff;
    font: 600 13px/1 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
    user-select: none;
    transition: transform 0.12s ease;
  }
  button:hover { transform: scale(1.12); }
  @media (prefers-color-scheme: dark) {
    button { background: #4aa88c; color: #0d1114; }
  }
`

/**
 * 宿主的"免疫"内联样式。
 *
 * 有些页面（或广告拦截类扩展）会注入 `position: fixed` 的元素一律改成 absolute 并
 * `display:none !important` 的样式表——我们的浮标正是 fixed 定位，会被当成悬浮广告干掉，
 * 表象就是「选词后浮标不出现」。内联 `!important` 的优先级高于样式表里的 `!important`，
 * 所以这里所有关键属性都带 !important。
 */
const IMMUNE = {
  position: 'fixed',
  'z-index': '2147483647',
  width: ICON_SIZE + 'px',
  height: ICON_SIZE + 'px',
  display: 'none',
  'pointer-events': 'auto',
  visibility: 'visible',
  opacity: '1',
  margin: '0',
  transform: 'none',
  // 注意：这里**不能**放 `inset`——它在对象里排在 top/left 之后，applyImmune 按顺序
  // 应用时会把 show() 刚设置的定位又重置回 auto，浮标就会落到文档流的静态位置
  // （页面底部、视口之外），看起来就是「选词后浮标不出现」。
}

function applyImmune(el, overrides = {}) {
  for (const [prop, value] of Object.entries({ ...IMMUNE, ...overrides })) {
    el.style.setProperty(prop, value, 'important')
  }
}

export function createTriggerIcon({ onActivate }) {
  const host = document.createElement('div')
  host.setAttribute(UI_ATTR, 'icon')
  applyImmune(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = ICON_CSS
  const button = document.createElement('button')
  button.type = 'button'
  // 形态随选区类型切换：像词 → 「词」（查词典）；像句子 → 「译」（走翻译）。
  // 切换由 show() 的 mode 参数驱动，点击行为不变（都打开面板，面板里再切标签）。
  button.textContent = '词'
  button.title = '用 MyDict 查这个词'
  button.setAttribute('aria-label', '用 MyDict 查这个词')
  // 按下时就阻止默认行为，否则会把已经建立的选区清掉，面板拿不到词
  button.addEventListener('pointerdown', (event) => event.preventDefault())
  // 触屏直达激活：部分安卓内核在 pointerdown 被阻止默认后不再派发 click，浮标点了
  // 没反应。触摸路径在 pointerup 直接激活，并压掉随后可能出现的合成 click 避免
  // 开两次面板（桌面鼠标路径照旧走 click）。
  let touchActivated = false
  button.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'touch') return
    touchActivated = true
    onActivate()
    setTimeout(() => {
      touchActivated = false
    }, 500)
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (touchActivated) return
    onActivate()
  })
  shadow.append(style, button)

  function show(rect, mode = 'word', placement = 'br') {
    const translate = mode === 'translate'
    button.textContent = translate ? '译' : '词'
    const title = translate ? '用 MyDict 翻译这段文字（点「词」也可查词典）' : '用 MyDict 查这个词'
    button.title = title
    button.setAttribute('aria-label', title)
    const { left, top } = computeIconPlacement(rect, ICON_SIZE, placement)
    applyImmune(host, { display: 'block', top: top + 'px', left: left + 'px' })
  }

  function hide() {
    applyImmune(host, { display: 'none' })
  }

  return {
    host,
    show,
    hide,
    get visible() {
      return host.style.display !== 'none'
    },
  }
}
