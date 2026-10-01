/**
 * 英文词形还原（lemma）—— 查不到时兜底的候选词。
 *
 * 牛津这类词典只收原形词条，所以 `ran` / `mice` / `analyses` 这种变形直接查会命中不到，
 * 得补一个 `run` / `mouse` / `analysis` 的候选。这一层是**故意放宽**的：词典本身就是
 * 校验器，编错的词根查不到自然就跳过了，所以规则只需要"包含正确原形"，不必语言学上精确。
 *
 * 两层，按优先级：
 *   1. 不规则表（be/have/go 这类补充式动词、不规则复数、不规则比较级）——推不出来；
 *   2. 规则后缀（复数/过去式/现在分词/比较级/所有格）。
 *
 * 只处理单 token 的 ASCII 字母词；短语、数字、带重音或 CJK 一律返回 []。
 * 移植自 MyReader `src/services/dictionaries/lemmatize/english.ts`。
 */

// 原形 -> 应还原到它的不规则变形。按组写便于阅读，模块加载时摊平成 变形->原形 的表。
const IRREGULAR_GROUPS = {
  // 补充式 / 高度不规则的动词
  be: ['is', 'am', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'],
  say: ['said'],
  get: ['got', 'gotten'],
  make: ['made'],
  know: ['knew', 'known'],
  think: ['thought'],
  take: ['took', 'taken'],
  see: ['saw', 'seen'],
  come: ['came'],
  find: ['found'],
  give: ['gave', 'given'],
  tell: ['told'],
  feel: ['felt'],
  become: ['became'],
  leave: ['left'],
  mean: ['meant'],
  keep: ['kept'],
  begin: ['began', 'begun'],
  show: ['showed', 'shown'],
  hear: ['heard'],
  run: ['ran'],
  bring: ['brought'],
  write: ['wrote', 'written'],
  sit: ['sat'],
  stand: ['stood'],
  lose: ['lost'],
  pay: ['paid'],
  meet: ['met'],
  learn: ['learnt'],
  lead: ['led'],
  understand: ['understood'],
  speak: ['spoke', 'spoken'],
  spend: ['spent'],
  grow: ['grew', 'grown'],
  win: ['won'],
  teach: ['taught'],
  buy: ['bought'],
  send: ['sent'],
  build: ['built'],
  fall: ['fell', 'fallen'],
  catch: ['caught'],
  draw: ['drew', 'drawn'],
  choose: ['chose', 'chosen'],
  drive: ['drove', 'driven'],
  break: ['broke', 'broken'],
  eat: ['ate', 'eaten'],
  drink: ['drank', 'drunk'],
  sing: ['sang', 'sung'],
  swim: ['swam', 'swum'],
  ring: ['rang', 'rung'],
  fly: ['flew', 'flown'],
  throw: ['threw', 'thrown'],
  wear: ['wore', 'worn'],
  tear: ['tore', 'torn'],
  sell: ['sold'],
  hold: ['held'],
  feed: ['fed'],
  fight: ['fought'],
  hide: ['hid', 'hidden'],
  ride: ['rode', 'ridden'],
  rise: ['rose', 'risen'],
  shake: ['shook', 'shaken'],
  steal: ['stole', 'stolen'],
  freeze: ['froze', 'frozen'],
  sleep: ['slept'],
  bite: ['bit', 'bitten'],
  hang: ['hung'],
  shoot: ['shot'],
  sink: ['sank', 'sunk'],
  forget: ['forgot', 'forgotten'],
  forgive: ['forgave', 'forgiven'],
  lay: ['laid'],
  deal: ['dealt'],
  dig: ['dug'],
  shine: ['shone'],
  bend: ['bent'],
  lend: ['lent'],
  blow: ['blew', 'blown'],
  beat: ['beaten'],
  arise: ['arose', 'arisen'],
  awake: ['awoke', 'awoken'],
  // 不规则复数
  man: ['men'],
  woman: ['women'],
  child: ['children'],
  mouse: ['mice'],
  louse: ['lice'],
  goose: ['geese'],
  foot: ['feet'],
  tooth: ['teeth'],
  person: ['people'],
  ox: ['oxen'],
  die: ['dice'],
  criterion: ['criteria'],
  phenomenon: ['phenomena'],
  cactus: ['cacti'],
  fungus: ['fungi'],
  nucleus: ['nuclei'],
  radius: ['radii'],
  alumnus: ['alumni'],
  index: ['indices'],
  matrix: ['matrices'],
  vertex: ['vertices'],
  appendix: ['appendices'],
  // 不规则比较级 / 最高级
  good: ['better', 'best', 'well'],
  bad: ['worse', 'worst'],
  far: ['further', 'furthest', 'farther', 'farthest'],
  little: ['less', 'least'],
}

const IRREGULARS = {}
for (const [base, forms] of Object.entries(IRREGULAR_GROUPS)) {
  for (const form of forms) IRREGULARS[form] = base
}

const DOUBLED_CONSONANT = /[bcdfgklmnprstvz]/

/** "runn" -> "run"、"bigg" -> "big"；只在末尾是重复辅音时消一个。 */
function undouble(stem) {
  const last = stem[stem.length - 1]
  if (stem.length >= 2 && last === stem[stem.length - 2] && last && DOUBLED_CONSONANT.test(last)) {
    return stem.slice(0, -1)
  }
  return null
}

function applySuffixRules(word, push) {
  // --- 复数 / 第三人称单数 ---
  if (word.endsWith('ies') && word.length > 4) push(word.slice(0, -3) + 'y') // cities -> city
  if (word.endsWith('ves') && word.length > 3) {
    push(word.slice(0, -3) + 'f') // wolves -> wolf
    push(word.slice(0, -3) + 'fe') // knives -> knife
  }
  // 希腊/拉丁 -ses 复数；放在通用 -es 之前，让名词赢
  if (word.endsWith('ses') && word.length > 3) push(word.slice(0, -3) + 'sis') // analyses -> analysis
  if (/(s|x|z|ch|sh)es$/.test(word)) push(word.slice(0, -2)) // boxes -> box, dishes -> dish
  if (word.endsWith('es') && word.length > 2) push(word.slice(0, -1)) // houses -> house
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 1) push(word.slice(0, -1)) // cats -> cat

  // --- 过去式 / 过去分词 ---
  if (word.endsWith('ied') && word.length > 3) push(word.slice(0, -3) + 'y') // studied -> study
  if (word.endsWith('ed') && word.length > 2) {
    push(word.slice(0, -2)) // walked -> walk
    push(word.slice(0, -1)) // realised -> realise, used -> use
    const undoubled = undouble(word.slice(0, -2))
    if (undoubled) push(undoubled) // stopped -> stop
  }

  // --- 现在分词 / 动名词 ---
  if (word.endsWith('ying') && word.length > 4) push(word.slice(0, -4) + 'ie') // lying -> lie
  if (word.endsWith('ing') && word.length > 3) {
    push(word.slice(0, -3)) // walking -> walk
    push(word.slice(0, -3) + 'e') // making -> make
    const undoubled = undouble(word.slice(0, -3))
    if (undoubled) push(undoubled) // running -> run
  }

  // --- 比较级 / 最高级 ---
  if (word.endsWith('iest') && word.length > 4) push(word.slice(0, -4) + 'y') // happiest -> happy
  if (word.endsWith('ier') && word.length > 3) push(word.slice(0, -3) + 'y') // happier -> happy
  if (word.endsWith('est') && word.length > 3) {
    push(word.slice(0, -3)) // fastest -> fast
    push(word.slice(0, -2)) // largest -> large
    const undoubled = undouble(word.slice(0, -3))
    if (undoubled) push(undoubled) // biggest -> big
  }
  if (word.endsWith('er') && word.length > 2) {
    push(word.slice(0, -2)) // faster -> fast
    push(word.slice(0, -1)) // larger -> large
    const undoubled = undouble(word.slice(0, -2))
    if (undoubled) push(undoubled) // bigger -> big
  }

  // --- 副词 ---
  if (word.endsWith('ly') && word.length > 2) push(word.slice(0, -2)) // quickly -> quick
}

/** 单个词的英文原形候选，有序去重。非英文 token 返回 []。 */
export function lemmatizeEnglish(word) {
  const lower = word.toLowerCase()
  if (!/^[a-z][a-z'’-]*$/.test(lower)) return []

  const out = []
  const push = (candidate) => {
    // 跳过空串、单字母、输入本身和重复项
    if (candidate.length > 1 && candidate !== lower && !out.includes(candidate)) {
      out.push(candidate)
    }
  }

  // 所有格："cat's" / "dogs'" -> 去掉附着词再还原名词
  const stripped = lower.replace(/['’]s?$/, '')
  const root = stripped !== lower ? stripped : lower
  if (stripped !== lower) push(stripped)

  if (IRREGULARS[root]) push(IRREGULARS[root])
  applySuffixRules(root, push)

  return out
}
