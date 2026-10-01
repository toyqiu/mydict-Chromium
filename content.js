/**
 * Content script 入口。
 *
 * 必须是 **classic script**（MV3 的 content_scripts 不支持 `type: module`），所以这里
 * 只做一件事：动态 import 真正的实现。扩展内的模块 URL 用 `chrome.runtime.getURL` 拿，
 * 并且它们都列在 manifest 的 `web_accessible_resources` 里——content script 跑在页面的
 * 上下文里，取扩展资源要过这一关。
 *
 * 动态 import 的好处是整个实现留在 ES 模块里（可以用 import/export 拆文件），
 * 而且注入失败时只影响这一个标签页，不会让扩展报错。
 */
;(async () => {
  if (window.__myreaderDictStarted) return
  try {
    const { start } = await import(chrome.runtime.getURL('content/app.js'))
    start()
  } catch (error) {
    // 注入失败就安静退出：网页上不该因为一个扩展在控制台刷错误
    console.debug('[MyReader 划词查词] 注入失败：', error)
  }
})()
