/**
 * Service worker 入口（MV3）。
 *
 * 三件事：
 *   1. 收 content / options / popup 的消息，交给 router（查询与生词本都在这里，因为只有
 *      它跨域不受限）；
 *   2. 工具栏图标 = 弹 popup 搜索框（manifest 里 default_popup，任何页面都能用，
 *      包括 chrome:// 新标签页这种注入不了脚本的）；设置在右键菜单里；
 *   3. 右键菜单 —— 对 iframe / 拿不到选区的页面留一条兜底查词入口。
 */

import { MSG } from './core/protocol.js'
import { route, resetCache } from './background/router.js'

const MENU_ID = 'mydict-lookup'
const MENU_ID_SETTINGS = 'mydict-settings'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // 异步响应必须返回 true 把通道留住
  route(message).then(sendResponse, (error) =>
    sendResponse({ ok: false, code: 'ERROR', message: error?.message || String(error) }),
  )
  return true
})

// 地址/Token 一改就清缓存：留着旧结果会让用户以为设置没生效
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) resetCache()
})

// 左键点扩展图标弹 popup（manifest 的 default_popup），所以这里没有 onClicked。
// 右键扩展图标 → 「MyDict 设置」；右键页面选区 → 直接查。

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    // 右键页面选区：直接查
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '用 MyDict 查「%s」',
      contexts: ['selection'],
    })
    // 右键扩展图标 / 页面：进设置
    chrome.contextMenus.create({
      id: MENU_ID_SETTINGS,
      title: 'MyDict 设置',
      contexts: ['action', 'page', 'frame', 'link', 'image', 'video', 'audio', 'editable'],
    })
  })
}

chrome.runtime.onInstalled.addListener(ensureContextMenu)
chrome.runtime.onStartup.addListener(ensureContextMenu)

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID_SETTINGS) {
    chrome.runtime.openOptionsPage()
    return
  }
  if (info.menuItemId !== MENU_ID || !tab?.id) return
  const word = (info.selectionText || '').trim()
  if (!word) return
  // content script 可能还没注入（比如页面是扩展刚装好时打开的），失败就静默——
  // 用户重新划一次即可，不值得为此弹错误。
  chrome.tabs.sendMessage(tab.id, { type: MSG.TRIGGER, payload: { word } }).catch(() => {})
})
