/**
 * 词条图片交互：词典自管的「缩略图 ⇄ 大图」展开 + 大图幻灯片。
 *
 * 移植自 mydict 网页版 iframe_bootstrap.js 的点击分流算法（提交 a04fb7c），针对扩展
 * 的两点调整：词条不在 iframe 里（直接渲染进 scope shadow），词典自带的 onclick 与
 * 脚本被 DOMPurify 剥掉了——所以「带 onclick 的容器」改按**结构**识别（#ox-enlarge /
 * a.topic / .pic_thumb / .big_pic），展开/收起也由这里自己做。
 *
 * **血泪教训（网页版同款）：不能依赖 event.target 是 <img>。**合成 click 的 target
 * 恰好是 img、测试全绿；真实鼠标点击命中的是悬停放大镜角标（.ox-enlarge-label）、
 * <a> 或容器本身。所以监听挂 **捕获阶段**、按容器分流：
 *
 *   - 第10版：`#ox-enlarge`（或 a.topic）里可见图是 fullsize = 展开态 → 拦掉词典的
 *     「缩回去」改弹幻灯片；可见图是 thumb = 收起态 → 原地展开；
 *   - 第9版：`.big_pic` = 展开态 → 幻灯片；`.pic_thumb` = 收起态 → 原地展开；
 *   - 其余裸 <img>（无链接包裹、≥160px）→ 幻灯片；链接包裹的图交给链接逻辑。
 */

import { openImageInViewer } from './images.js'

const IMAGE_MIN_SIZE = 160

const COLLAPSE_BTN_CSS = [
  'display: inline-block',
  'margin: 2px 0 6px',
  'padding: 1px 10px',
  'font: 12px/1.7 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  'border: 1px solid rgba(127, 127, 127, 0.55)',
  'border-radius: 10px',
  'background: rgba(127, 127, 127, 0.14)',
  'color: inherit',
  'cursor: pointer',
  'user-select: none',
].join(';')

/** 容器里当前有布局盒的 img；全隐藏返回 null（收起态/展开态的判定依据）。 */
function visibleImageIn(container) {
  for (const img of container.querySelectorAll('img')) {
    if (img.getBoundingClientRect().width > 0) return img
  }
  return null
}

/** oald10.css 把 .thumb 和 .fullsize 都 display:none 了（网页版靠词条 JS 初始化显示
 *  缩略图，扩展里脚本被剥掉）——接线时用内联 !important 恢复网页版的可见状态。 */
function forceInitialVisibility(root) {
  for (const thumb of root.querySelectorAll('img.thumb')) {
    thumb.style.setProperty('display', 'block', 'important')
    thumb.style.cursor = 'pointer'
    let full = thumb.previousElementSibling
    for (
      let hop = 0;
      full && hop < 3 && !(full instanceof HTMLImageElement && full.classList.contains('fullsize'));
      hop++
    ) {
      full = full.previousElementSibling
    }
    if (full instanceof HTMLImageElement && full.classList.contains('fullsize')) {
      full.style.setProperty('display', 'none', 'important')
    }
  }
}

export function wireImageInteractions(root, openImages) {
  forceInitialVisibility(root)

  root.addEventListener(
    'click',
    (event) => {
      const node = event.target
      if (!(node instanceof Element)) return
      // 「收起」按钮自己处理（它不在任何图容器里，但明确跳过最稳）
      if (node.closest('button[data-mydict-collapse]')) return
      // 链接包裹的图走链接逻辑（wireLinks 已处理），这里不抢
      if (node.closest('a[href]')) return

      // ---- 第9版：展开态（big_pic）→ 幻灯片；拦掉词典的「缩回去」 ----
      const big9 = node.closest('.big_pic')
      if (big9) {
        const img = visibleImageIn(big9)
        if (img) {
          event.preventDefault()
          event.stopPropagation()
          openImageInViewer(img, root, openImages)
        }
        return
      }

      // ---- 第9版：收起态（pic_thumb）→ 原地展开（词典 JS 被剥了，这里自己做） ----
      const thumb9 = node.closest('.pic_thumb')
      if (thumb9) {
        const pic = thumb9.closest('.pic') ?? thumb9.parentElement
        const big9b = pic?.querySelector('.big_pic')
        if (big9b) {
          event.preventDefault()
          event.stopPropagation()
          expand9(thumb9, big9b)
        }
        return
      }

      // ---- 第10版：#ox-enlarge / a.topic 容器 ----
      const topic = node.closest('a.topic')
      const ox =
        node.closest('#ox-enlarge') ??
        (topic && (topic.querySelector('img.thumb') || topic.querySelector('img.fullsize')) ? topic : null)
      if (ox) {
        const img = visibleImageIn(ox)
        if (!img) return
        event.preventDefault()
        event.stopPropagation()
        if (img.classList.contains('fullsize')) {
          openImageInViewer(img, root, openImages) // 展开态 → 幻灯片，不缩回去
        } else {
          expandTopic(ox) // 收起态 → 原地展开
        }
        return
      }

      // ---- 通用：无链接包裹、渲染尺寸 ≥160px 的裸 <img> → 幻灯片 ----
      if (node.tagName === 'IMG') {
        const box = node.getBoundingClientRect()
        if (box.width >= IMAGE_MIN_SIZE || box.height >= IMAGE_MIN_SIZE) {
          event.preventDefault()
          event.stopPropagation()
          openImageInViewer(node, root, openImages)
        }
      }
    },
    true, // capture：真实点击命中角标/容器时也能按容器分流
  )
}

/* ------------------------------ 展开与收起 ------------------------------ */

/** 展开后挂在图旁的「收起」按钮；点击收回缩略图（两个结构共用）。 */
function ensureCollapseBtn(anchor, collapse) {
  let btn = anchor.nextElementSibling
  if (!(btn instanceof HTMLButtonElement && btn.dataset.mydictCollapse)) {
    btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = '收起'
    btn.title = '收起拓展图'
    btn.dataset.mydictCollapse = '1'
    btn.style.cssText = COLLAPSE_BTN_CSS
    anchor.after(btn)
  }
    btn.hidden = false
    btn.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      btn.hidden = true
      collapse()
    }
    return btn
}

/** 第10版：容器内 thumb ⇄ fullsize。 */
function expandTopic(ox) {
  const thumb = ox.querySelector('img.thumb')
  const full = ox.querySelector('img.fullsize')
  if (!thumb || !full) return
  thumb.style.setProperty('display', 'none', 'important')
  full.style.setProperty('display', 'block', 'important')
  ensureCollapseBtn(full, () => {
    full.style.setProperty('display', 'none', 'important')
    thumb.style.setProperty('display', 'block', 'important')
  })
}

/** 第9版：pic_thumb ⇄ big_pic。 */
function expand9(thumbBox, bigBox) {
  thumbBox.style.display = 'none'
  bigBox.style.setProperty('display', 'block', 'important')
  ensureCollapseBtn(bigBox, () => {
    bigBox.style.setProperty('display', 'none', 'important')
    thumbBox.style.display = ''
  })
}
