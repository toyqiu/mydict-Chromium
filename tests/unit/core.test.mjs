/**
 * core/ 纯逻辑单测。跑法：
 *   /vol1/@appcenter/nodejs_v22/bin/node --test chrome/tests/unit/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildLookupCandidates, primaryLangCode } from '../../core/lookup-candidates.js'
import { lemmatizeEnglish } from '../../core/lemmatize.js'
import {
  buildQueryUrl,
  buildResourceUrl,
  buildVocabItemUrl,
  buildVocabListUrl,
  buildVocabUrl,
  isDictResPath,
  isValidBase,
  normalizeBase,
} from '../../core/mydict-url.js'
import { isBlocked } from '../../core/settings.js'

// ---------------------------------------------------------------- 候选词

test('候选词：精确 → 小写 → 首字母大写 → 全大写', () => {
  // 'Hello' 的 title 变体就是它自己，去重后只剩三个
  assert.deepEqual(buildLookupCandidates('Hello'), ['Hello', 'hello', 'HELLO'])
})

test('候选词：先 trim 再生成变体', () => {
  // 双击选中的词常带尾随空格；不 trim 的话精确匹配必然落空
  assert.deepEqual(buildLookupCandidates('  world  '), ['world', 'World', 'WORLD'])
})

test('候选词：全小写输入不会产生重复项', () => {
  assert.deepEqual(buildLookupCandidates('cat'), ['cat', 'Cat', 'CAT'])
})

test('候选词：缩写词头会被全大写变体覆盖', () => {
  assert.deepEqual(buildLookupCandidates('usa'), ['usa', 'Usa', 'USA'])
})

test('候选词：词形还原排在精确/大小写之后', () => {
  const out = buildLookupCandidates('ran')
  assert.equal(out[0], 'ran', '原文永远排第一')
  assert.ok(out.includes('run'), '应包含 lemma run')
  assert.ok(
    out.indexOf('run') > out.indexOf('RAN'),
    'lemma 必须排在所有精确/大小写变体之后（空结果才会走到它）',
  )
})

test('候选词：空输入与超长返回 []', () => {
  assert.deepEqual(buildLookupCandidates(''), [])
  assert.deepEqual(buildLookupCandidates('   '), [])
  assert.deepEqual(buildLookupCandidates('a'.repeat(51)), [], '超过 50 字不发请求')
  assert.equal(buildLookupCandidates('a'.repeat(50)).length > 0, true, '正好 50 字仍要查')
})

test('候选词：语言主标签归一化', () => {
  assert.equal(primaryLangCode('en-US'), 'en')
  assert.equal(primaryLangCode('zh_Hant'), 'zh')
  assert.equal(primaryLangCode(''), '')
  assert.equal(primaryLangCode(undefined), '')
})

// ---------------------------------------------------------------- lemma

test('lemma：不规则动词', () => {
  assert.ok(lemmatizeEnglish('ran').includes('run'))
  assert.ok(lemmatizeEnglish('went').includes('go'))
  assert.ok(lemmatizeEnglish('thought').includes('think'))
})

test('lemma：不规则复数与比较级', () => {
  assert.ok(lemmatizeEnglish('mice').includes('mouse'))
  assert.ok(lemmatizeEnglish('children').includes('child'))
  assert.ok(lemmatizeEnglish('better').includes('good'))
})

test('lemma：规则后缀（含双写辅音）', () => {
  assert.ok(lemmatizeEnglish('cities').includes('city'))
  assert.ok(lemmatizeEnglish('stopped').includes('stop'))
  assert.ok(lemmatizeEnglish('running').includes('run'))
  assert.ok(lemmatizeEnglish('making').includes('make'))
  assert.ok(lemmatizeEnglish('analyses').includes('analysis'))
  assert.ok(lemmatizeEnglish('quickly').includes('quick'))
})

test('lemma：所有格', () => {
  assert.ok(lemmatizeEnglish("cat's").includes('cat'))
})

test('lemma：非 ASCII / 非单词一律不处理', () => {
  assert.deepEqual(lemmatizeEnglish('政府'), [])
  assert.deepEqual(lemmatizeEnglish('123'), [])
  assert.deepEqual(lemmatizeEnglish('two words'), [])
  assert.deepEqual(lemmatizeEnglish(''), [])
})

test('lemma：不把输入本身或单字母当候选', () => {
  assert.ok(!lemmatizeEnglish('cat').includes('cat'))
  assert.ok(!lemmatizeEnglish('as').includes('a'))
})

// ---------------------------------------------------------------- URL

test('normalizeBase：去尾部斜杠，并剥掉已带的 api 路径', () => {
  assert.equal(normalizeBase('https://d.example.com:999/'), 'https://d.example.com:999')
  assert.equal(normalizeBase('  https://d.example.com/  '), 'https://d.example.com')
  assert.equal(normalizeBase('https://d.example.com/api/v1/query'), 'https://d.example.com')
  assert.equal(normalizeBase('https://d.example.com/api/v1/vocab'), 'https://d.example.com')
})

test('buildQueryUrl：带 word / full_style / all_langs', () => {
  const url = new URL(buildQueryUrl('https://d.example.com:999/', '人気'))
  assert.equal(url.pathname, '/api/v1/query')
  assert.equal(url.searchParams.get('word'), '人気')
  assert.equal(url.searchParams.get('full_style'), 'true')
  assert.equal(url.searchParams.get('all_langs'), 'true')
})

test('buildQueryUrl：同一地址写不写 /api/v1/query 结果一致', () => {
  assert.equal(
    buildQueryUrl('https://d.example.com', 'run'),
    buildQueryUrl('https://d.example.com/api/v1/query', 'run'),
  )
})

test('vocab URL 三兄弟', () => {
  assert.equal(buildVocabUrl('https://d.example.com/'), 'https://d.example.com/api/v1/vocab')
  assert.equal(
    buildVocabListUrl('https://d.example.com', '骨格', 50),
    'https://d.example.com/api/v1/vocab?search=%E9%AA%A8%E6%A0%BC&page_size=50',
  )
  assert.equal(buildVocabItemUrl('https://d.example.com', 7), 'https://d.example.com/api/v1/vocab/7')
})

test('资源改写：/dict-res/ 加成绝对地址', () => {
  assert.equal(
    buildResourceUrl('https://d.example.com:999/', '/dict-res/28/res/SPX/a.spx'),
    'https://d.example.com:999/dict-res/28/res/SPX/a.spx',
  )
})

test('资源改写：幂等 —— 已是绝对地址 / 非词典资源原样返回', () => {
  const abs = 'https://cdn.example.com/a.png'
  assert.equal(buildResourceUrl('https://d.example.com', abs), abs)
  assert.equal(buildResourceUrl('https://d.example.com', 'https://d.example.com/dict-res/1/a.png'), 'https://d.example.com/dict-res/1/a.png')
  assert.equal(buildResourceUrl('https://d.example.com', '/other/a.png'), '/other/a.png')
  assert.equal(buildResourceUrl('https://d.example.com', 'data:image/png;base64,AAA'), 'data:image/png;base64,AAA')
  assert.equal(buildResourceUrl('https://d.example.com', '#anchor'), '#anchor')
})

test('isDictResPath / isValidBase', () => {
  assert.equal(isDictResPath('/dict-res/1/a.png'), true)
  assert.equal(isDictResPath('/api/x'), false)
  assert.equal(isValidBase('https://d.example.com'), true)
  assert.equal(isValidBase('ftp://d.example.com'), false)
  assert.equal(isValidBase('随便写的'), false)
  assert.equal(isValidBase(''), false)
})

// ---------------------------------------------------------------- 黑名单

test('黑名单：后缀匹配，不误伤相似域名', () => {
  const list = ['example.com', 'mail.test.cn']
  assert.equal(isBlocked('example.com', list), true)
  assert.equal(isBlocked('www.example.com', list), true)
  assert.equal(isBlocked('mail.test.cn', list), true)
  // 不能因为后缀相同就误判
  assert.equal(isBlocked('notexample.com', list), false)
  assert.equal(isBlocked('example.com.evil.net', list), false)
  assert.equal(isBlocked('other.com', list), false)
  assert.equal(isBlocked('example.com', []), false)
  assert.equal(isBlocked('', list), false)
})
