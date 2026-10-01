/**
 * 大图幻灯片的取材与打开。判定标准移植自 mydict 网页版 iframe_bootstrap.js：
 *
 *   - 用**渲染尺寸**而不是 naturalWidth：正文里到处是 16px 小图标（发音按钮、词性
 *     括号），点它们弹查看器很烦；一张大图被 CSS 缩成图标用，同样不该弹。
 *   - 同一词条里所有够大的图按文档顺序收集去重成一张表，弹查看器后可以翻页；
 *     点中的图万一不在表里（还没布局出来），退化为单张。
 *
 * 点击分流本身在 expandable.js（捕获阶段按容器识别）；这里只提供「从某个 img 打开」。
 */

import { openLightbox } from './lightbox.js'

const IMAGE_MIN_SIZE = 160

/** 收集 root 里所有「够大」的图，按文档顺序去重。 */
export function collectLargeImages(root) {
  const urls = []
  const seen = new Set()
  for (const node of root.querySelectorAll('img')) {
    const box = node.getBoundingClientRect()
    if (box.width < IMAGE_MIN_SIZE && box.height < IMAGE_MIN_SIZE) continue
    const url = node.currentSrc || node.src
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

/**
 * 从被点中的那张图打开幻灯片。
 * @param {HTMLImageElement} img 点中的图
 * @param {HTMLElement} root 所在词条的内容容器（收集范围）
 * @param {(urls: string[], index: number, alt: string) => void} [openImages]
 *   打开方式；缺省=当前上下文就地开遮罩。popup 传「开独立标签页」——弹窗是 460px
 *   的小窗，扫描图在弹窗内永远放不大。
 */
export function openImageInViewer(img, root, openImages) {
  const current = img.currentSrc || img.src
  const urls = collectLargeImages(root)
  let index = urls.indexOf(current)
  // 理论上点中的这张一定在表里（它刚被判为「够大」）；万一因为还没布局出来而漏了，
  // 退化成单张，总比翻到一张空白好
  if (index < 0) {
    urls.length = 0
    urls.push(current)
    index = 0
  }
  ;(openImages ?? openLightbox)(urls, index, img.alt || '')
}
