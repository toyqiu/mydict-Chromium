/**
 * 设置读写。存在 `chrome.storage.local`（**不用 sync**：Token 是密钥，不该同步上云）。
 *
 * background / options / content 三处都用这一份，默认值也只在这里定义一次。
 */

const KEY = 'settings'

export const DEFAULTS = {
  /** MyDict 服务器地址，例如 https://dict.example.com:999/ */
  baseUrl: '',
  /** MyDict 的 API Token（Authorization: Bearer） */
  token: '',

  /** 触发方式：icon=划选后浮小图标点开；auto=划选即弹；dblclick=只认双击选词 */
  trigger: 'icon',

  /**
   * 浮标贴在选区的哪个角：br=右下（默认）、tr=右上、bl=左下、tl=左上、
   * center=盖在选区正中央。安卓的长按选择手柄长在选区下沿两端，四个角都可能
   * 被挡——选「正中央」最稳。
   */
  iconPlacement: 'br',

  /** 面板宽度（px）。高度随内容，最大不超过视口的 80%。 */
  panelWidth: 480,
  /** 词条字号缩放，1 = 原始 */
  fontScale: 1,

  /** 词条里的发音锚点是否拦截播放 */
  enableAudio: true,
  /** 光标在输入框/可编辑区里时不触发 */
  disableInInputs: true,
  /** 站点黑名单：主机名后缀匹配，命中则整站不触发 */
  blocklist: [],
  /** 面板主题：auto 跟随系统 */
  theme: 'auto',

  /**
   * 划词翻译的目标语言（Edge 接口的语言码）。
   * 与源语言同语种时 core/translator.js 会自动纠偏（比如选中中文而目标是中文 → 译成英文）。
   */
  translateTargetLang: 'zh-Hans',
}

/** 读全部设置（缺失项用默认值补齐）。 */
export async function getSettings() {
  const stored = await chrome.storage.local.get(KEY)
  return { ...DEFAULTS, ...(stored?.[KEY] || {}) }
}

/** 局部更新。返回合并后的完整设置。 */
export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch }
  await chrome.storage.local.set({ [KEY]: next })
  return next
}

/**
 * 订阅设置变更。返回取消订阅函数。
 *
 * 只关心 `chrome.storage.local` 里 KEY 这一项的变化，其它键（将来可能有别的）忽略。
 */
export function onSettingsChanged(callback) {
  const listener = (changes, area) => {
    if (area !== 'local' || !changes[KEY]) return
    callback({ ...DEFAULTS, ...(changes[KEY].newValue || {}) })
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

/**
 * 主机名是否命中黑名单。用后缀匹配，`example.com` 能盖住 `www.example.com`；
 * 精确到子域也行（填 `mail.example.com` 就只管它）。
 */
export function isBlocked(hostname, blocklist) {
  if (!hostname || !Array.isArray(blocklist) || blocklist.length === 0) return false
  const host = hostname.toLowerCase()
  return blocklist.some((raw) => {
    const entry = String(raw || '').trim().toLowerCase().replace(/^\.+/, '')
    if (!entry) return false
    return host === entry || host.endsWith(`.${entry}`)
  })
}
