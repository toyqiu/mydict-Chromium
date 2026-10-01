/**
 * 查词候选词队列 —— 有序、去重。
 *
 * 双击选中的词常带首尾空白，而导入的词典大多把小写当词头，所以拿选区原文精确匹配
 * 经常落空（`Hello`、`world␣` 都查不到 `hello`/`world`）。调用方按序尝试、命中即停，
 * 所以顺序有意义：**精确 → 全小写 → 首字母大写 → 全大写（缩写词头）→ 词形还原**。
 * lemma 放在最后，保证任何精确/大小写匹配都优先于它。
 *
 * 移植自 MyReader `src/services/dictionaries/lookupCandidates.ts`。
 */

import { lemmatizeEnglish } from './lemmatize.js'

/** 超过这个长度就不当词查了（不发请求）。 */
export const MAX_LOOKUP_LENGTH = 50

/**
 * 语言主标签：`en-US` → `en`。拿不到就返回空串。
 * （参考实现走 `@/utils/lang`，这里只用到这一个语义，就地实现。）
 */
export function primaryLangCode(lang) {
  if (typeof lang !== 'string') return ''
  const trimmed = lang.trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed.split(/[-_]/)[0] || ''
}

/**
 * 词形还原候选。语言归一化到主标签；语言缺失或未知时**默认按英文处理**——
 * 导入的词典绝大多数是英文的，而英文还原器对非 ASCII 文本是空操作。
 */
export function getLemmaCandidates(word, lang) {
  const code = primaryLangCode(lang) || 'en'
  return code === 'en' ? lemmatizeEnglish(word) : []
}

/** 见文件头。空白输入或超长返回 []。 */
export function buildLookupCandidates(word, lang) {
  const trimmed = (word ?? '').trim()
  if (!trimmed || trimmed.length > MAX_LOOKUP_LENGTH) return []
  const lower = trimmed.toLowerCase()
  const title = trimmed.charAt(0).toUpperCase() + lower.slice(1)
  const upper = trimmed.toUpperCase()
  const lemmas = getLemmaCandidates(lower, lang)
  return [...new Set([trimmed, lower, title, upper, ...lemmas])]
}
