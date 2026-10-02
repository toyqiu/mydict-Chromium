/**
 * 设置页。职责很窄：读写 core/settings、探一次连通性。
 * host 权限走 manifest 的 host_permissions（安装即授予），这里不再申请。
 */

import { CODE, MSG } from './core/protocol.js'
import { DEFAULTS, getSettings, setSettings } from './core/settings.js'
import { isValidBase, normalizeBase, originPattern } from './core/mydict-url.js'
import { TRANSLATOR_LANGS } from './core/translator.js'

const $ = (id) => document.getElementById(id)

/** 错误码 → 给用户看的话。UI 只认码，文案集中在这里。 */
const MESSAGES = {
  [CODE.NOT_CONFIGURED]: '还没填 MyDict 地址',
  [CODE.PERMISSION_MISSING]: '还没授权访问这个服务器，点「保存」授权一次即可',
  [CODE.AUTH]: 'Token 不对或已失效',
  [CODE.NETWORK]: '连不上服务器，检查地址和网络',
  [CODE.TIMEOUT]: '请求超时',
  [CODE.SERVER]: '服务器出错了',
  [CODE.ERROR]: '出错了',
}

function describe(result) {
  if (result?.ok) return null
  const base = MESSAGES[result?.code] || result?.message || '出错了'
  // 码翻译之外附上底层细节（如 NetworkError 的原始文案），方便定位
  const detail = result?.message
  if (detail && detail !== base && !base.includes(detail)) return `${base}（${detail}）`
  return base
}

function setStatus(el, text, kind) {
  el.textContent = text || ''
  el.className = `status${kind ? ` ${kind}` : ''}`
}

// ------------------------------------------------------------------ 表单

function fillForm(settings) {
  $('baseUrl').value = settings.baseUrl
  $('token').value = settings.token
  for (const input of document.querySelectorAll('input[name="trigger"]')) {
    input.checked = input.value === settings.trigger
  }
  $('disableInInputs').checked = settings.disableInInputs
  $('blocklist').value = (settings.blocklist || []).join('\n')
  $('panelWidth').value = settings.panelWidth
  $('fontScale').value = settings.fontScale
  $('enableAudio').checked = settings.enableAudio
  fillTranslateLangs(settings.translateTargetLang)
  syncOutputs()
}

/** 翻译目标语言下拉：选项来自 core/translator.js 的语言表。 */
function fillTranslateLangs(selected) {
  const select = $('translateTargetLang')
  select.textContent = ''
  for (const { value, label } of TRANSLATOR_LANGS) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    select.appendChild(option)
  }
  select.value = selected ?? DEFAULTS.translateTargetLang
  if (select.value !== selected) select.value = DEFAULTS.translateTargetLang // 兜底未知旧值
}

function syncOutputs() {
  $('panelWidthOut').textContent = $('panelWidth').value
  $('fontScaleOut').textContent = `${Math.round($('fontScale').value * 100)}%`
}

/** 同步读表单 —— 不能在用户手势的处理函数里先 await 再读，否则手势就没了。 */
function readForm() {
  const checked = document.querySelector('input[name="trigger"]:checked')
  return {
    baseUrl: normalizeBase($('baseUrl').value),
    token: $('token').value.trim(),
    trigger: checked ? checked.value : DEFAULTS.trigger,
    disableInInputs: $('disableInInputs').checked,
    blocklist: $('blocklist')
      .value.split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    panelWidth: Number($('panelWidth').value),
    fontScale: Number($('fontScale').value),
    enableAudio: $('enableAudio').checked,
    translateTargetLang: $('translateTargetLang').value,
  }
}

// ------------------------------------------------------------------ 动作

/**
 * host 权限授权。Firefox MV3 的 host_permissions 是可选的，必须经 request（用户
 * 手势）授予，否则 background 跨域 fetch 与 content script 都不生效；Chrome 里
 * 已由 host_permissions 安装即授予，request 静默通过。地址留空（纯清空配置）时跳过。
 *
 * 「测试连接」也走这里：只点测试不点保存时同样需要权限，否则 Firefox 上 fetch 会
 * 抛 NetworkError，被误报成「连不上服务器」。
 */
async function ensureOriginPermission(base, status) {
  if (!base) return true
  try {
    const granted = await chrome.permissions.request({
      origins: [originPattern(base)],
    })
    if (!granted) {
      setStatus(status, '需要授权访问该服务器才能查词', 'error')
      return false
    }
  } catch (error) {
    setStatus(status, `授权失败：${error?.message || error}`, 'error')
    return false
  }
  return true
}

async function onSave() {
  const patch = readForm()
  const status = $('saveStatus')

  if (patch.baseUrl && !isValidBase(patch.baseUrl)) {
    setStatus(status, '地址不是合法的 http(s) URL', 'error')
    return
  }

  if (!(await ensureOriginPermission(patch.baseUrl, status))) return

  await setSettings(patch)
  setStatus(status, '已保存', 'ok')
  setTimeout(() => setStatus(status, ''), 2000)
}

async function onTest() {
  const button = $('test')
  const status = $('testResult')
  button.disabled = true
  setStatus(status, '正在测试…')

  // 测试用的凭据取表单值而不是已保存值，方便「改了先测再保存」
  const patch = readForm()
  if (patch.baseUrl && !isValidBase(patch.baseUrl)) {
    setStatus(status, '地址不是合法的 http(s) URL', 'error')
    button.disabled = false
    return
  }
  if (!(await ensureOriginPermission(patch.baseUrl, status))) {
    button.disabled = false
    return
  }
  await setSettings(patch)
  const result = await chrome.runtime.sendMessage({ type: MSG.TEST_CONNECTION })

  if (result?.ok) {
    const { dictionaryCount, resultCount, elapsedMs, probeWord, hasToken } = result.data
    const tokenNote = hasToken ? '' : '（未填 Token，只能查词、不能收藏）'
    setStatus(
      status,
      resultCount > 0
        ? `连接正常：${probeWord} 命中 ${resultCount} 条 / ${dictionaryCount} 部词典，${elapsedMs}ms ${tokenNote}`
        : `连接正常（${elapsedMs}ms），但探针词「${probeWord}」在你这套词典里没有收录 ${tokenNote}`,
      'ok',
    )
  } else {
    setStatus(status, describe(result), 'error')
  }
  button.disabled = false
}

// ------------------------------------------------------------------ 启动

for (const input of [$('panelWidth'), $('fontScale')]) {
  input.addEventListener('input', syncOutputs)
}
$('save').addEventListener('click', onSave)
$('test').addEventListener('click', onTest)

fillForm(await getSettings())
