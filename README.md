# MyDict-Chromium

把 [MyReader](https://github.com/PoxenStudio/MyReader) 电子书阅读器里的「划词查词」体验
搬进 Chromium 浏览器的 Chrome 扩展（Manifest V3）。划选任意网页上的词，用**你自建的
[MyDict](https://github.com/PoxenStudio/mydict) 词典服务**查释义、看扫描图、听发音、
收生词本——不依赖任何第三方翻译接口。

纯 JavaScript、**零构建**：改完代码在 `chrome://extensions` 点一下刷新即可生效。

---

## 功能

### 查词入口（四个，按需选用）

| 入口 | 行为 |
|---|---|
| 划选（默认） | 选中文字后，选区旁浮出小圆标，点它弹出查词面板 |
| 双击 | 双击一个词，直接弹出面板 |
| 工具栏图标 | 弹出带搜索框的弹窗，**任何页面都能用**（包括 chrome:// 新标签页这类无法注入脚本的页面） |
| 右键菜单 | 选区上「用 MyDict 查『所选词』」；页面右键「MyDict 设置」 |

### 查词面板

- **按词典分组折叠**：一次查询命中几十部词典时按词典分组、默认展开第一组，右上角显示词条数
- **语言标签页**：命中多语种时顶部出现「全部 / 中文 / 日本語 / English…」标签，默认选中与页面语言一致的语种，点击即过滤
- **键盘导航**：`↑`/`↓` 在命中的词典分组间切换（关掉当前组、展开相邻组，到头绕回）；`←`/`→` 切换语言标签
- **词条 HTML 原样渲染**：每个词典一个独立的 shadow root，词典自带的 CSS 互不污染，也不会泄漏到页面上
- **图片交互**（对 MDict 转制词典的兼容，牛津高阶第 9/10 版实测）：
  - 牛津「拓展图」：点缩略图 → 原地展开大图；点展开后的全图 → 弹全屏查看器；图旁「收起」按钮收回
  - 单张大图（辞海整页扫描等）：点击直接弹全屏查看器
- **全屏图片查看器**：滚轮缩放（锚定光标）、拖动平移、`←`/`→` 翻页、`Esc` 或点空白退出——扫描版词典整页 3383×5219 的图也能放大了读标注小字
- **发音**：点词条里的音标/音频链接即播；`.mp3 → .opus → .spx` 候选链自动回退（`.spx` 的 JS 解码尚未接线，见「已知限制」）
- **生词本 ☆**：每个词典分组右上角一颗星，点击收藏到 MyDict 生词本（★ = 已收藏，再点取消）。发的是该词典自己的**词头**而不是选区原文——生词本按 `(owner, dictionary_id, word)` 唯一
- **暗色模式**：面板、弹窗、滚动条全部跟随系统主题（也可在设置里强制浅色/深色）
- **交叉引用**：`entry://` 链接在面板内就地继续查，`‹` 返回上一个词

### 细节

- 弹窗查询与划词面板共用同一套渲染层，行为完全一致
- 弹窗打不开查词脚本的页面会**直接显示原因**（未刷新的旧标签页 / 网站访问权限受限 / 页面类型不支持），而不是无声失败
- 弹窗自身出错时错误信息以红字显示在弹窗里，方便回报

---

## 安装

1. 下载本仓库（`git clone` 或下载 zip 解压）
2. 打开 `chrome://extensions`，右上角开启**开发者模式**
3. 点「**加载已解压的扩展程序**」，选择本仓库目录（含 `manifest.json` 的那一层）
4. （可选）点工具栏拼图图标，把「MyReader 划词查词」图钉固定到工具栏
5. 点扩展图标 → 「打开设置」→ 填入 MyDict 地址与 Token → 保存

> **网站访问权限**：本扩展在 manifest 里声明了 `host_permissions: ["<all_urls>"]`
> （安装即授予，安装时会提示「读取和更改您在所有网站上的数据」——查词必须在任意网页
> 上运行，这是必要的）。如果划选没反应，先到扩展「详情」→「网站访问权限」确认是
> 「**在所有网站上**」，并刷新一次安装扩展之前就开着的标签页。

## 配置

| 设置项 | 说明 |
|---|---|
| MyDict 地址 | 例如 `https://mydict.example.com:999/`（`http` 局域网地址也可以） |
| Token | MyDict 网页「Token 管理」里生成。不填也能查词（MyDict 开匿名查询时），但生词本一定需要 |
| 触发方式 | 划选浮标（默认）/ 划选即弹 / 双击 |
| 面板宽度 / 字号 | 按喜好调整 |
| 发音 | 关掉后不接管音频链接 |
| 输入框内禁用 | 划选发生在输入框里时不触发 |
| 站点黑名单 | 一行一个域名，含其子域 |

配置存在 `chrome.storage.local`，**不同步上云**（Token 是密钥，不出本机）。

---

## 它是怎么工作的

三个决定扩展形态的实测事实：

1. **MyDict 的 `/api/v1/query` 不返回任何 CORS 头** → 页面里（content script）调不了，
   查询与生词本请求全部经 **background service worker** 代理（扩展后台持有 host 权限，
   不受 CORS 限制）。
2. **`/dict-res/{id}/res/{path}`（词典图片/CSS/音频）不需要鉴权**，且响应带
   `Access-Control-Allow-Origin: *` → 词条里引用的资源直接改写成 MyDict 的**绝对地址**，
   不需要中继，词典 CSS 里的相对 `url()` 也能自然解析。
3. **词典 CSS 会互相污染**（MDict 转制词典爱用裸元素选择器）→ 面板骨架一个 shadow
   root，**每个词典再各一个** shadow root；折叠骨架（`<details>`、语言标签）留在面板层，
   词典内容进各自的 scope，牛津的 `details{display:inline-block}` 这类规则就打不到骨架。

### 划词面板的图片点击分流

MDict 转制的牛津高阶词条里，「拓展图」是成对结构——缩略图 + `display:none` 的全图，
展开/收起靠**词条自带的 JS**（`toggle_enlarger` / `expand_big` / `expand_thumb`）。
扩展渲染词条时脚本与 `onclick` 属性会被 DOMPurify 剥掉，所以这套交互要由扩展自己接，
而且有一个网页版用 iframe 踩过的坑在这里同样成立：

> **不能依赖 `event.target` 是 `<img>`。** 真实鼠标点击命中的是悬停放大镜角标
> （`.ox-enlarge-label`）、`<a>` 或容器本身——只有合成事件的 target 才恰好是 img。

因此点击监听挂在词条内容容器的**捕获阶段**，按容器分流：

- 可见图是全图（展开态）→ `stopPropagation` 拦掉词典的「缩回去」，弹全屏查看器
- 可见图是缩略图（收起态）→ 原地展开（展开/收起由扩展代劳，词条 JS 已被剥掉）
- 链接包裹的图 → 让给链接逻辑（`entry://` 就地查、外链新标签页）
- 其余无链接包裹、渲染尺寸 ≥160px 的 `<img>` → 直接弹查看器

### 其它值得一提的实现点

- **反悬浮广告扩展的对抗**：部分广告拦截扩展会注入样式表，把所有 `position:fixed`
  元素一律改成 `absolute` 并 `display:none !important`——浮标和面板宿主的关键属性全部
  用**内联 `!important`** 声明（内联 important 优先级更高），否则在装了这类扩展的机器上
  整个界面静默消失。
- **弹窗查看大图走独立标签页**：弹窗本身是 460px 小窗，扫描图在弹窗内永远放不大——
  点大图时 `chrome.tabs.create` 打开 `lightbox.html`，独立标签页里遮罩才是真全屏。
- **分层兜底的错误自诊**：`popup-boot.js` 先于主模块注册 error/unhandledrejection
  钩子，把弹窗的任何失败渲染成可见红字；主模块再向当前页面发探针，注入失败时说明原因。
- **oald10.css 的坑**：`.thumb{display:none}` 和 `.fullsize{display:none}` 同时存在，
  网页版靠词条自带 JS 在初始化时显示缩略图；扩展里用内联 `!important` 强制恢复。

---

## 目录结构

```
manifest.json          MV3 清单（权限、content_scripts、commands、web_accessible_resources）
background.js          Service worker 入口：消息路由 + 右键菜单
background/
  router.js            消息分发与错误收敛（所有 handler 不抛出，统一 {ok, code, message}）
  mydict-client.js     MyDict HTTP 客户端（query / vocab 增删查 / 测试连接）
  cache.js             查询结果内存缓存（TTL + 上限）
content.js             content script 引导：按需动态 import 其余模块
content/
  app.js               装配：设置热更新、划选/双击入口、消息监听
  selection.js         选区捕获与整词提取（Intl.Segmenter）、可编辑区排除、站点黑名单
  trigger-icon.js      选区旁的浮出小圆标
  position.js          面板定位（上下翻转、视口 clamp、滚动跟随）+ 免疫内联样式工具
  panel.js             面板外壳（自身 shadow root、状态机、Esc/点外关闭、键盘导航）
  vocab.js             生词本能力（listSaved / add / remove，状态对账）
render/                与弹窗共用的渲染层
  renderer.js          结果 → 分组折叠 + 语言标签 + 每词典独立 shadow scope
  sanitize.js          DOMPurify 白名单清洗（放行词典自定义元素、保住 entry://）
  resources.js         词条自带 <style>/<link> 回挂 + 资源相对地址改写为绝对地址
  styles.js            面板样式（主题令牌、暗色、滚动条）+ 词典兼容 CSS
  links.js             entry:// / 锚点 / 外链处理
  audio.js             发音（mp3→opus→spx 候选链、共享 <audio> 播放器）
  expandable.js        牛津拓展图：捕获阶段容器分流（展开/收起/幻灯片）
  images.js            大图收集（渲染尺寸 ≥160、去重、翻页表）
  lightbox.js          全屏图片查看器（缩放/平移/翻页/ immune styles）
  vocab-star.js        分组右上角的生词本 ☆
  dark-theme.js        暗色模式下词典内容的颜色适配
core/                  纯逻辑、无 DOM，可单测
  protocol.js          消息类型与错误码
  settings.js          chrome.storage.local 读写 + 默认值
  mydict-url.js        地址规范化与 URL 构造
  lookup-candidates.js 查询候选词（trim → 大小写 → 词形还原，50 字上限）
  lemmatize.js         英语词形还原
options.html/.js/.css  设置页
popup.html/.js/.css    工具栏弹窗（搜索框 + 结果，与面板同渲染层）
popup-boot.js          弹窗错误自诊（先于主模块注册钩子）
lightbox.html/-page.js 独立标签页版查看器（popup 点大图时打开）
tests/                 node --test 单测 + 验证页 fixture
vendor/                DOMPurify（ESM）、libspeex-js 三件套（spx 解码备用）
```

---

## 开发与测试

```bash
# 单元测试（core/ 纯逻辑，21 例）
node --test tests/unit/

# 端到端验证
# tests/fixture.html 是验证页：划选其中的词即可触发完整链路；
# tests/csp-fixture.html 模拟严格 CSP 站点（content script 不受页面 CSP 约束）；
# tests/dark-harness.html 单独验证主题令牌与滚动结构。
python3 -m http.server 18080 --directory tests
```

改完代码 → `chrome://extensions` 点扩展卡片上的刷新（⟳）→ 刷新目标网页。
无需任何构建步骤。

### 已知限制

- `.spx` 音频目前依赖服务端的同名 `.mp3` 兜底；纯 spx 词典需要接线 `vendor/speex/`
  的 libspeex-js 解码（脚本已就位，未挂到播放链路）
- iframe 内嵌页面（`<iframe>` 里的内容）不注入，划选不生效
- `chrome://`、Web Store、PDF 查看器等页面无法注入（弹窗查询不受影响）

---

## 隐私与安全

- 查询词、Token 只在你配置的 MyDict 服务器与浏览器之间传输，不经过任何第三方
- Token 存 `chrome.storage.local`，不上云同步
- 外链新标签页打开时带 `rel="noopener noreferrer"`；词典资源请求不带 referrer
- 仓库中不含任何真实服务器地址或凭据

## 致谢

- [MyReader](https://github.com/PoxenStudio/MyReader) / [MyDict](https://github.com/PoxenStudio/mydict) ——
  划词查词面板与词典服务的原型，渲染层移植自其 `renderMyBooksResults`
- mydict 网页版的 `iframe_bootstrap.js` 点击分流算法与 `ImageLightbox.vue` 查看器
- [DOMPurify](https://github.com/cure53/DOMPurify)、[libspeex-js](https://github.com/janpus/libspeex)（vendored）

## License

MIT
