/**
 * 词条里的资源引用改写 + 把词条自带的样式表挑出来。
 *
 * 服务端把词条里的图片/音频/字体/交叉引用都改写成根相对路径 `/dict-res/<id>/res/…`。
 * 不处理的话浏览器会拿**当前网页的 origin** 去解析，于是每张图、每段音频都 404。
 *
 * 扩展这里比阅读器简单：不需要同源中继，直接拼成 mydict 的绝对 HTTPS 地址就行——
 * `/dict-res/` 是公开只读的（不校验 token）且带 `Access-Control-Allow-Origin: *`。
 * 好处是词典 CSS 里的相对 `url(…)` 也能自然解析到正确的兄弟文件。
 */

import { buildResourceUrl, isDictResPath } from '../core/mydict-url.js'

/** 会去网络上取东西的元素；顺手给它们挂上 no-referrer，别把用户当前页面地址泄露给 mydict。 */
const RESOURCE_SELECTOR =
  'img[src], audio[src], video[src], source[src], track[src], a[href], link[href]'

/** 只是个引用（不取资源），不需要 referrerpolicy，但改了也没坏处。 */
function rewrite(root, baseUrl) {
  if (!baseUrl) return
  root.querySelectorAll(RESOURCE_SELECTOR).forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : 'href'
    const raw = el.getAttribute(attr)
    if (!raw || !isDictResPath(raw)) return
    el.setAttribute(attr, buildResourceUrl(baseUrl, raw))
    // 只给真的会发起子资源请求的挂；<a> 不需要（点了才走，且那时是用户的显式动作）
    if (attr === 'src') el.setAttribute('referrerpolicy', 'no-referrer')
  })
}

/**
 * 把一棵子树里的 `/dict-res/…` 引用全部改写成绝对地址。
 *
 * **必须在节点接入 DOM 之前跑**：浏览器一挂载就开始取，根相对 URL 当场打到错误的 origin。
 * 调用方的做法是先塞进惰性的 `<template>`，改完再 append。
 */
export function absolutizeResourceRefs(root, baseUrl) {
  rewrite(root, baseUrl)
}

/* ------------------------------------------------------------- 词条自带样式 */

const STYLE_LINK_RE = /<link\b[^>]*>/gi
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi
const ATTR_RE = (name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
const REL_ATTR_RE = ATTR_RE('rel')
const HREF_ATTR_RE = ATTR_RE('href')
/** 一条失控的词条不该让面板去加载几百张样式表。 */
const MAX_ENTRY_STYLES = 20

function attrValue(tag, re) {
  const match = re.exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

/**
 * 把词条 HTML 里的 `<link rel=stylesheet>` 与 `<style>` 挑出来，做成可直接挂进该词典
 * shadow 的节点。
 *
 * 为什么必须单独挑：DOMPurify 会无条件丢掉这两类标签（见 sanitize.js 的说明），
 * 但大辞泉/千篇/优词这些词典的 CSS 就在 `.mdx` 旁边。挂进**该词典自己的 shadow**，
 * 它们就既能生效又不会污染别的分组。
 */
export function extractEntryStyles(html, baseUrl) {
  const nodes = []

  for (const match of html.matchAll(STYLE_LINK_RE)) {
    if (nodes.length >= MAX_ENTRY_STYLES) break
    if (!/stylesheet/i.test(attrValue(match[0], REL_ATTR_RE) ?? '')) continue
    const href = attrValue(match[0], HREF_ATTR_RE)
    if (!href) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.setAttribute('href', buildResourceUrl(baseUrl, href))
    link.setAttribute('referrerpolicy', 'no-referrer')
    nodes.push(link)
  }

  for (const match of html.matchAll(STYLE_BLOCK_RE)) {
    if (nodes.length >= MAX_ENTRY_STYLES) break
    const style = document.createElement('style')
    // 用 textContent 而不是 innerHTML：CSS 不是标记，不该被当标记解析
    style.textContent = match[1] ?? ''
    nodes.push(style)
  }

  return nodes
}
