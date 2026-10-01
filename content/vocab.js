/**
 * 生词本能力：把 background 的消息接口包成 render/vocab-star.js 期望的形状。
 *
 * 状态映射照搬阅读器的 `resultFromResponse`：409 → duplicate（已收藏）、401/403 →
 * unauthorized、其它 → error。**失败不阻断查询**，只在星标旁边给一条就地提示。
 */

import { CODE, MSG } from '../core/protocol.js'

async function send(type, payload) {
  try {
    return await chrome.runtime.sendMessage({ type, payload })
  } catch (error) {
    // SW 被回收 / 扩展刚更新时可能连不上
    return { ok: false, code: CODE.ERROR, message: error?.message || '扩展后台没有响应' }
  }
}

function toStatus(result) {
  if (result?.ok) return { status: 'ok' }
  if (result?.code === CODE.DUPLICATE) return { status: 'duplicate', message: result.message }
  if (result?.code === CODE.AUTH) return { status: 'unauthorized', message: result.message }
  return { status: 'error', message: result?.message || '操作失败' }
}

export function createVocabCapability(label = 'MyDict') {
  return {
    label,

    /** 该词在生词本里的记录：`Map<dictionaryId, itemId>`。失败时空 Map（星标显示 ☆）。 */
    async listSaved(word) {
      const result = await send(MSG.VOCAB_LIST, { word })
      if (!result?.ok) return new Map()
      return new Map(Object.entries(result.data.saved).map(([id, itemId]) => [Number(id), itemId]))
    },

    async addEntry({ dictionaryId, word }) {
      return toStatus(await send(MSG.VOCAB_ADD, { word, dictionaryId }))
    },

    async removeItem(itemId) {
      return toStatus(await send(MSG.VOCAB_REMOVE, { itemId }))
    },
  }
}
