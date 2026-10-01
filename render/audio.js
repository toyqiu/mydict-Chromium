/**
 * 发音播放：把词条里的发音点击变成内联播放。移植自 MyReader `dictAudio.ts`。
 *
 * 词条里的发音有两种形态：
 *   - 千篇系：`<a data-mp3="https://…mp3">`，原本靠词典自带脚本播（词条脚本在这里不执行）
 *   - NHK 发音词典等：`<a href="/dict-res/N/res/SPX/x.spx">`（`sound://` 改写产物）
 *
 * **为什么用全页共用的一个 <audio> 而不是每次 new Audio()**：`new Audio()` 造出来的元素
 * 没有被任何变量引用、也不在 DOM 里，点击处理函数一返回它就可能被 GC 回收——播放到一半
 * 就断了，表象正是「点了没声音」。挂在 documentElement 上留一个引用（MyReader 同款做法），
 * 同时也保证同时只有一个声音在放。
 *
 * 关于 .spx：浏览器原生解不了 Speex。但 **mydict 对 .mp3 请求有「同名 .spx」兜底，
 * 而且 SPX 目录里通常本来就有一份真 mp3**，所以候选链先试 .mp3 基本就命中了。
 * 走到最后仍失败时给一条明确的提示，而不是静默「没声音」。
 *
 * TODO(M3)：真正的 .spx 解码（vendored 的 libspeex-js 三件套已在 vendor/speex/）。
 */

/** 绑定标记：外链处理看到它就跳过，避免同一个发音点击被绑两次。 */
export const AUDIO_BOUND = 'dictAudioBound'

const AUDIO_EXT_RE = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|spx)(?:[?#].*)?$/i
const SPX_EXT_RE = /\.spx(?:[?#].*)?$/i

/** 全页共用的播放器。页面框架（SPA 换 body）可能把它摘掉，所以每次取的时候校验。 */
let sharedPlayer = null

function getPlayer() {
  if (sharedPlayer && sharedPlayer.isConnected) return sharedPlayer
  sharedPlayer = document.createElement('audio')
  sharedPlayer.dataset['dictPlayer'] = '1'
  // 不带 controls 本来就不渲染；display:none 再保险一层，免得被页面 CSS 拉出个占位
  sharedPlayer.style.display = 'none'
  ;(document.body || document.documentElement).appendChild(sharedPlayer)
  return sharedPlayer
}

/**
 * 候选回退链。
 *
 * .spx 优先试同名 .mp3 / .opus——服务端对 .mp3 请求会去找同名的 .spx，而 SPX 目录里
 * 常常本来就有一份真 mp3；两者都没有才回到 .spx 本体（这时只能靠 JS 解码，见文件头）。
 */
export function audioCandidates(url) {
  if (!SPX_EXT_RE.test(url)) return [url]
  const stem = url.replace(SPX_EXT_RE, '')
  return [`${stem}.mp3`, `${stem}.opus`, url]
}

/** play() 被自动播放策略拦下时置位，候选链走完后给出针对性的提示。 */
let blockedByPolicy = false

/** 试播一个地址。resolve(true)=真的开始放了；resolve(false)=这个地址不行，换下一个。 */
function tryPlay(audio, url) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      audio.removeEventListener('error', onError)
      resolve(value)
    }
    const onError = () => finish(false)

    audio.addEventListener('error', onError, { once: true })
    audio.src = url
    audio.load()
    audio.play().then(
      () => finish(true),
      (error) => {
        audio.removeEventListener('error', onError)
        if (error?.name === 'NotAllowedError') {
          // 手势丢了：自动播放策略拦的。换候选也一样会被拦，直接报出来。
          blockedByPolicy = true
        }
        finish(false)
      },
    )
  })
}

async function playChain(url, onFail, onSuccess) {
  const audio = getPlayer()
  blockedByPolicy = false
  for (const candidate of audioCandidates(url)) {
    const played = await tryPlay(audio, candidate)
    if (played) {
      onSuccess?.()
      return
    }
    if (blockedByPolicy) break
  }
  onFail?.(
    blockedByPolicy
      ? '播放被浏览器拦截（没有点击手势），再点一次'
      : SPX_EXT_RE.test(url)
        ? '这个 .spx 没有同名的 mp3，当前版本还解不了 Speex'
        : '音频加载失败',
  )
}

/**
 * 给子树里的发音锚点挂上内联播放。
 *
 * @param {HTMLElement} root
 * @param {(resourcePath: string) => string} resolve 把词条里的相对路径解析成可加载的绝对地址
 * @param {(message: string) => void} [onFail]
 * @param {() => void} [onSuccess]
 */
export function wireDictAudio(root, resolve, onFail, onSuccess) {
  const play = (url) => playChain(url, onFail, onSuccess)

  for (const anchor of root.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? ''
    if (!AUDIO_EXT_RE.test(href)) continue
    anchor.dataset[AUDIO_BOUND] = '1'
    anchor.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      play(resolve(href))
    })
  }

  // 千篇的发音按钮：url 在 data-mp3 上，href 是 "#" 或没有
  for (const el of root.querySelectorAll('[data-mp3]')) {
    const url = el.getAttribute('data-mp3') ?? ''
    if (!url) continue
    el.dataset[AUDIO_BOUND] = '1'
    el.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      play(url)
    })
  }
}
