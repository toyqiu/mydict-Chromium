/**
 * 划词翻译核心：判定规则、语言表、Edge 免 key 接口、缓存。
 *
 * 为什么不走 background（与 MyDict 查询不同）：MyDict 的 /api/v1/query 不返回 CORS 头，
 * 必须借 host 权限在 background 发请求；而 edge.microsoft.com 的翻译端点自带
 * `Access-Control-Allow-Origin`，content script / 扩展页直接 fetch 即可——不依赖任何
 * host 权限（Firefox 的可选权限因此完全不构成障碍）。页面 CSP 若拦 connect-src，
 * 由调用方降级到 background 兜底（见 translateWithFallback）。
 */

/** 设置里的默认目标语言。 */
export const DEFAULT_TARGET_LANG = 'zh-Hans'

/** 目标语言下拉的选项（value = Edge 接口接受的码）。 */
export const TRANSLATOR_LANGS = [
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' },
]

/** 翻译请求超时（毫秒）。Edge 接口实测 <1s，给足余量。 */
export const TRANSLATE_TIMEOUT_MS = 10000

// ---------------------------------------------------------------- 判定规则

/**
 * 选区/输入应走翻译链路还是词典链路？
 *
 * 规则（与用户确认过的口径一致）：
 *   - 不含英文字母：长度 ≥ 6 → 翻译（「政府」「ペン」等短词仍查词典）
 *   - 含英文字母：按空格切出的英文单词数 ≥ 3 → 翻译（"go to bed" 走翻译，
 *     "government" 这种单词仍查词典——词典里有词形还原兜着）
 */
export function isTranslateCandidate(text) {
  const raw = (text ?? '').trim()
  if (raw.length < 6) return false
  if (!/[A-Za-z]/.test(raw)) return true
  const words = raw.split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  return words.length >= 3
}

/**
 * 粗猜源语言（用于目标语言与源语言相同时的自动纠偏）。
 * 只看文字块特征，不做真检测：假名→日、谚文→韩、西里尔→俄、希腊→希腊、
 * 汉字主导→中、其余→英。
 */
export function guessSourceLang(text) {
  const raw = text ?? ''
  if (/[\u3040-\u30ff]/.test(raw)) return 'ja'
  if (/[\uac00-\ud7af]/.test(raw)) return 'ko'
  if (/[\u0400-\u04ff]/.test(raw)) return 'ru'
  if (/[\u0370-\u03ff]/.test(raw)) return 'el'
  if (/[\u4e00-\u9fff]/.test(raw)) return 'zh'
  return 'en'
}

/** 目标语言与源语言同桶时自动纠偏（译成自己没意义），返回可用的目标语言码。 */
export function effectiveTargetLang(text, setting) {
  const source = guessSourceLang(text)
  const target = setting || DEFAULT_TARGET_LANG
  if (source === 'zh' && (target === 'zh-Hans' || target === 'zh-Hant')) return 'en'
  if (source !== 'zh' && target.startsWith(source)) return 'zh-Hans'
  return target
}

// ---------------------------------------------------------------- Edge provider

const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'

const EDGE_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext'

/**
 * Edge 翻译。texts 与返回值一一对应。
 *
 * body 是**裸字符串数组**（不是对象包裹）；from 缺省即自动检测；
 * isEnterpriseClient=false 必带。端点无鉴权、无 key，但对 UA 敏感。
 */
export async function edgeTranslate(texts, { from = '', to } = {}) {
  const url = new URL(EDGE_ENDPOINT)
  url.searchParams.set('to', to)
  url.searchParams.set('isEnterpriseClient', 'false')
  if (from && from !== 'auto') url.searchParams.set('from', from)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': EDGE_UA },
      body: JSON.stringify(texts),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return data.map((item) => item?.translations?.[0]?.text ?? '')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 直连失败（页面 CSP 拦 connect-src 等）时降级走 background：
 * background 的 fetch 不受页面 CSP 约束，Chrome 的 host_permissions(<all_urls>)
 * 安装即授予；Firefox 下 edge 端点带 ACAO，标准 CORS 即可放行。
 * `sendBackground` 由调用方注入（content/popup 各自的 sendMessage 包装）。
 */
export async function translateWithFallback(texts, opts, sendBackground) {
  try {
    return await edgeTranslate(texts, opts)
  } catch (error) {
    if (!sendBackground) throw error
    const result = await sendBackground({ type: 'TRANSLATE', payload: { texts, ...opts } })
    if (!result?.ok) throw new Error(result?.message || 'translation failed')
    return result.data
  }
}

// ---------------------------------------------------------------- 缓存

/** 会话内缓存（内存 Map）。跨会话持久化没有必要：翻译请求本身只要几百毫秒。 */
const cache = new Map()
const CACHE_LIMIT = 200

const cacheKey = (text, from, to) => `${from || 'auto'}:${to}:${text}`

function cacheGet(key) {
  const value = cache.get(key)
  if (value === undefined) return undefined
  // 简单 LRU：命中就挪到队尾，超过上限丢掉最老的
  cache.delete(key)
  cache.set(key, value)
  return value
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value)
  }
  cache.set(key, value)
}

/**
 * 模块级单例入口：带缓存 + 纠偏 + background 降级的完整翻译调用。
 *
 * `exact: true` 表示调用方已让用户显式选过目标语言（弹窗里的下拉框），
 * 跳过「与源语言同桶自动纠偏」——用户明确要译成中文就译成中文。
 */
export async function translateText(text, { targetLang, from = '', sendBackground, exact = false } = {}) {
  const raw = (text ?? '').trim()
  if (!raw) return ''
  const to = exact ? (targetLang || DEFAULT_TARGET_LANG) : effectiveTargetLang(raw, targetLang)
  const key = cacheKey(raw, from, to)
  const cached = cacheGet(key)
  if (cached !== undefined) return cached
  const translated = (await translateWithFallback([raw], { from, to }, sendBackground))[0] ?? ''
  cacheSet(key, translated)
  return translated
}

/** 仅供测试：清空会话缓存。 */
export function resetTranslatorCache() {
  cache.clear()
}
