/**
 * popup 的错误引导脚本（classic，先于 popup.js 模块加载）。
 *
 * MV3 扩展页面的 CSP 禁止内联脚本，所以错误处理必须放在独立文件里、并且要在
 * popup.js（ES module）之前注册——module 的 import 失败或模块级异常发生时，
 * 这个文件已经把 error / unhandledrejection 的钩子挂好了。
 *
 * 没有它，popup.js 一旦出错，弹窗就是一块空白，用户只看到「点了没反应」，
 * 而错误只存在于扩展页自己的控制台里，远程调试时拿不到。
 */

function showFatal(message) {
  try {
    const box = document.createElement('div')
    box.style.cssText = [
      'position: fixed',
      'inset: 8px',
      'z-index: 2147483647',
      'padding: 10px',
      'border-radius: 8px',
      'background: #fdecea',
      'color: #8b1d12',
      'font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif',
      'white-space: pre-wrap',
      'word-break: break-all',
      'overflow: auto',
    ].join(';')
    box.textContent = message
    document.body.appendChild(box)
  } catch {
    /* 连 DOM 都没有就只剩控制台了 */
  }
}

window.addEventListener('error', (event) => {
  showFatal(`弹窗加载失败：${event.message || event.type}\n${event.filename || ''}:${event.lineno || ''}`)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason?.message || String(event.reason ?? '')
  showFatal(`弹窗初始化失败：${reason}`)
})

document.addEventListener('DOMContentLoaded', () => {
  // popup.js（deferred module）在本事件之前就已执行；它成功初始化时会把
  // __MYDICT_POPUP_READY 置位，这里就不再放占位提示了。
  if (window.__MYDICT_POPUP_READY || document.getElementById('boot-mark')) return
  const mark = document.createElement('div')
  mark.id = 'boot-mark'
  mark.style.cssText =
    'padding: 10px; font: 13px/1.6 -apple-system, "Microsoft YaHei", sans-serif; color: #555'
  mark.textContent = '正在初始化查词面板…（如果这行字一直在，说明弹窗脚本没有加载成功）'
  document.body.appendChild(mark)
})
