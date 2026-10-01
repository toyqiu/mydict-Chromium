/**
 * 词条 HTML 清洗。移植自 MyReader `src/utils/sanitize.ts`。
 *
 * 用 DOMPurify 的**默认白名单 + 该词条自定义元素**，而不是手写一份标签表：词典的
 * HTML 横跨三十年，手写清单的必然结果是静默丢掉 `<font color>`、表格的 `bgcolor`
 * 或者某部词典的 `chn` 元素。放行的自定义元素都是惰性的（没有行为），保留它们才留得住
 * 词典自己的排版。
 *
 * 一句「什么都不执行」的保证：script / iframe / object / 表单控件 / `on*` 处理器全被去掉
 * （处理器很关键——`innerHTML` 不会执行 `<script>`，但会老老实实绑定 `onclick`）。
 */

import DOMPurify from '../vendor/purify.es.mjs'

/**
 * 词条永远不许带进来的标签。
 *
 * `link`/`style` 在这里是**故意的**：DOMPurify 会无条件丢掉它们（它们不是惰性的内联标记，
 * 会作用到清洗后的子树之外），所以渲染层先把词条自带的样式表挑出来、自己挂进 shadow。
 * 另外 `xmp`/`plaintext` 会吞掉后面所有字节，`<foreignObject>` 会在 SVG 里重新开 HTML。
 */
const FORBIDDEN_DICTIONARY_TAGS = [
  'script',
  'style',
  'link',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'base',
  'meta',
  'html',
  'head',
  'body',
  'title',
  'template',
  'noscript',
  'xmp',
  'plaintext',
  'foreignObject',
]

const TAG_NAME_RE = /<\s*([a-zA-Z][a-zA-Z0-9:_-]*)/g

/** 词条里出现过的、不在禁用名单里的标签名（供 DOMPurify 的 ADD_TAGS 用）。 */
function collectDictionaryTags(html) {
  const forbidden = new Set(FORBIDDEN_DICTIONARY_TAGS.map((tag) => tag.toLowerCase()))
  const tags = new Set()
  for (const match of html.matchAll(TAG_NAME_RE)) {
    const tag = match[1].toLowerCase()
    if (!forbidden.has(tag)) tags.add(tag)
  }
  return [...tags]
}

/** 清洗一条词典词条，返回可安全 `innerHTML` 的 HTML 字符串。 */
export function sanitizeDictionaryHtml(html) {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: collectDictionaryTags(html),
    FORBID_TAGS: FORBIDDEN_DICTIONARY_TAGS,
    // srcset 能让一个极小的 <img> 扇出成很多请求，而且服务端不重写它，直接丢掉
    FORBID_ATTR: ['srcset'],
    // DOMPurify 会丢掉它不认识的 URI scheme 的属性，那会静默杀掉 MDict 的
    // `entry://word` 交叉引用——服务端是**故意**留着这些给客户端拦截的。
    // 这一串是它的默认 scheme 列表再加上 entry。
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|entry):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  })
}
