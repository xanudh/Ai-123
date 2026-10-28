/**
 * 本地模拟写作用的素材：题材套件、人名库、事件与台词模板。
 * 模板里的 {hero} {lover} {villain} {ally} {mentor} {prop} {secret} {identity} {grudge} {place}
 * 在生成时替换成项目里的人物与设定。接入大模型后这些模板不再使用。
 */
import type { HookType } from '../../domain/types'

export type Slot = 'hero' | 'lover' | 'villain' | 'ally' | 'mentor'

export interface RoleKit {
  profile: string
  desire: string
  flaw: string
  arc: string
}

export interface Place {
  zh: string
  en: string
}

export interface Kit {
  key: string
  label: string
  world: string
  prop: string
  propEn: string
  secret: string
  identity: string
  grudge: string
  formula: string
  opening: string
  ending: string
  loglines: string[]
  roles: Record<Slot, RoleKit>
  /** 人物关系类型：主角–感情线、主角–反派、反派–感情线、主角–盟友、知情人–主角（按题材设定来） */
  ties: [string, string, string, string, string]
  places: Place[]
}

const KITS: Record<string, Kit> = {
  werewolf: {
    key: 'werewolf',
    label: '狼人',
    world: '狼族林立的北美小镇：族群以阿尔法为尊，命定伴侣由月神选定，人类对此一无所知',
    prop: '母亲留下的月石吊坠',
    propEn: 'moonstone pendant',
    secret: '{hero}是被灭族的月祭司一脉最后的传人',
    identity: '月祭司传人',
    grudge: '{villain}的家族当年参与了对月祭司一脉的屠杀',
    formula: '每 3 集一次“看不起主角的人被打脸”，每 10 集一次血脉觉醒升级',
    opening: '{hero}在成年礼上被{lover}当众拒绝，随即被逐出族群',
    ending: '{hero}以{identity}身份加冕，{lover}当着全族单膝跪地求回',
    loglines: [
      '被阿尔法当众拒绝的“无狼形”伴侣，三年后作为敌对族群的使者归来——却发现自己是被灭族的月祭司一脉最后的传人。',
      '被逐出族群的“废柴”，靠一枚月石吊坠在荒野活了下来——而当年拒绝这段命定姻缘的阿尔法，正被同一道诅咒折磨。',
    ],
    roles: {
      hero: { profile: '被{lover}当众拒绝的“无狼形”伴侣，族中公认的废柴', desire: '夺回尊严，查清母亲的死因', flaw: '不敢再相信任何人', arc: '被弃的废柴 → 觉醒血脉 → 狼族共主' },
      lover: { profile: '年轻的阿尔法，表面冷酷，实则被长老会掣肘', desire: '守住摇摇欲坠的族群', flaw: '把责任看得比爱人更重', arc: '当众拒绝 → 悔恨追妻 → 并肩而战' },
      villain: { profile: '贝塔家族继承人，觊觎{lover}身边的位置与族群权力', desire: '掌控族群', flaw: '嫉妒成性，不择手段', arc: '步步紧逼 → 阴谋败露 → 众叛亲离' },
      ally: { profile: '族中医者，{hero}唯一的朋友', desire: '护住{hero}', flaw: '胆小怕事', arc: '旁观者 → 挺身作证' },
      mentor: { profile: '知晓当年旧案的老长老', desire: '让真相重见天日', flaw: '为自保沉默多年', arc: '沉默 → 揭开旧案 → 以命相护' },
    },
    ties: ['命定伴侣', '仇人', '追求者', '朋友', '长辈'],
    places: [
      { zh: '狼族议事厅', en: 'PACK COUNCIL HALL' },
      { zh: '边境森林', en: 'BORDER FOREST' },
      { zh: '阿尔法宅邸', en: "ALPHA'S MANSION" },
      { zh: '月神祭坛', en: 'MOON ALTAR' },
      { zh: '训练场', en: 'TRAINING GROUNDS' },
      { zh: '地牢', en: 'DUNGEON' },
    ],
  },
  vampire: {
    key: 'vampire',
    label: '吸血鬼',
    world: '血族掌控夜色经济的现代都市：人类与血族签有古老的停战契约，违约者会被阳光烧成灰烬',
    prop: '刻着家徽的银戒',
    propEn: 'silver signet ring',
    secret: '{hero}的血能让血族在阳光下行走',
    identity: '初代血族的转世',
    grudge: '{villain}当年为夺权，设计了{hero}父母的“意外”',
    formula: '每 3 集一次身份试探，每 10 集一次血统揭秘',
    opening: '{hero}为替家人还债被送进血族古堡，成为{lover}的专属“血仆”',
    ending: '{hero}觉醒{identity}之力，与{lover}一起终结血族诅咒',
    loglines: [
      '被卖进血族古堡还债的普通人，成了亲王的专属“血仆”——却发现自己的血能让血族在阳光下行走。',
      '与血族亲王签下百日契约的人类，只要活过一百天就能自由——可整座古堡都想喝干这份血。',
    ],
    roles: {
      hero: { profile: '为还债被卖进血族古堡的普通人', desire: '活下去，带家人离开这座城市', flaw: '冲动，遇事先硬碰硬', arc: '猎物 → 契约者 → 血族之主' },
      lover: { profile: '冷酷的血族亲王，活了三百年', desire: '解开家族的阳光诅咒', flaw: '不相信人类', arc: '利用 → 守护 → 为爱放弃永生' },
      villain: { profile: '古老血族的继承人，与{lover}有婚约', desire: '吞并{lover}的家族', flaw: '傲慢，视人类为食物', arc: '高高在上 → 阴谋败露 → 被阳光吞噬' },
      ally: { profile: '古堡里同样身不由己的人类仆从', desire: '逃出古堡', flaw: '胆小', arc: '自保 → 冒死报信' },
      mentor: { profile: '侍奉过三代亲王的老管家', desire: '守住古堡的秘密', flaw: '忠诚到盲目', arc: '旁观 → 交出密钥' },
    },
    ties: ['主仆', '仇人', '未婚夫妻', '同伴', '主仆'],
    places: [
      { zh: '血族古堡', en: 'VAMPIRE CASTLE' },
      { zh: '午夜酒吧', en: 'MIDNIGHT BAR' },
      { zh: '古堡地窖', en: 'CASTLE CELLAR' },
      { zh: '地下拍卖会', en: 'UNDERGROUND AUCTION' },
      { zh: '医院血库', en: 'HOSPITAL BLOOD BANK' },
      { zh: '雨夜街头', en: 'RAINY STREET' },
    ],
  },
  mafia: {
    key: 'mafia',
    label: '黑手党',
    world: '黑手党家族盘踞的纽约：家族规矩高于法律，背叛者只有一个下场',
    prop: '刻着家族徽记的旧怀表',
    propEn: 'old pocket watch',
    secret: '{hero}的父亲就是当年“背叛”家族的人，而他是被冤枉的',
    identity: '对立家族遗落的继承人',
    grudge: '二十年前的码头血案，{villain}才是真正的告密者',
    formula: '每 3 集一次立场反转，每 10 集一次家族博弈升级',
    opening: '{hero}误闯家族交易现场，被新任教父{lover}强行带走',
    ending: '{hero}以{identity}身份出面，终结两大家族二十年的世仇',
    loglines: [
      '误闯黑手党交易现场的护士，被迫成为教父的“临时新娘”——却发现自己的父亲正是教父追查多年的叛徒。',
      '为救弟弟签下卖身契的普通人，在教父身边步步为营——而对立家族一直在找的继承人，就是自己。',
    ],
    roles: {
      hero: { profile: '误闯家族交易现场的急诊科护士', desire: '保护唯一的弟弟', flaw: '心软，总想救所有人', arc: '人质 → 筹码 → 家族掌舵人' },
      lover: { profile: '刚接手家族的年轻教父，手段狠辣', desire: '揪出家族里的内鬼', flaw: '多疑，从不示弱', arc: '囚禁 → 信任 → 为爱违背家规' },
      villain: { profile: '家族元老之子，表面忠诚', desire: '取代{lover}掌控家族', flaw: '野心大于能力', arc: '暗中布局 → 内鬼身份曝光 → 被家族清算' },
      ally: { profile: '{lover}的贴身保镖，嘴硬心软', desire: '守住家族', flaw: '只认命令', arc: '监视 → 暗中相助' },
      mentor: { profile: '退隐的老教父，知道码头血案的全部真相', desire: '赎当年的罪', flaw: '优柔寡断', arc: '隐瞒 → 说出真相' },
    },
    ties: ['恋人', '宿敌', '上下级', '看守', '长辈'],
    places: [
      { zh: '家族庄园', en: 'FAMILY ESTATE' },
      { zh: '地下赌场', en: 'UNDERGROUND CASINO' },
      { zh: '码头仓库', en: 'DOCK WAREHOUSE' },
      { zh: '意式餐厅', en: 'ITALIAN RESTAURANT' },
      { zh: '教堂', en: 'CHURCH' },
      { zh: '急诊室', en: 'EMERGENCY ROOM' },
    ],
  },
  billionaire: {
    key: 'billionaire',
    label: '豪门霸总',
    world: '纽约上东区的豪门圈层：联姻、股权与家族名誉决定一切',
    prop: '一份被调包的亲子鉴定',
    propEn: 'switched DNA report',
    secret: '五年前那一夜的人，就是{lover}',
    identity: '豪门真正的继承人',
    grudge: '{villain}一家当年调包了{hero}的身份',
    formula: '每 2 集一次心动反转，每 10 集一次身份打脸',
    opening: '{hero}为凑齐母亲的手术费，与{lover}签下一年契约婚姻',
    ending: '{hero}恢复{identity}身份，{lover}在婚礼上重新求婚',
    loglines: [
      '为救母亲签下一年契约婚姻的普通女孩，发现冷面总裁就是五年前那一夜的男人——而她自己，才是被调包的豪门真千金。',
      '替姐姐嫁进豪门的妹妹，新婚夜就被要求离婚——可契约到期那天，先反悔的是总裁。',
    ],
    roles: {
      hero: { profile: '为母亲手术费签下婚约的普通职员', desire: '凑齐手术费，活得体面', flaw: '自尊心太强，有事不说', arc: '契约伴侣 → 并肩伴侣 → 豪门继承人' },
      lover: { profile: '冷面财阀继承人，商界出了名的不近人情', desire: '稳住集团继承权', flaw: '不懂表达，习惯用钱解决问题', arc: '契约交易 → 动心失控 → 追妻' },
      villain: { profile: '与{lover}青梅竹马的名门之后', desire: '嫁进{lover}的家族', flaw: '虚荣，输不起', arc: '处处设局 → 身份造假败露 → 一无所有' },
      ally: { profile: '{hero}的大学室友，嘴毒心软', desire: '看{hero}过上好日子', flaw: '藏不住话', arc: '吐槽担当 → 关键证人' },
      mentor: { profile: '{lover}家族的老管家', desire: '弥补当年的过错', flaw: '守口如瓶', arc: '沉默 → 交出当年的证据' },
    },
    ties: ['契约夫妻', '情敌', '青梅竹马', '室友', '长辈'],
    places: [
      { zh: '集团顶层办公室', en: 'PENTHOUSE OFFICE' },
      { zh: '慈善晚宴', en: 'CHARITY GALA' },
      { zh: '婚礼教堂', en: 'WEDDING CHAPEL' },
      { zh: '豪门老宅', en: 'FAMILY MANSION' },
      { zh: '医院走廊', en: 'HOSPITAL CORRIDOR' },
      { zh: '雨夜街头', en: 'RAINY STREET' },
    ],
  },
  revenge: {
    key: 'revenge',
    label: '重生复仇',
    world: '现代都市豪门：商战与家族恩怨交织，人人都戴着面具',
    prop: '前世临死前握在手里的录音笔',
    propEn: 'voice recorder',
    secret: '{hero}带着前世的记忆重生回了婚礼前夜',
    identity: '幕后收购集团的神秘投资人',
    grudge: '前世{villain}与未婚夫联手，夺走了{hero}的一切和性命',
    formula: '每 3 集一次“预知反杀”，每 10 集一次大仇得报',
    opening: '{hero}在婚礼前夜重生，撞破{villain}与未婚夫的私情',
    ending: '{hero}亲手把{villain}送进监狱，与{lover}重新开始',
    loglines: [
      '被闺蜜和未婚夫联手害死的千金，重生回到婚礼前夜——这一次，她要让他们亲手把一切还回来。',
      '重生回婚礼前夜的新娘决定逃婚复仇，却发现前世唯一替她收尸的冷面律师，也带着记忆回来了。',
    ],
    roles: {
      hero: { profile: '重生回婚礼前夜的豪门继承人', desire: '让前世的仇人付出代价', flaw: '复仇心切，把所有人推开', arc: '复仇机器 → 放下执念 → 重获新生' },
      lover: { profile: '前世唯一替{hero}收尸的冷面律师', desire: '查清一桩尘封的旧案', flaw: '城府太深，从不解释', arc: '旁观 → 联手 → 真心' },
      villain: { profile: '前世害死{hero}的“好朋友”', desire: '夺走{hero}的家产与人生', flaw: '贪婪，演技太好', arc: '伪装 → 步步败露 → 身败名裂' },
      ally: { profile: '跟了{hero}多年的助理', desire: '报答{hero}一家的恩情', flaw: '太老实', arc: '跟班 → 左膀右臂' },
      mentor: { profile: '{hero}已故父亲的老友，商界前辈', desire: '守住老友的遗产', flaw: '谨慎过头', arc: '观望 → 出手相助' },
    },
    ties: ['合作伙伴', '假闺蜜', '对手', '上下级', '长辈'],
    places: [
      { zh: '婚礼现场', en: 'WEDDING VENUE' },
      { zh: '集团会议室', en: 'BOARDROOM' },
      { zh: '家族老宅', en: 'FAMILY MANSION' },
      { zh: '医院病房', en: 'HOSPITAL ROOM' },
      { zh: '天台', en: 'ROOFTOP' },
      { zh: '律师事务所', en: 'LAW OFFICE' },
    ],
  },
  hidden: {
    key: 'hidden',
    label: '隐藏身份',
    world: '现代都市：顶级家族隐于幕后，世俗豪门趋炎附势',
    prop: '一枚不起眼的黑色令牌',
    propEn: 'black token',
    secret: '{hero}三年前隐退，是为了查清师父被害的真相',
    identity: '隐世家族的继承人',
    grudge: '{villain}的家族吞并了{hero}师门的产业，还害死了师父',
    formula: '每 2 集一次身份碾压，每 10 集掉一个大马甲',
    opening: '{hero}在家族宴会上被当众羞辱，被逼签下离婚协议',
    ending: '{hero}以{identity}身份归来，清算所有恩怨',
    loglines: [
      '在豪门当了三年上门女婿的“废物”，被逼离婚当天恢复身份——他是隐世家族唯一的继承人。',
      '被嘲“乡下土包子”的真千金回到豪门，没人知道她是神医、黑客和赛车手。',
    ],
    roles: {
      hero: { profile: '在豪门被嘲讽了三年的“废物”', desire: '查清师父的死因', flaw: '习惯隐忍，什么都自己扛', arc: '隐忍 → 掉马 → 站上顶点' },
      lover: { profile: '唯一没有看轻{hero}的商界强人', desire: '撑住摇摇欲坠的家族企业', flaw: '太骄傲，不肯求人', arc: '冷眼 → 动摇 → 坚定站队' },
      villain: { profile: '豪门圈里的天之骄子，处处踩{hero}一头', desire: '吞并{lover}的家族企业', flaw: '狂妄自大', arc: '踩人 → 被打脸 → 家族覆灭' },
      ally: { profile: '{hero}当年的同门', desire: '替师父报仇', flaw: '性子急', arc: '暗中跟随 → 并肩作战' },
      mentor: { profile: '隐世家族的老管家', desire: '等{hero}回家', flaw: '只听家主的命令', arc: '暗中守护 → 公开拜见' },
    },
    ties: ['合作伙伴', '宿敌', '对手', '同门', '主仆'],
    places: [
      { zh: '豪门宴会厅', en: 'BANQUET HALL' },
      { zh: '家族祠堂', en: 'ANCESTRAL HALL' },
      { zh: '拍卖会', en: 'AUCTION HOUSE' },
      { zh: '医院急诊', en: 'EMERGENCY ROOM' },
      { zh: '集团大厦', en: 'CORPORATE TOWER' },
      { zh: '老街药铺', en: 'OLD HERBAL SHOP' },
    ],
  },
}

const KIT_OF_GENRE: Record<string, string> = {
  狼人: 'werewolf',
  吸血鬼: 'vampire',
  黑手党: 'mafia',
  霸总: 'billionaire',
  契约婚姻: 'billionaire',
  闪婚: 'billionaire',
  先婚后爱: 'billionaire',
  豪门: 'billionaire',
  灰姑娘: 'billionaire',
  替嫁: 'billionaire',
  萌宝: 'billionaire',
  重生: 'revenge',
  复仇: 'revenge',
  追妻火葬场: 'revenge',
  逆袭: 'revenge',
  宫斗: 'revenge',
  隐藏身份: 'hidden',
  战神: 'hidden',
  神医: 'hidden',
  马甲: 'hidden',
}

/** 按立项题材的先后顺序取第一个能匹配的套件 */
export function kitFor(genres: string[]): Kit {
  const key = genres.map((g) => KIT_OF_GENRE[g]).find(Boolean)
  return KITS[key ?? 'billionaire']
}

/** 和当前套件不同的其他套件，用于“题材迁移”类方向 */
export const otherKits = (kit: Kit) => Object.values(KITS).filter((k) => k.key !== kit.key)

/* ---------------------------------- 人名 ---------------------------------- */

export type Gender = 'f' | 'm'

/** [英文名, 中文译名] */
export const EN_NAMES: Record<Gender, [string, string][]> = {
  f: [
    ['Elena', '埃琳娜'], ['Aria', '艾瑞雅'], ['Luna', '露娜'], ['Sophia', '索菲亚'], ['Chloe', '克洛伊'], ['Ivy', '艾薇'], ['Bianca', '比安卡'],
    ['Serena', '塞丽娜'], ['Natalie', '娜塔莉'], ['Vanessa', '凡妮莎'], ['Mia', '米娅'], ['Grace', '格蕾丝'], ['Zoe', '佐伊'], ['Nora', '诺拉'],
  ],
  m: [
    ['Damien', '达米安'], ['Alexander', '亚历山大'], ['Ethan', '伊森'], ['Sebastian', '塞巴斯蒂安'], ['Adrian', '阿德里安'], ['Dominic', '多米尼克'],
    ['Ryan', '瑞恩'], ['Nathan', '内森'], ['Julian', '朱利安'], ['Owen', '欧文'], ['Arthur', '亚瑟'], ['Gregory', '格雷戈里'], ['Henry', '亨利'], ['Walter', '沃尔特'],
  ],
}

/** [拼音, 中文名] */
export const CN_NAMES: Record<Gender, [string, string][]> = {
  f: [['Lin Wan', '林晚'], ['Su Qing', '苏晴'], ['Shen Yan', '沈嫣'], ['Gu Nian', '顾念'], ['Jiang Li', '江离'], ['Xu Wei', '许薇'], ['Tang Xin', '唐心'], ['Ye Zhi', '叶枝']],
  m: [['Lu Chen', '陆沉'], ['Fu Shiyan', '傅时砚'], ['Gu Yan', '顾言'], ['Xie Huai', '谢淮'], ['Qin Mo', '秦墨'], ['Zhou Yu', '周屿'], ['Song Ci', '宋辞'], ['Wen Shu', '温书']],
}

/* ---------------------------------- 大纲 ---------------------------------- */

/** 五段式主线各段的常规事件 */
export const PHASE_EVENTS: string[][] = [
  [
    '{hero}被{villain}当众羞辱，{lover}冷眼旁观',
    '{hero}失去一切，在{place}独自咬牙撑下去',
    '{villain}抢走本属于{hero}的位置，还放话让{hero}永远消失',
    '{hero}无意间触动了{prop}，异样初现',
    '{ally}冒险帮{hero}脱身，两人约定东山再起',
    '{lover}第一次注意到{hero}的反常',
    '{hero}在{place}遭人暗算，险些丧命',
  ],
  [
    '{hero}第一次反击，让{villain}当众出丑',
    '{hero}在{place}与{lover}重逢，{lover}几乎认不出眼前人',
    '{villain}设局陷害{hero}，被{hero}提前识破',
    '{mentor}暗中观察{hero}，似乎知道些什么',
    '{lover}发现{hero}身上的{prop}，神色大变',
    '{hero}用实力赢得第一批支持者',
    '{ally}查到{villain}的把柄，却被对方察觉',
    '{lover}试探{hero}的来历，两人针锋相对',
  ],
  [
    '{lover}说出当年的苦衷，{hero}却不肯原谅',
    '{villain}与幕后势力勾结的证据浮出水面',
    '{hero}被诬陷，{lover}第一次选择站在{hero}这边',
    '{mentor}揭开当年旧案的一角',
    '{hero}与{lover}被迫联手调查旧案',
    '{villain}察觉{hero}的真实目的，开始反扑',
    '{hero}在{place}找到与{prop}有关的新线索',
  ],
  [
    '{villain}狗急跳墙，绑走{ally}逼{hero}现身',
    '{hero}和{lover}在误会中再度决裂',
    '{hero}为救{lover}身陷险境',
    '幕后黑手浮出水面，{hero}看清了全部真相',
    '{hero}集结盟友，准备最终对决',
    '{villain}当众反咬一口，{hero}陷入孤立',
    '{lover}为{hero}与整个家族翻脸',
  ],
  [
    '{villain}的阴谋被彻底揭穿，众叛亲离',
    '{lover}为{hero}挡下致命一击',
    '{hero}在{place}与{villain}最终对决',
    '{hero}与{lover}解开所有心结',
    '{ally}带着关键证据及时赶到',
    '尘埃落定，{hero}做出最后的选择',
  ],
]

/** 事件后缀，让同一段内的事件不至于重样 */
export const EVENT_TAILS = ['', '，局势急转直下', '，却付出了意想不到的代价', '，{lover}的态度开始动摇', '，{villain}暗中记下这笔账', '，{ally}察觉到异样', '，真相又近了一步']

export const TWIST_EVENTS = ['真相揭开：{secret}', '{mentor}说出尘封旧案：{grudge}', '{lover}终于得知{hero}就是{identity}']

export const PAYWALL_EVENTS = [
  '{hero}即将揭穿{villain}的关键一刻，证据被人毁掉',
  '{lover}被迫在{hero}与{villain}之间做出选择',
  '{hero}的身份即将曝光，{villain}抢先一步',
  '{hero}命悬一线，{lover}破门而入',
]

export const CLIMAX_EVENT = '{hero}当众公开{identity}身份，全场震动'

export const HOOK_LINES: Record<HookType, string[]> = {
  悬念: [
    '门外传来脚步声，{hero}回头——来人竟是{lover}',
    '{hero}收到一条匿名消息：“当年的事，不是意外。”',
    '{villain}拨通一个号码：“{hero}回来了，按计划行事。”',
    '{prop}忽然发出微光，{hero}愣在原地',
    '{ally}的电话再也打不通，最后的定位停在{place}',
  ],
  反转: [
    '那个一直暗中帮{hero}的神秘人，竟然是{lover}',
    '{lover}的抽屉里，放着{hero}多年前的照片',
    '{villain}冷笑：“你真以为当年救你的人是{lover}？”',
    '鉴定报告上的名字，让{hero}浑身发冷',
    '{mentor}对{hero}深深鞠躬：“我等您回来，等了整整二十年。”',
  ],
  情绪高点: [
    '{lover}红着眼抓住{hero}的手：“别走。”',
    '{hero}当众撕碎协议：“从今天起，我不欠任何人。”',
    '{hero}站在雨里，终于哭出了声',
    '{lover}挡在{hero}身前，替{hero}挨下那一刀',
  ],
  新秘密: [
    '{mentor}低声说：“{prop}，不是你母亲的。”',
    '旧照片背面写着一行字：“对不起，{hero}。”',
    '{hero}在{lover}的书房里发现一份尘封的卷宗',
    '{ally}欲言又止：“其实那天晚上，我看到了……”',
  ],
  付费卡点: [
    '{villain}举刀刺向{hero}——画面黑屏',
    '{lover}的订婚宴上，{hero}推门而入：“我反对！”',
    '{hero}即将说出真相时，一辆车疾驰而来',
    '{lover}终于开口：“{hero}，其实我是——”',
  ],
}

/** 非节点集的钩子轮换顺序：同一种钩子不连续出现 */
export const HOOK_ROTATION: HookType[] = ['悬念', '情绪高点', '新秘密', '反转', '悬念', '情绪高点']

/* ---------------------------------- 剧本 ---------------------------------- */

export type SceneType = 'confront' | 'romance' | 'intel' | 'scheme' | 'reveal' | 'crisis'

export interface Speech {
  who: Slot
  zh: string
  en: string
}

export interface ScenePool {
  actions: string[]
  exchanges: Speech[][]
  /** 本场结束后各角色的状态，写入状态库 */
  states: Partial<Record<Slot, string>>
}

export const SCENES: Record<SceneType, ScenePool> = {
  confront: {
    actions: [
      '△ {villain}端着酒杯走近，故意提高音量，周围的人纷纷看过来。',
      '△ {hero}站在原地没有退，指尖悄悄攥紧了{prop}。',
      '△ 众人窃窃私语，有人举起手机开始录像。',
      '△ {villain}的笑容僵在脸上，第一次露出慌乱。',
      '△ 空气安静得只剩下呼吸声。',
      '△ {hero}抬手，把一叠文件拍在桌上。',
    ],
    exchanges: [
      [
        { who: 'villain', zh: '哟，这不是被赶出去的{hero}吗？谁放你进来的？', en: "Well, well. Isn't it {hero}? Who let you back in?" },
        { who: 'hero', zh: '我来拿回属于我的东西。', en: "I'm here to take back what's mine." },
      ],
      [
        { who: 'villain', zh: '你现在一无所有，拿什么跟我斗？', en: 'You have nothing left. What makes you think you can fight me?' },
        { who: 'hero', zh: '一无所有的人，才最不怕输。', en: 'People with nothing left are the ones who aren’t afraid to lose.' },
      ],
      [
        { who: 'hero', zh: '当年的事，你真以为没人知道？', en: 'You really think no one knows what you did back then?' },
        { who: 'villain', zh: '（脸色一变）你在胡说什么？', en: '(face falling) What are you talking about?' },
        { who: 'hero', zh: '很快，所有人都会知道。', en: 'Soon, everyone will.' },
      ],
      [
        { who: 'villain', zh: '跪下道歉，我可以考虑放你一马。', en: "Kneel and apologize, and maybe I'll let this go." },
        { who: 'hero', zh: '该跪的人，不是我。', en: "I'm not the one who should be kneeling." },
      ],
      [
        { who: 'villain', zh: '别忘了，你只是个没人要的弃子。', en: "Don't forget—you're the one nobody wanted." },
        { who: 'hero', zh: '那你最好祈祷，弃子永远别翻身。', en: 'Then pray the one nobody wanted never rises.' },
      ],
      [
        { who: 'hero', zh: '你欠我的，今天连本带利还回来。', en: 'Everything you owe me—you pay it back today, with interest.' },
        { who: 'villain', zh: '（后退一步）你……你想干什么？', en: '(stepping back) What... what do you want?' },
      ],
    ],
    states: { hero: '与{villain}正面交锋，占了上风', villain: '当众受挫，怀恨在心' },
  },
  romance: {
    actions: [
      '△ {lover}一把扣住{hero}的手腕，把人拉到身前。',
      '△ 两人距离近得能听见彼此的心跳。',
      '△ {hero}别过脸，不让{lover}看见泛红的眼眶。',
      '△ 雨水顺着{lover}的发梢滴落，{lover}却一动不动。',
      '△ {lover}脱下外套，披在{hero}肩上。',
      '△ 沉默良久，{lover}的声音低了下去。',
    ],
    exchanges: [
      [
        { who: 'lover', zh: '这些年，你到底去了哪里？', en: 'Where have you been all these years?' },
        { who: 'hero', zh: '这跟你还有关系吗？', en: 'Does that still concern you?' },
      ],
      [
        { who: 'lover', zh: '当年的事，我可以解释。', en: 'What happened back then—I can explain.' },
        { who: 'hero', zh: '解释？在我最需要你的时候，你在哪？', en: 'Explain? Where were you when I needed you most?' },
      ],
      [
        { who: 'lover', zh: '别再一个人扛了，好吗？', en: 'Stop carrying everything alone. Please.' },
        { who: 'hero', zh: '（轻声）我早就习惯了。', en: "(softly) I'm used to it." },
      ],
      [
        { who: 'lover', zh: '离那些人远一点，他们会伤害你。', en: 'Stay away from those people. They will hurt you.' },
        { who: 'hero', zh: '最伤我的人，不就是你吗？', en: "Aren't you the one who hurt me the most?" },
      ],
      [
        { who: 'hero', zh: '你为什么要救我？', en: 'Why did you save me?' },
        { who: 'lover', zh: '因为我不能再失去你一次。', en: "Because I can't lose you again." },
      ],
      [
        { who: 'lover', zh: '我后悔了。', en: 'I regret it.' },
        { who: 'hero', zh: '后悔这两个字，太轻了。', en: 'Regret is too small a word for what you did.' },
      ],
    ],
    states: { hero: '与{lover}的心结有所松动', lover: '想挽回{hero}，但还没说出全部真相' },
  },
  intel: {
    actions: [
      '△ {ally}警惕地看了看门外，压低声音。',
      '△ {ally}把一叠照片摊在桌上。',
      '△ {hero}一张张翻过去，手指停在其中一张上。',
      '△ 窗外闪过一道黑影，{ally}立刻拉上窗帘。',
      '△ 电脑屏幕的蓝光映在{hero}脸上。',
    ],
    exchanges: [
      [
        { who: 'ally', zh: '我查到了，那天的事根本不是意外。', en: 'I found it. That day was no accident.' },
        { who: 'hero', zh: '是谁？', en: 'Who was it?' },
      ],
      [
        { who: 'ally', zh: '你确定要查下去？这会把你也卷进去。', en: "Are you sure you want to dig into this? You'll get dragged in too." },
        { who: 'hero', zh: '我已经没有退路了。', en: 'There is no way back for me now.' },
      ],
      [
        { who: 'hero', zh: '帮我盯紧{villain}，有任何动静马上告诉我。', en: 'Keep an eye on {villain}. Tell me the moment anything moves.' },
        { who: 'ally', zh: '放心，交给我。', en: 'Leave it to me.' },
      ],
      [
        { who: 'ally', zh: '{villain}最近频繁和一个陌生人见面。', en: '{villain} has been meeting a stranger a lot lately.' },
        { who: 'hero', zh: '看来，有人坐不住了。', en: "Looks like someone's getting nervous." },
      ],
      [
        { who: 'ally', zh: '不管发生什么，我都站在你这边。', en: "Whatever happens, I'm on your side." },
        { who: 'hero', zh: '（握住{ally}的手）谢谢你。', en: "(taking {ally}'s hand) Thank you." },
      ],
    ],
    states: { hero: '掌握了关于{villain}的新线索', ally: '在暗中替{hero}调查' },
  },
  scheme: {
    actions: [
      '△ 深夜，{villain}独自坐在昏暗的房间里，手机屏幕亮起。',
      '△ {villain}把一张照片丢进壁炉，看着它烧成灰烬。',
      '△ {villain}对着镜子整理衣领，眼神阴冷。',
      '△ 桌上摊着{hero}的资料，上面被红笔划了一个叉。',
    ],
    exchanges: [
      [{ who: 'villain', zh: '（打电话）{hero}回来了。按原计划行事，别留下任何痕迹。', en: '(on the phone) {hero} is back. Stick to the plan. Leave no trace.' }],
      [{ who: 'villain', zh: '（冷笑）{hero}，这一次我要你永远翻不了身。', en: "(sneering) This time, {hero}, you'll never get back up." }],
      [{ who: 'villain', zh: '（自言自语）当年的事绝不能被翻出来，绝不能。', en: '(to self) What happened back then must never come out. Never.' }],
      [{ who: 'villain', zh: '{lover}只能是我的，谁也抢不走。', en: '{lover} is mine. No one takes that from me.' }],
    ],
    states: { villain: '暗中布局，准备对{hero}下手' },
  },
  reveal: {
    actions: [
      '△ {mentor}打开一只落满灰尘的木匣。',
      '△ 烛光摇晃，墙上的旧画像忽明忽暗。',
      '△ {hero}盯着那件旧物，呼吸越来越急。',
      '△ {mentor}沉默许久，像是下定了某种决心。',
    ],
    exchanges: [
      [
        { who: 'mentor', zh: '有些事，是时候让你知道了。', en: "There are things it's time you knew." },
        { who: 'hero', zh: '您早就知道，对不对？', en: "You knew all along, didn't you?" },
      ],
      [
        { who: 'mentor', zh: '{prop}，从来不是普通的东西。', en: 'That {prop} was never an ordinary thing.' },
        { who: 'hero', zh: '那它到底是什么？', en: 'Then what is it?' },
      ],
      [
        { who: 'mentor', zh: '当年那场火，烧掉的不只是一座房子。', en: 'That fire years ago took more than a house.' },
        { who: 'hero', zh: '（声音发颤）我的家人……是被害死的？', en: '(voice shaking) My family... they were murdered?' },
      ],
      [
        { who: 'mentor', zh: '我沉默了二十年，就是在等你回来。', en: 'I kept silent for twenty years, waiting for you to come back.' },
        { who: 'hero', zh: '现在，我回来了。', en: "Well, now I'm back." },
      ],
    ],
    states: { hero: '得知了身世的部分真相', mentor: '已向{hero}吐露旧事' },
  },
  crisis: {
    actions: [
      '△ 一声巨响，大门被撞开。',
      '△ 火光冲天，人群四散奔逃。',
      '△ {villain}一把抓住{hero}，冰冷的刀锋抵上脖颈。',
      '△ {lover}冲进来，挡在{hero}身前。',
      '△ 警笛声由远及近。',
    ],
    exchanges: [
      [
        { who: 'villain', zh: '谁敢过来，我就杀了{hero}！', en: 'Take one more step and {hero} dies!' },
        { who: 'lover', zh: '放开{hero}，你要的我都给你。', en: "Let {hero} go. I'll give you anything you want." },
      ],
      [
        { who: 'hero', zh: '别管我，快走！', en: 'Forget about me—go!' },
        { who: 'lover', zh: '要走一起走。', en: 'We leave together, or not at all.' },
      ],
      [
        { who: 'lover', zh: '（护住{hero}）想动{hero}，先过我这一关。', en: '(shielding {hero}) You want {hero}? Go through me first.' },
        { who: 'villain', zh: '（咬牙）好，那你们就一起去死！', en: '(gritting teeth) Fine. Then you can both die!' },
      ],
      [
        { who: 'hero', zh: '{villain}，结束了。', en: "It's over, {villain}." },
        { who: 'villain', zh: '（狂笑）结束？游戏才刚刚开始！', en: '(laughing) Over? The game has only just begun!' },
      ],
    ],
    states: { hero: '身陷险境', lover: '为保护{hero}受了伤', villain: '孤注一掷' },
  },
}

/** 五段式各段的场景类型顺序 */
export const PHASE_SCENES: SceneType[][] = [
  ['confront', 'intel', 'scheme', 'romance', 'reveal'],
  ['confront', 'romance', 'intel', 'scheme', 'reveal'],
  ['reveal', 'romance', 'confront', 'scheme', 'intel'],
  ['crisis', 'intel', 'romance', 'scheme', 'confront'],
  ['confront', 'crisis', 'romance', 'reveal', 'intel'],
]

/** 伏笔埋设 / 回收时补的一句台词 */
export const PLANT_LINE: Speech = { who: 'hero', zh: '（低声）这到底是怎么回事……', en: '(under breath) What is going on...' }
export const PAYOFF_LINE: Speech = { who: 'hero', zh: '原来……一切早有预兆。', en: 'So... the signs were there all along.' }

/* ---------------------------------- 改写 ---------------------------------- */

/** 常见“AI 味”词：润色时删掉 */
export const AI_FILLERS = ['不禁', '不由得', '仿佛', '似乎', '一丝', '一抹', '淡淡的', '莫名的', '缓缓地', '微微地', '此时此刻', '心中暗想', '眼中闪过', '嘴角勾起', '某种程度上', '顿时']

export const EXPAND_SPEECH: { zh: string; en: string }[] = [
  { zh: '你听清楚了，我只说一遍。', en: "Listen carefully. I'll only say this once." },
  { zh: '这一次，我不会再退。', en: "This time, I won't back down." },
  { zh: '你最好想清楚后果。', en: 'You had better think about the consequences.' },
  { zh: '别逼我。', en: "Don't push me." },
  { zh: '我等这一天，等了太久。', en: "I've waited too long for this day." },
]

export const EXPAND_ACTION = [
  '镜头缓缓推近，定格在{hero}的眼睛上。',
  '四周一片死寂，只剩下钟表的滴答声。',
  '窗外雷声炸响，灯光闪了一下。',
  '所有人的目光都集中到这里。',
]

export const SYNONYMS: [string, string][] = [
  ['看着', '盯着'],
  ['马上', '立刻'],
  ['非常', '格外'],
  ['离开', '转身离开'],
  ['知道', '清楚'],
  ['害怕', '发怵'],
  ['为什么', '凭什么'],
  ['生气', '动了怒'],
  ['走近', '逼近'],
  ['说', '开口'],
]
