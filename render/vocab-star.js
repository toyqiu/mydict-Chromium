/**
 * 分组头里的生词本星标 —— 每个词典分组一个。
 *
 * 生词本是**词条级**的（`(词典, 词头)` 一条），所以「存哪部词典的释义」由用户点哪个星标
 * 决定，而不是程序替他挑一条：中文词典的『人気』与 NHK 的『人気』可以并存。
 *
 * 状态一律以服务端为准——挂载时查一次，每次增删后再对账，所以在另一台设备上的改动也能
 * 自愈。点击不冒泡：分组头在 <summary> 里，冒泡会把分组折起来。
 */

/**
 * @param {HTMLElement} summary 分组头（`<summary>`）
 * @param {object} options
 * @param {object} options.capability 生词本能力（见 content/vocab.js）
 * @param {number} options.dictionaryId 该分组的词典 id
 * @param {string} options.word **词头**（该分组首条命中的 word），不是选区原文
 * @param {(word: string) => Promise<Map<number, number>>} options.savedFor 共享的已收藏查询
 * @param {(type: string, message: string) => void} options.onNotify 就地提示
 */
export function attachVocabStar(summary, options) {
  const { capability, dictionaryId, word, savedFor, onNotify } = options
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'mydict-vocab-star'
  let itemId = null
  let busy = false

  const render = () => {
    const saved = itemId !== null
    button.textContent = saved ? '★' : '☆'
    button.classList.toggle('saved', saved)
    button.disabled = busy
    const label = saved ? '从生词本移除' : '加入生词本'
    button.setAttribute('aria-label', label)
    button.title = `${label}（${capability.label}）`
  }

  const reportFailure = (result) => {
    if (result?.status === 'duplicate') onNotify('warn', result.message || '这个词已经收藏过了')
    else if (result?.status === 'unauthorized') onNotify('error', '生词本不可用，检查一下 Token')
    else if (result?.status === 'error') onNotify('error', result.message || '操作失败')
  }

  /** 与服务端对账，拿到该词在这部词典里的条目 id。增删后也靠它收敛。 */
  const sync = async (savedPromise) => {
    try {
      itemId = (await savedPromise).get(dictionaryId) ?? null
    } catch {
      itemId = null
    }
    render()
  }

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    busy = true
    render()
    void (async () => {
      try {
        if (itemId === null) {
          const result = await capability.addEntry({ dictionaryId, word })
          if (result.status === 'ok') onNotify('ok', `已加入生词本（${capability.label}）`)
          else reportFailure(result)
        } else {
          const result = await capability.removeItem(itemId)
          if (result.status === 'ok') onNotify('ok', `已从生词本移除（${capability.label}）`)
          else reportFailure(result)
        }
        // 无论成败都重新对账：失败时把乐观态收回来，成功时拿到新 id
        await sync(capability.listSaved(word))
      } finally {
        busy = false
        render()
      }
    })()
  })

  render()
  void sync(savedFor(word))
  summary.appendChild(button)
}
