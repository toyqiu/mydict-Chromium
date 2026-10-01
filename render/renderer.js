/**
 * 把一次查询的结果渲染成面板内容。移植自 MyReader 的 `renderMyBooksResults`。
 *
 * 两条贯穿始终的设计（都是踩过坑的结论）：
 *
 * 1. **每个词典一个独立 shadow scope**。词典会用裸元素选择器写样式（`div`、
 *    `li{float:left}`、`table{…}`），共用一个 shadow 时千篇的规则会把英文字典的列表重排。
 *    每个 scope 多一个 shadow，换来的是精确的隔离。
 * 2. **折叠骨架留在面板自己的 shadow 里**，词典内容进各自的 scope。牛津10 的 CSS 有
 *    `details{display:inline-block}` 和 `details[open]>summary>span{display:none}`
 *    （它自己的页面拿 details 当折叠框用），骨架要是和词典 CSS 同层，整组会被打崩。
 */

import { BASELINE_CSS, LANG_TAB_NAMES, DICTIONARY_COMPAT_CSS, langBucket } from './styles.js'
import { sanitizeDictionaryHtml } from './sanitize.js'
import { absolutizeResourceRefs, extractEntryStyles } from './resources.js'
import { attachVocabStar } from './vocab-star.js'
import { wireLinks } from './links.js'
import { wireDictAudio } from './audio.js'
import { wireImageInteractions } from './expandable.js'
import { adaptToDarkTheme } from './dark-theme.js'

/**
 * @param {Array} results 服务端返回的 `results`
 * @param {HTMLElement} container 面板 shadow 里的内容容器（每次渲染前会被清空）
 * @param {object} options
 */
export function renderResults(results, container, options) {
  const { baseUrl, lang, vocab, onNavigate, onNotify, isDarkMode, audioEnabled } = options
  container.textContent = ''

  // 服务端已按词典排序，所以「折叠连续同名」就保住了顺序，不需要额外的索引表
  const groups = []
  for (const result of results) {
    const name = result.dictionary_name || '未命名词典'
    const bucket = langBucket(result.lang_from)
    const last = groups[groups.length - 1]
    if (last && last.name === name) last.items.push(result)
    else groups.push({ name, lang: bucket, items: [result] })
  }

  const langOrder = []
  for (const group of groups) {
    if (!langOrder.includes(group.lang)) langOrder.push(group.lang)
  }
  // 默认选中与页面语言命中一致的那一组：日文网页上查汉字，日文词典排在前面才对。
  // 页面语言没有命中就回到「全部」。
  const pageLang = langBucket(lang)
  let activeLang = langOrder.includes(pageLang) ? pageLang : ''

  // 同一次渲染里，同一个词头的已收藏状态只查一次
  const savedByWord = new Map()
  const savedFor = (word) => {
    let saved = savedByWord.get(word)
    if (!saved) {
      saved = vocab?.listSaved(word) ?? Promise.resolve(new Map())
      savedByWord.set(word, saved)
    }
    return saved
  }

  const scopes = []
  let openedVisibleGroup = false
  const applyLangFilter = (selected) => {
    for (const scope of scopes) {
      const visible = selected === '' || scope.lang === selected
      scope.details.style.display = visible ? '' : 'none'
      if (selected !== '' && scope.lang !== selected) scope.details.open = false
    }
  }

  // 语言标签页：只有两种以上语言时才值得占一行
  const tabButtons = []
  if (langOrder.length > 1) {
    const tabs = document.createElement('div')
    tabs.className = 'mydict-lang-tabs'
    tabs.addEventListener('click', (event) => event.stopPropagation())
    const makeTab = (value, label) => {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.textContent = label
      tab.className = `mydict-lang-tab${value === activeLang ? ' mydict-lang-tab-active' : ''}`
      tab.addEventListener('click', () => selectLang(value))
      tabButtons.push({ value, tab })
      return tab
    }
    tabs.appendChild(makeTab('', '全部'))
    for (const bucket of langOrder) tabs.appendChild(makeTab(bucket, LANG_TAB_NAMES[bucket] ?? bucket))
    container.appendChild(tabs)
  }

  for (const group of groups) {
    // 原生 <details>：一个分组可能装着几十个同形词（搜韵），全展开会把用户要找的那个埋掉。
    // 只有第一个「在当前语言下可见」的分组默认展开。
    const details = document.createElement('details')
    details.className = 'mydict-group'
    details.dataset.lang = group.lang
    container.appendChild(details)

    const summary = document.createElement('summary')
    summary.className = 'mydict-group-head'
    // 面板整体没有「点卡片折叠」的行为，但仍然拦一下：避免点击穿透到页面
    summary.addEventListener('click', (event) => event.stopPropagation())

    const chevron = document.createElement('span')
    chevron.className = 'mydict-group-chevron'
    chevron.setAttribute('aria-hidden', 'true')
    summary.appendChild(chevron)

    const nameEl = document.createElement('span')
    nameEl.className = 'mydict-group-name'
    nameEl.textContent = group.name
    summary.appendChild(nameEl)

    if (group.items.length > 1) {
      const count = document.createElement('span')
      count.className = 'mydict-group-count'
      count.textContent = String(group.items.length)
      summary.appendChild(count)
    }

    // 整组都是 lang_match=false，说明命中的是服务端跨语言兜底的结果（导入时的语言识别
    // 可能不准），标出来免得用户困惑
    if (group.items.every((item) => item.lang_match === false)) {
      const badge = document.createElement('span')
      badge.className = 'mydict-lang-badge'
      badge.textContent = '其它语言'
      summary.appendChild(badge)
    }

    // 星标发**该组首条命中的词头**，不是选区原文——生词本是词条级的，服务端精确匹配，
    // 而查询是前缀匹配（查 `ran` 可能命中 `ranch`）。这条是硬要求，别改成选区文字。
    const firstHit = group.items[0]
    if (vocab && firstHit && typeof firstHit.dictionary_id === 'number' && firstHit.word) {
      attachVocabStar(summary, {
        capability: vocab,
        dictionaryId: firstHit.dictionary_id,
        word: firstHit.word,
        savedFor,
        onNotify,
      })
    }

    details.appendChild(summary)

    const scopeHost = document.createElement('div')
    scopeHost.className = 'mydict-scope'
    details.appendChild(scopeHost)
    const shadow = scopeHost.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = BASELINE_CSS + DICTIONARY_COMPAT_CSS
    shadow.appendChild(style)

    // 词典自带的样式表：DOMPurify 会无条件丢掉它们，在这里逐条挂回**本分组的 scope**。
    // 挂在这里它们既生效，又够不到别的词典和面板骨架。
    const seenStyles = new Set()
    for (const item of group.items) {
      for (const node of extractEntryStyles(item.definition ?? '', baseUrl)) {
        const key =
          node.tagName === 'LINK' ? `link:${node.getAttribute('href')}` : `css:${node.textContent}`
        if (seenStyles.has(key)) continue
        seenStyles.add(key)
        shadow.appendChild(node)
      }
    }

    // part="dict-content" 是唯一能穿透 shadow 边界的钩子，面板的字号设置靠它生效
    const body = document.createElement('div')
    body.setAttribute('part', 'dict-content')
    shadow.appendChild(body)

    const multiple = group.items.length > 1
    group.items.forEach((item, index) => {
      const section = document.createElement('section')
      section.className = 'mydict-entry'

      // 只有「一部词典一次返回多条」时才值得加词头：序号是区分它们的唯一线索。
      // 单条的正文几乎都以自己的词头开头（汉典就是「天性 天性拼音：…」），再加一行只是重复。
      if (multiple) {
        const head = document.createElement('div')
        head.className = 'mydict-entry-head'
        const ordinal = document.createElement('span')
        ordinal.className = 'mydict-entry-index'
        ordinal.textContent = `${index + 1}/${group.items.length}`
        head.appendChild(ordinal)
        if (item.word) {
          const word = document.createElement('span')
          word.className = 'mydict-entry-word'
          word.textContent = item.word
          head.appendChild(word)
        }
        if (item.phonetic) {
          const phonetic = document.createElement('span')
          phonetic.className = 'mydict-entry-phonetic'
          phonetic.textContent = item.phonetic
          head.appendChild(phonetic)
        }
        section.appendChild(head)
      }

      const content = document.createElement('div')
      content.className = 'mydict-entry-body'
      // 先在惰性的 <template> 里解析：资源 URL 改写好之前，节点一旦入 DOM 浏览器就开始取，
      // 根相对路径会打到当前网页的 origin 上
      const template = document.createElement('template')
      template.innerHTML = sanitizeDictionaryHtml(item.definition ?? '')
      absolutizeResourceRefs(template.content, baseUrl)
      content.appendChild(template.content)
      section.appendChild(content)

      body.appendChild(section)
    })

    // 发音失败提示条：链路上任何一步失败都要说出来，不能只表现为「没声音」
    const audioNote = document.createElement('div')
    audioNote.className = 'mydict-audio-note'
    audioNote.hidden = true
    body.appendChild(audioNote)

    if (audioEnabled) {
      wireDictAudio(
        body,
        (resourcePath) => resourcePath, // 资源已在 absolutizeResourceRefs 里变成绝对地址
        (message) => {
          audioNote.textContent = `发音播放失败：${message}`
          audioNote.hidden = false
        },
        () => {
          audioNote.hidden = true
        },
      )
    }

    wireLinks(body, onNavigate)
    // 词条图片交互：捕获阶段按容器分流（牛津拓展图的展开/收起、大图幻灯片）
    wireImageInteractions(body, options.openImages)
    if (isDarkMode) adaptToDarkTheme(body)

    const visible = activeLang === '' || group.lang === activeLang
    details.style.display = visible ? '' : 'none'
    details.open = visible && !openedVisibleGroup
    if (visible) openedVisibleGroup = true
    scopes.push({ details, lang: group.lang })
  }

  // ---------------------------------------------------------- 键盘导航（↑/↓ 切词条、←/→ 切语言）

  /** 切换语言标签（点击标签页与 ←/→ 共用）：更新激活态、过滤分组，并展开第一个可见分组。 */
  function selectLang(value) {
    activeLang = value
    for (const { value: v, tab } of tabButtons) {
      tab.classList.toggle('mydict-lang-tab-active', v === value)
    }
    applyLangFilter(value)
    const first = scopes.find((s) => s.details.style.display !== 'none')
    if (first) {
      first.details.open = true
      first.details.scrollIntoView({ block: 'nearest' })
    }
  }

  /**
   * ↑/↓：在**当前语言下可见**的分组间切换——关掉当前展开的那组、打开相邻的一组，
   * 到头了绕回（与查询页 ←/→ 切词典的行为一致），并把它滚进可视区。
   */
  function moveGroup(delta) {
    const visible = scopes.filter((s) => s.details.style.display !== 'none')
    if (visible.length === 0) return
    let current = visible.findIndex((s) => s.details.open)
    if (current < 0) current = 0
    const next = (current + delta + visible.length) % visible.length
    if (next === current) return
    visible[current].details.open = false
    visible[next].details.open = true
    visible[next].details.scrollIntoView({ block: 'nearest' })
  }

  /** ←/→：切到上一个/下一个语言标签（循环），只有一种语言时无事可做。 */
  function moveLang(delta) {
    if (langOrder.length < 2) return
    const current = langOrder.indexOf(activeLang)
    const next = (current + delta + langOrder.length) % langOrder.length
    selectLang(langOrder[next])
  }

  return { moveGroup, moveLang }
}
