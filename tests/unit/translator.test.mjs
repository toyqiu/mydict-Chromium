/**
 * core/translator.js 的纯逻辑：线路判定、源语言猜测、目标语言纠偏、会话缓存。
 * Edge 请求本身不打真实网络（fetch 打桩）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isTranslateCandidate,
  guessSourceLang,
  effectiveTargetLang,
  translateText,
  resetTranslatorCache,
  DEFAULT_TARGET_LANG,
} from '../../core/translator.js'

test('线路判定：短词查词典，全非字母≥6 走翻译', () => {
  // 词典侧
  assert.equal(isTranslateCandidate('house'), false) // 英文单词
  assert.equal(isTranslateCandidate('政府'), false) // 中文短词
  assert.equal(isTranslateCandidate('ペン'), false) // 日文短词
  assert.equal(isTranslateCandidate('おはよう'), false) // 4 个假名
  assert.equal(isTranslateCandidate('hello'), false) // 5 个字母
  // 翻译侧
  assert.equal(isTranslateCandidate('今天天气非常好'), true) // 7 个汉字
  assert.equal(isTranslateCandidate('これはペンです'), true) // 8 个字符（含假名）
  assert.equal(isTranslateCandidate('3.1415926'), true) // 全非字母
  assert.equal(isTranslateCandidate('これはペンです'), true)
})

test('线路判定：英文按词数，≥3 个单词走翻译', () => {
  assert.equal(isTranslateCandidate('go to bed'), true) // 3 词
  assert.equal(isTranslateCandidate('the quick brown fox'), true) // 4 词
  assert.equal(isTranslateCandidate('open the door'), true) // 3 词
  assert.equal(isTranslateCandidate('open door'), false) // 2 词，仍查词典
  assert.equal(isTranslateCandidate('rain cats and dogs'), true)
})

test('线路判定：混合与边界', () => {
  assert.equal(isTranslateCandidate('これはpenです'), false) // 含字母但英文词只有 1 个、总长 8 —— 按词数规则走词典
  assert.equal(isTranslateCandidate('  '), false) // 空白
  assert.equal(isTranslateCandidate(''), false)
  assert.equal(isTranslateCandidate(null), false)
})

test('源语言猜测：文字块特征', () => {
  assert.equal(guessSourceLang('こんにちは、世界'), 'ja') // 有假名 → 日
  assert.equal(guessSourceLang('안녕하세요'), 'ko')
  assert.equal(guessSourceLang('Привет'), 'ru')
  assert.equal(guessSourceLang('政府'), 'zh')
  assert.equal(guessSourceLang('hello world'), 'en')
})

test('目标语言纠偏：译成自己没意义', () => {
  // 选中中文、目标简中 → 改译英文
  assert.equal(effectiveTargetLang('今天天气很好', 'zh-Hans'), 'en')
  // 选中日文、目标日文 → 改译简中
  assert.equal(effectiveTargetLang('こんにちは', 'ja'), 'zh-Hans')
  // 正常情况原样返回
  assert.equal(effectiveTargetLang('こんにちは', 'zh-Hans'), 'zh-Hans')
  assert.equal(effectiveTargetLang('hello', 'zh-Hant'), 'zh-Hant')
  // 目标语言缺省时用默认值
  assert.equal(effectiveTargetLang('hello', undefined), DEFAULT_TARGET_LANG)
})

test('translateText：缓存命中不发请求，同文本不同目标语言各存一份', async () => {
  resetTranslatorCache()
  let calls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    calls += 1
    return {
      ok: true,
      json: async () => [{ translations: [{ text: `T${calls}` }] }],
    }
  }
  try {
    const first = await translateText('今天天气非常好', { targetLang: 'en', exact: true })
    assert.equal(first, 'T1')
    const second = await translateText('今天天气非常好', { targetLang: 'en', exact: true })
    assert.equal(second, 'T1') // 缓存命中
    assert.equal(calls, 1)
    const other = await translateText('今天天气非常好', { targetLang: 'ja', exact: true })
    assert.equal(other, 'T2') // 不同目标语言 → 新请求
    assert.equal(calls, 2)
    assert.equal(await translateText('   ', {}), '') // 空白不发起请求
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
    resetTranslatorCache()
  }
})

test('translateText：直连失败时降级 background', async () => {
  resetTranslatorCache()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch') // 模拟页面 CSP 拦截
  }
  try {
    const result = await translateText('これはペンです', {
      targetLang: 'zh-Hans',
      sendBackground: async (message) => {
        assert.equal(message.type, 'TRANSLATE')
        assert.equal(message.payload.to, 'zh-Hans')
        return { ok: true, data: ['这是钢笔。'] }
      },
    })
    assert.equal(result, '这是钢笔。')
    // 降级成功的结果同样进缓存：第二次不再调用
    let backgroundCalls = 0
    const again = await translateText('これはペンです', {
      targetLang: 'zh-Hans',
      sendBackground: async () => {
        backgroundCalls += 1
        return { ok: true, data: ['x'] }
      },
    })
    assert.equal(again, '这是钢笔。')
    assert.equal(backgroundCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    resetTranslatorCache()
  }
})
