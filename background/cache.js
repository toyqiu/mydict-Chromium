/**
 * 带 TTL 的小缓存，只活在 service worker 生命周期内（SW 被回收就没了，这是可接受的——
 * 它只用来挡「同一个词反复查」「面板里反复 listSaved」这类短时间内的重复请求）。
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 80

export function createCache({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  /** @type {Map<string, {value: unknown, expiresAt: number}>} */
  const store = new Map()

  return {
    get(key) {
      const hit = store.get(key)
      if (!hit) return undefined
      if (hit.expiresAt <= Date.now()) {
        store.delete(key)
        return undefined
      }
      // 命中就挪到队尾，配合下面的「超限删最旧」当简易 LRU 用
      store.delete(key)
      store.set(key, hit)
      return hit.value
    },

    set(key, value, ttl = ttlMs) {
      if (store.size >= maxEntries) {
        const oldest = store.keys().next().value
        if (oldest !== undefined) store.delete(oldest)
      }
      store.set(key, { value, expiresAt: Date.now() + ttl })
    },

    delete(key) {
      store.delete(key)
    },

    /** 前缀失效（生词本变更后，把该词相关的 listSaved 缓存清掉）。 */
    deleteByPrefix(prefix) {
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key)
      }
    },

    clear() {
      store.clear()
    },
  }
}
