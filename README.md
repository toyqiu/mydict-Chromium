# MyReader 划词查词（Chrome 扩展）

划选网页上的词，弹出查词面板：按词典分组显示自建 MyDict 的释义、看发音、收进生词本。
交互与 MyReader 阅读器里的查词面板一致（同样的分组折叠、shadow 样式隔离、生词本星标）。

## 安装

1. 打开 `chrome://extensions`，右上角打开「开发者模式」
2. 点「加载已解压的扩展程序」，选择本目录（`chrome/`）
3. 点扩展图标 → 打开设置 → 填 **MyDict 地址** 与 **Token** → 保存

保存即可。安装时会提示「读取和更改您在所有网站上的数据」——这是本扩展能注入任意网页
划词、并能直连你的 MyDict 服务器所必需的。

## 使用

- **划选**一个词 → 选区旁浮出小圆标 → 点它出面板
- **双击**一个词 → 直接出面板
- **点扩展图标**（或按 `Alt+Shift+D`）→ 弹出搜索框，输入词回车查询
- **右键** → 「用 MyDict 查『所选词』」直接查；「MyDict 设置」进设置页
- 面板里：
  - 顶部是**语言标签页**（全部 / 中文 / 日本語 / English），默认选中与页面语言一致的那组
  - 每部词典一个**折叠分组**，右上角 ☆ 收进生词本（★ = 已收藏，再点取消）
  - 点词条里的**音标/音频链接**就发音
  - 词典自带的**交叉引用**（`entry://`）点击后在面板内继续查，`‹` 返回上一个词
- `Esc`、点击面板外、或选区滚出视口，都会关闭面板

## 配置项

| 项 | 说明 |
|---|---|
| MyDict 地址 | 填到域名端口即可；带不带 `/api/v1/query` 都认。**建议用 HTTPS 入口**——HTTP 地址在 HTTPS 网页上加载不了词典的图片和样式（mixed content） |
| Token | 查词可以留空（服务端开了匿名访问时）；**生词本必须填** |
| 触发方式 | 浮标 / 双击 / 划选即弹 |
| 面板宽度 / 词条字号 | |
| 发音开关 | |
| 输入框内禁用 | |
| 站点黑名单 | 一行一个域名，含其子域 |

配置存在 `chrome.storage.local`，**不同步上云**（Token 是密钥）。

### 发音链路说明

词条里的发音锚点（`.mp3` 直链、千篇的 `data-mp3`、`.spx`）都由扩展拦截后用
一个**全页共用的 `<audio>` 播放器**播放——挂在 `document.documentElement` 上、
由扩展持有引用。早先版本每次点击 `new Audio()` 造一个无引用元素，处理函数一返回
就可能被 GC 回收，播放中断，表象就是「点了没声音」。

`.spx` 依次试同名 `.mp3` → `.opus` → 本体；被自动播放策略拦下时会明确提示
「播放被浏览器拦截」，而不是静默。

## 实现说明

MV3、纯 JS 免构建——`chrome/` 目录直接加载，改完在 `chrome://extensions` 点一下刷新即可。
无打包器、无 node_modules（`package.json` 只给 `node --test` 用）。

```
content script（页面内，隔离世界）          service worker（特权上下文）
  选区捕获 / 浮标 / 面板外壳        ⇄ 消息 ⇄   查 mydict（无 CORS 限制）
  词典渲染（两层 shadow 隔离）                 生词本增删查 / 短期缓存
```

- **查询走 service worker**：`/api/v1/query` 不返回 CORS 头，页面里调不了；
  扩展后台有 host 权限，跨域不受限。
- **词典资源（图片/CSS/字体/音频）不走代理**：`/dict-res/…` 在 MyDict 上是公开只读的
  （不校验 token）且带 `Access-Control-Allow-Origin: *`，直接改写成绝对地址即可，
  词典 CSS 里的相对 `url(…)` 也能自然解析正确。
- **两层 shadow 隔离**：面板整体一个 shadow root（挡页面 CSS）；**每个词典再一个**
  （挡词典互相污染——词典爱用裸元素选择器，共用一个 scope 会让 A 词典的 CSS 重排
  B 词典的列表）。折叠骨架（`<details>`）留在面板层，免得被词典的
  `details{display:inline-block}` 之类规则打崩。
- **HTML 清洗**用 DOMPurify 默认白名单 + 词条自定义元素（`chn`/`o10`/…），
  `script`/`iframe`/表单/`on*` 处理器全去；`link`/`style` 被单独挑出来挂进各自的 shadow。

### 已知限制

- **不覆盖 PDF / 浏览器内置查看器**（拿不到选区）；iframe 页面默认不注入
- mydict 若配成 **HTTP** 地址，在 **HTTPS 页面**上词典的图片/样式会被拦（mixed content）——
  当前你的 HTTPS 入口不受影响
- `.spx` 音频：mydict 对 `.mp3` 请求有「同名 `.spx`」兜底，且 SPX 目录通常有同名 `.mp3`，
  所以候选链 `.mp3 → .opus → .spx` 基本够用；真正的 Speex JS 解码（`vendor/speex/`）尚未接上
- 每次查询上限 50 字

## 测试

```bash
cd chrome
/vol1/@appcenter/nodejs_v22/bin/node --test     # core/ 纯逻辑单测（21 例）
```

端到端：`tests/fixture.html`（`http://127.0.0.1:18080/`）——划选/双击里面的词验证面板；
`tests/unit/` 是纯逻辑单测。

## 目录

```
manifest.json        MV3 清单（权限、host_permissions、web_accessible_resources）
background.js        SW 入口
background/          router（消息路由）· mydict-client（HTTP）· cache
core/                两侧共用：protocol · settings · mydict-url · lookup-candidates · lemmatize
content.js           content script 入口（动态 import 下面这些）
content/             选区捕获 · 浮标 · 定位 · 面板外壳 · 生词本能力
render/              渲染层：分组+shadow · 清洗 · 资源改写 · 发音 · 链接 · 暗色适配
vendor/              DOMPurify(ESM) · libspeex-js（spx 解码，暂未接线）
icons/               取自 MyDict 的 logo
```
