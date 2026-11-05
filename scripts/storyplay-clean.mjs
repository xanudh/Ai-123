/**
 * 清洗 StoryPlay 的日本 / 韩国选项，生成故事架构「题材类型 / 风格元素」下拉框的选项。
 *
 * 输入：docs/storyplay-options/*.json（11/3 抓的原始数据，不改）
 * 输出：docs/storyplay-options/clean/japan_ai-drama.json、korea_ai-drama.json（清洗后的三栏）
 *       docs/storyplay-options/clean/清洗记录.md（每个词删了 / 挪了、为什么）
 *       src/domain/genreOptions.ts（欧美 + 日韩合并后的两栏）
 *
 * 用法：node scripts/storyplay-clean.mjs
 *
 * 清洗规则（只动题材类型、风格元素；核心设定只去掉组内重复）：
 *  1. 组内重复：删掉
 *  2. 题材类型里跨组重复：只留一处，默认留第一次出现的组，PREFER 里写了的留在指定组
 *  3. 题材类型和风格元素都有：留在题材类型，从风格元素删掉；吃的、穿的、地名、日常场所（CONCRETE）反过来，只留在「元素」
 *  4. 风格元素 · 元素里的身份、情节：核心设定的流派 / 身份 / 金手指 / 情节里有的，从元素删掉（核心设定 · 其他是元素的复制，不算）
 *  5. 风格元素里风格、元素都有：留在风格
 * 日韩合并：同类的组合成一组（MERGE），合并后每个词只出现一次；合并后再按第 3 条去一遍
 * 欧美：不清洗，只按第 3 条去掉两栏都有的词，免得两个下拉框里出现同一个词
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'docs/storyplay-options')
const out = join(src, 'clean')
const read = (name) => JSON.parse(readFileSync(join(src, name), 'utf8'))

/** 跨组重复时留在哪一组（不写就留第一次出现的组） */
const PREFER = {
  japan: { 状态栏: '游戏系统', 打脸爽感: '复仇逆袭', 因果报应: '复仇逆袭', 都市传说: '悬疑惊悚', 黑道: '黑道侠义', 地下偶像: '直播网红', 追星应援: '直播网红' },
  korea: { 契约婚姻: '现代言情', 诅咒: '灵异驱魔', 附身: '灵异驱魔', 地下秩序: '黑帮组织', 都市传说: '恐怖惊悚' },
}

/** 具体物件（吃的、穿的、地名、日常场所）：两栏都有时只留在风格元素 · 元素；日韩共用，合并后不会再撞 */
const CONCRETE = ['温泉', '旅馆', '公寓', '安全屋', '韩服', '韩屋', '校服', '泡菜', '炸鸡', '烧酒', '烤肉', '汗蒸房', '桑拿', '便利店', '考试院', '半地下', '江南', '釜山', '济州岛', '方言']

/** 日韩合并：合并后的组名 ← [日本的组, 韩国的组]；按这个顺序排，先出现的组留词 */
const MERGE = [
  ['时代背景', ['时代背景'], ['时代背景']],
  ['恋爱言情', ['恋爱言情'], ['现代言情']],
  ['豪门财阀', ['豪门财阀'], ['财阀豪门']],
  ['复仇逆袭', ['复仇逆袭'], ['复仇逆袭']],
  ['职场现实', ['职场现实'], ['职场现实']],
  ['家庭伦理', ['家庭伦理'], ['家庭伦理']],
  ['青春校园', ['青春校园'], ['校园青春']],
  ['偶像练习生', [], ['偶像练习生']],
  ['直播网红', ['直播网红'], ['直播网红']],
  ['悬疑刑侦', [], ['悬疑刑侦']],
  ['悬疑惊悚', ['悬疑惊悚'], ['恐怖惊悚']],
  ['恐怖灵异', ['恐怖灵异'], ['灵异驱魔']],
  ['和风奇幻', ['和风奇幻'], []],
  ['异世界转生', ['异世界转生'], []],
  ['反派千金', ['反派千金'], []],
  ['游戏系统', ['游戏系统'], ['游戏异世界']],
  ['奇幻冒险', ['奇幻冒险'], ['奇幻异能']],
  ['科幻近未来', ['科幻近未来'], ['科幻未来']],
  ['末世生存', ['末世生存'], ['末世灾难']],
  ['黑道帮派', ['黑道侠义'], ['黑帮组织']],
  ['时代剧', ['时代剧'], []],
  ['古装权谋', [], ['古装权谋']],
  ['政治谍战', [], ['政治谍战']],
  ['历史抗日', [], ['历史抗日']],
  ['宗教邪教', [], ['宗教邪教']],
  ['其他', ['其他'], ['其他']],
]

const log = []
const note = (region, field, group, word, why) => log.push({ region, field, group, word, why })
const FIELD = { timePeriod: '题材类型', storyCategory: '核心设定', storyType: '风格元素' }
const words = (field) => new Set(Object.values(field).flat())

function clean(key, data) {
  const d = structuredClone(data)
  // 1. 组内重复
  for (const f of Object.keys(d))
    for (const [g, list] of Object.entries(d[f])) {
      const seen = new Set()
      d[f][g] = list.filter((w) => (seen.has(w) ? (note(key, FIELD[f], g, w, '组内重复'), false) : seen.add(w)))
    }
  // 2. 题材类型跨组重复
  for (const [w, g] of Object.entries(PREFER[key])) if (!d.timePeriod[g]?.includes(w)) throw new Error(`${key}: 「${g}」里没有 ${w}`)
  const home = {}
  for (const [g, list] of Object.entries(d.timePeriod)) for (const w of list) home[w] ??= PREFER[key][w] ?? g
  for (const [g, list] of Object.entries(d.timePeriod))
    d.timePeriod[g] = list.filter((w) => (home[w] === g ? true : (note(key, '题材类型', g, w, `跨组重复，留在「${home[w]}」`), false)))
  // 3. 具体物件只留在元素（这一套的元素里没有就挪过去）
  const concrete = new Set(CONCRETE)
  for (const [g, list] of Object.entries(d.timePeriod))
    d.timePeriod[g] = list.filter((w) => {
      if (!concrete.has(w)) return true
      if (d.storyType['元素'].includes(w)) note(key, '题材类型', g, w, '具体物件，只留在风格元素 · 元素')
      else (d.storyType['元素'].push(w), note(key, '题材类型', g, w, '具体物件，挪到风格元素 · 元素'))
      return false
    })
  // 3. 两栏都有：留在题材类型
  const themes = words(d.timePeriod)
  for (const [g, list] of Object.entries(d.storyType))
    d.storyType[g] = list.filter((w) => (themes.has(w) ? (note(key, '风格元素', g, w, '题材类型里有，留在题材类型'), false) : true))
  // 4. 元素里的身份、情节
  const core = new Set(Object.entries(d.storyCategory).flatMap(([g, list]) => (g === '其他' ? [] : list)))
  const coreGroup = (w) => Object.entries(d.storyCategory).find(([g, list]) => g !== '其他' && list.includes(w))[0]
  d.storyType['元素'] = d.storyType['元素'].filter((w) => (core.has(w) && !concrete.has(w) ? (note(key, '风格元素', '元素', w, `核心设定 · ${coreGroup(w)}里有，不算元素`), false) : true))
  // 5. 风格、元素都有：留在风格
  const styles = new Set(d.storyType['风格'])
  d.storyType['元素'] = d.storyType['元素'].filter((w) => (styles.has(w) ? (note(key, '风格元素', '元素', w, '风格里有，留在风格'), false) : true))
  return d
}

/** 题材类型、风格元素两栏都有的词从风格元素去掉 */
function dropShared(region, themes, styles) {
  const all = words(themes)
  for (const [g, list] of Object.entries(styles))
    styles[g] = list.filter((w) => (all.has(w) ? (note(region, '风格元素', g, w, '题材类型里有，留在题材类型'), false) : true))
  return styles
}

const elements = new Set(['japan_ai-drama.json', 'korea_ai-drama.json'].flatMap((f) => read(f).storyType['元素']))
for (const w of CONCRETE) if (!elements.has(w)) throw new Error(`具体物件 ${w} 日韩的元素里都没有`)

const jp = clean('japan', read('japan_ai-drama.json'))
const kr = clean('korea', read('korea_ai-drama.json'))

// 日韩合并
for (const [, j, k] of MERGE)
  for (const [region, names] of [[jp, j], [kr, k]]) for (const n of names) if (!region.timePeriod[n]) throw new Error(`没有这一组：${n}`)
const mergedGroups = Object.keys(jp.timePeriod).length + Object.keys(kr.timePeriod).length
if (MERGE.reduce((n, [, j, k]) => n + j.length + k.length, 0) !== mergedGroups) throw new Error('MERGE 没有覆盖日韩所有的组')
const seen = new Set()
const once = (list) => list.filter((w) => !seen.has(w) && seen.add(w))
const jpkrThemes = Object.fromEntries(MERGE.map(([name, j, k]) => [name, once([...j.flatMap((g) => jp.timePeriod[g]), ...k.flatMap((g) => kr.timePeriod[g])])]))
seen.clear()
const jpkrStyles = dropShared('日韩合并', jpkrThemes, {
  风格: once([...jp.storyType['风格'], ...kr.storyType['风格']]),
  元素: once([...jp.storyType['元素'], ...kr.storyType['元素']]),
})

// 欧美
const west = read('overseas_ai-drama.json')
const westStyles = dropShared('overseas', west.timePeriod, structuredClone(west.storyType))

/* ---------------------------------- 写文件 ---------------------------------- */

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'japan_ai-drama.json'), JSON.stringify(jp, null, 2) + '\n')
writeFileSync(join(out, 'korea_ai-drama.json'), JSON.stringify(kr, null, 2) + '\n')

const count = (field) => Object.values(field).flat().length
const raw = { japan: read('japan_ai-drama.json'), korea: read('korea_ai-drama.json') }
const NAME = { japan: '日本', korea: '韩国', overseas: '欧美', 日韩合并: '日韩合并' }
const md = [
  '# StoryPlay 日韩选项清洗记录',
  '',
  '> 由 `scripts/storyplay-clean.mjs` 生成，规则见脚本开头；原始数据在上一层目录，不改',
  '',
  '| 套 | 题材类型 | 核心设定 | 风格元素 |',
  '| --- | --- | --- | --- |',
  ...['japan', 'korea'].map((k) => {
    const c = { japan: jp, korea: kr }[k]
    return `| ${NAME[k]} | ${count(raw[k].timePeriod)} → ${count(c.timePeriod)} | ${count(raw[k].storyCategory)} → ${count(c.storyCategory)} | ${count(raw[k].storyType)} → ${count(c.storyType)} |`
  }),
  `| 日韩合并（下拉框用） | ${count(jpkrThemes)}（${MERGE.length} 组） | 不用 | ${count(jpkrStyles)} |`,
  `| 欧美（下拉框用） | ${count(west.timePeriod)}（${Object.keys(west.timePeriod).length} 组） | 不用 | ${count(west.storyType)} → ${count(westStyles)} |`,
  '',
  '## 日韩合并的组',
  '',
  '| 合并后 | 日本 | 韩国 |',
  '| --- | --- | --- |',
  ...MERGE.map(([name, j, k]) => `| ${name}（${jpkrThemes[name].length}） | ${j.join('、') || '—'} | ${k.join('、') || '—'} |`),
  '',
  '## 逐条记录',
  '',
  ...Object.keys(NAME).flatMap((r) => {
    const rows = log.filter((x) => x.region === r)
    if (!rows.length) return []
    const byWhy = new Map()
    for (const x of rows) {
      const k = `${x.field} · ${x.why}`
      byWhy.set(k, [...(byWhy.get(k) ?? []), `${x.word}（${x.group}）`])
    }
    return [`### ${NAME[r]}（${rows.length} 条）`, '', ...[...byWhy].map(([k, list]) => `- **${k}**（${list.length}）：${list.join('、')}`), '']
  }),
]
writeFileSync(join(out, '清洗记录.md'), md.join('\n'))

const ts = (groups) =>
  '{\n' + Object.entries(groups).filter(([, list]) => list.length).map(([g, list]) => `    ${g}: [${list.map((w) => `'${w}'`).join(', ')}],`).join('\n') + '\n  }'
writeFileSync(
  join(root, 'src/domain/genreOptions.ts'),
  `/**
 * 故事架构「题材类型 / 风格元素」的选项，取自 StoryPlay（2026-11-03 抓取），按目标市场分欧美、日韩两套。
 * 由 scripts/storyplay-clean.mjs 生成，别手改：日本、韩国两套先清洗再合并，规则和逐条记录见 docs/storyplay-options/clean/清洗记录.md
 */
export type GenreRegion = 'west' | 'jpkr'

export const GENRE_OPTIONS: Record<GenreRegion, { themes: Record<string, string[]>; styles: Record<string, string[]> }> = {
  west: {
    themes: ${ts(west.timePeriod).replaceAll('\n', '\n  ')},
    styles: ${ts(westStyles).replaceAll('\n', '\n  ')},
  },
  jpkr: {
    themes: ${ts(jpkrThemes).replaceAll('\n', '\n  ')},
    styles: ${ts(jpkrStyles).replaceAll('\n', '\n  ')},
  },
}
`,
)

console.log(md.slice(4, 10).join('\n'))
console.log(`共 ${log.length} 条记录`)
