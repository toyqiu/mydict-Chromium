/**
 * 大图查看器（幻灯片遮罩）。移植自 mydict 网页版的 `ImageLightbox.vue`。
 *
 * 起因同网页版：扫描版词典（辞海）的词条就是一整页 3383×5184 的扫描图，按容器宽度
 * 显示后一页上的多栏小字根本读不了，必须能放大了平移着看。
 *
 * 与网页版的两个结构差异：
 *   - 网页版用 `<Teleport to="body">`；这里 content script 直接把宿主挂到
 *     `documentElement` 上（比 body 更不容易被页面级的 transform/filter 破坏 fixed 定位），
 *     popup 则挂到自己的 body。挂载点由调用方通过 `mountLightbox` 决定。
 *   - **宿主必须上「免疫内联样式」**：用户的 Windows Chrome 上有反悬浮广告的样式表，
 *     会把 fixed 元素一律改成 absolute 并 display:none !important（见 trigger-icon.js 的教训），
 *     内联 !important 才压得住。
 *
 * 交互与网页版一致：滚轮缩放（锚定光标）、拖动平移、点空白/Esc 退出、←/→ 或侧边按钮翻页。
 * Esc 在 **window 捕获阶段**拦截并 stopImmediatePropagation——面板自己的 Esc 关闭监听
 * 挂在 document 捕获上，window 先于 document，这样灯箱开着时按 Esc 只关灯箱、不关面板
 * （网页版用同样的手法挡查询页的全局快捷键）。
 */

const WHEEL_SENSITIVITY = 0.0015 // 单次滚轮缩放步长；deltaY 量级跨设备差异大，用指数保证手感一致
const MIN_ZOOM = 0.5 // 相对「适应视口」的缩放上下限
const MAX_ZOOM = 20
const DRAG_THRESHOLD = 4 // 超过才算拖动，否则松手会被当成「点了空白」而退出

const LIGHTBOX_CSS = `
  :host { all: initial; }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    overflow: hidden;
    background: rgba(10, 14, 12, 0.86);
    touch-action: none;
    cursor: grab;
  }
  .overlay.dragging { cursor: grabbing; }
  .overlay img {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    max-width: none;
    user-select: none;
    -webkit-user-drag: none;
    cursor: grab;
  }
  .overlay.dragging img { cursor: grabbing; }
  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 72px;
    border: none;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    font-size: 30px;
    line-height: 1;
    cursor: pointer;
  }
  .nav:hover { background: rgba(255, 255, 255, 0.28); }
  .nav.prev { left: 16px; }
  .nav.next { right: 16px; }
  .nav[hidden] { display: none; }
  .hint {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 4px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    font: 13px/1.6 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    pointer-events: none;
    white-space: nowrap;
  }
  .hint[hidden] { display: none; }
`

let instance = null

/** 给遮罩宿主上免疫内联样式（全带 !important，压过广告拦截样式表的 !important）。 */
function immuneStyles(el) {
  const rules = {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    'z-index': '2147483647',
    width: '100vw',
    height: '100vh',
    margin: '0',
    padding: '0',
    border: 'none',
    background: 'transparent',
    transform: 'none',
    filter: 'none',
    opacity: '1',
    visibility: 'visible',
    display: 'none',
  }
  for (const [prop, value] of Object.entries(rules)) el.style.setProperty(prop, value, 'important')
}

/**
 * 打开大图查看器（已开着就复用）。同一词条有多张大图时 `urls` 带整张表，可以翻页。
 * @param {string[]} urls 文档顺序的去重大图地址
 * @param {number} index 当前点中的这张在 urls 里的下标
 * @param {string} [alt]
 * @param {() => void} [onClose] 关闭回调（lightbox.html 标签页用它关闭自己）
 */
export function openLightbox(urls, index, alt = '', onClose) {
  if (!instance) instance = createInstance()
  instance.onClose = onClose
  if (!instance.host.isConnected) {
    // content script 挂到 documentElement：比 body 更不容易被页面级 transform/filter
    // 破坏 fixed 定位（popup 不走这里，见 popup.js 的 openImages）
    ;(document.documentElement ?? document.body).appendChild(instance.host)
  }
  instance.open(urls, index, alt)
}

/** 灯箱是否开着。面板的「点外部关闭」要用它让路。 */
export function isLightboxOpen() {
  return instance?.isOpen ?? false
}

/** 关灯箱（面板关闭时收尾用）。 */
export function closeLightbox() {
  instance?.close()
}

function createInstance() {
  const host = document.createElement('div')
  host.setAttribute('data-myreader-dict-ui', 'lightbox')
  immuneStyles(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = LIGHTBOX_CSS
  const overlay = document.createElement('div')
  overlay.className = 'overlay'
  const img = document.createElement('img')
  img.draggable = false
  overlay.appendChild(img)
  const prevBtn = document.createElement('button')
  prevBtn.type = 'button'
  prevBtn.className = 'nav prev'
  prevBtn.title = '上一张（←）'
  prevBtn.textContent = '‹'
  const nextBtn = document.createElement('button')
  nextBtn.type = 'button'
  nextBtn.className = 'nav next'
  nextBtn.title = '下一张（→）'
  nextBtn.textContent = '›'
  const hint = document.createElement('p')
  hint.className = 'hint'
  overlay.append(prevBtn, nextBtn, hint)
  shadow.append(style, overlay)

  let urls = []
  let index = 0
  let isOpen = false
  let fitScale = 1
  let scale = 1
  let offsetX = 0
  let offsetY = 0
  let dragging = false
  let moved = 0
  let pointerStartX = 0
  let pointerStartY = 0
  let offsetStartX = 0
  let offsetStartY = 0

  /** 让整张图完整可见并居中；缩放上下限都相对这个基准。 */
  function fitToViewport() {
    const naturalWidth = img.naturalWidth || 1
    const naturalHeight = img.naturalHeight || 1
    const viewWidth = overlay.clientWidth || window.innerWidth
    const viewHeight = overlay.clientHeight || window.innerHeight
    fitScale = Math.min(viewWidth / naturalWidth, viewHeight / naturalHeight)
    scale = fitScale
    offsetX = (viewWidth - naturalWidth * fitScale) / 2
    offsetY = (viewHeight - naturalHeight * fitScale) / 2
    applyTransform()
  }

  function applyTransform() {
    img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`
  }

  function clampScale(next) {
    const low = Math.max(fitScale * MIN_ZOOM, 0.01)
    return Math.min(Math.max(next, low), fitScale * MAX_ZOOM)
  }

  /** 缩放锚定光标：保持光标下的图片坐标点不动，否则想看的细节会跑出视口。 */
  function onWheel(event) {
    event.preventDefault()
    const rect = overlay.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const next = clampScale(scale * Math.exp(-event.deltaY * WHEEL_SENSITIVITY))
    const ratio = next / scale
    offsetX = pointerX - (pointerX - offsetX) * ratio
    offsetY = pointerY - (pointerY - offsetY) * ratio
    scale = next
    applyTransform()
  }

  function onPointerDown(event) {
    // 翻页按钮上的按下不能开拖：setPointerCapture 会把后续指针事件转给遮罩，
    // 按钮就收不到 click 了
    if (event.target !== overlay && event.target !== img) return
    dragging = true
    moved = 0
    pointerStartX = event.clientX
    pointerStartY = event.clientY
    offsetStartX = offsetX
    offsetStartY = offsetY
    overlay.classList.add('dragging')
    overlay.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event) {
    if (!dragging) return
    const dx = event.clientX - pointerStartX
    const dy = event.clientY - pointerStartY
    moved = Math.max(moved, Math.abs(dx) + Math.abs(dy))
    offsetX = offsetStartX + dx
    offsetY = offsetStartY + dy
    applyTransform()
  }

  function onPointerUp() {
    dragging = false
    overlay.classList.remove('dragging')
  }

  /** 只有点在图片以外的空白、且刚才没在拖动时才退出。 */
  function onOverlayClick(event) {
    if (moved > DRAG_THRESHOLD) return
    if (event.target === overlay) close()
  }

  function go(delta) {
    const next = index + delta
    if (next < 0 || next >= urls.length) return
    open(urls, next)
  }

  /** window 捕获阶段拦 Esc / ←/→：先于面板挂在 document 上的监听，stopImmediatePropagation
   *  让它收不到，灯箱开着时面板就不会被一起关掉。 */
  function onKeydown(event) {
    if (!isOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopImmediatePropagation()
      go(event.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  function render() {
    const hasSiblings = urls.length > 1
    prevBtn.hidden = !hasSiblings || index <= 0
    nextBtn.hidden = !hasSiblings || index >= urls.length - 1
    hint.hidden = false
    hint.textContent = `${hasSiblings ? `${index + 1} / ${urls.length} · ` : ''}滚轮缩放 · 拖动移动${
      hasSiblings ? ' · ← → 翻页' : ''
    } · Esc 或点空白处退出`
  }

  function open(nextUrls, nextIndex, alt = '') {
    urls = nextUrls
    index = nextIndex
    isOpen = true
    host.style.setProperty('display', 'block', 'important')
    img.alt = alt
    img.src = urls[index] ?? ''
    render()
    if (!img.complete) fitToViewport() // 尺寸未知的先按视口适配，onLoad 再精确 fit
  }

  function close() {
    isOpen = false
    host.style.setProperty('display', 'none', 'important')
    img.removeAttribute('src')
    const cb = instance && instance.onClose
    if (instance) instance.onClose = undefined
    if (cb) cb()
  }

  img.addEventListener('load', fitToViewport)
  img.addEventListener('error', () => {
    hint.textContent = '图片加载失败'
  })
  overlay.addEventListener('wheel', onWheel, { passive: false })
  overlay.addEventListener('pointerdown', onPointerDown)
  overlay.addEventListener('pointermove', onPointerMove)
  overlay.addEventListener('pointerup', onPointerUp)
  overlay.addEventListener('pointercancel', onPointerUp)
  overlay.addEventListener('click', onOverlayClick)
  prevBtn.addEventListener('pointerdown', (event) => event.stopPropagation())
  nextBtn.addEventListener('pointerdown', (event) => event.stopPropagation())
  prevBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    go(-1)
  })
  nextBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    go(1)
  })
  window.addEventListener('keydown', onKeydown, true)

  return {
    host,
    open,
    close,
    get isOpen() {
      return isOpen
    },
  }
}
