/**
 * lightbox.html 的脚本：从 URL 参数取图片表，挂上与大图查看器同一套遮罩。
 * 关闭（Esc / 点空白）时关掉这个标签页——tabs.create 打开的标签允许 window.close()。
 */

import { openLightbox } from './render/lightbox.js'

const params = new URLSearchParams(location.search)

let urls = []
try {
  const raw = JSON.parse(params.get('urls') || '[]')
  if (Array.isArray(raw)) urls = raw.filter((u) => typeof u === 'string' && !!u)
} catch {
  /* 参数坏了就当单张处理，下面兜底 */
}
if (urls.length === 0 && params.get('src')) urls = [params.get('src')]

const indexRaw = Number.parseInt(params.get('index') || '0', 10)
const index = Number.isInteger(indexRaw) && indexRaw >= 0 && indexRaw < urls.length ? indexRaw : 0
const alt = params.get('alt') || ''

if (urls.length === 0) {
  document.body.textContent = '没有可显示的图片'
} else {
  openLightbox(urls, index, alt, () => window.close())
}
