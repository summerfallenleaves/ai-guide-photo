/**
 * 场景知识:取景建议与拍后点评的共同参照。
 *
 * 「建议没参照」的根源是 prompt 里没有"这个场景的好照片长什么样"。
 * 这里按场景给出四块内容,取景侧用 rubric + priority + examples,
 * 点评侧用 scoring(参考图在 scene-refs.ts)。
 *
 * 全部是纯数据 + 纯函数,方便单测"只拼当前场景、不泄漏其他场景"。
 */

import type { SceneId } from '@/domain/shared/types';

export type SceneExample = {
  /** 画面描述:模型看到的典型情况 */
  see: string;
  /** 对应的建议:措辞故意各不相同,降低照抄概率 */
  advise: string;
};

export type SceneGuide = {
  id: SceneId;
  label: string;
  /** 这个场景里"好照片"的标准,给模型当标尺 */
  rubric: string[];
  /** 判断优先级:排在前面的先成为"第一条建议" */
  priority: string[];
  /** 文本 few-shot(取景用) */
  examples: SceneExample[];
  /** 点评的分数锚点,按场景替换通用描述 */
  scoring: { high: string; mid: string; low: string };
};

const OTHER: SceneGuide = {
  id: 'other',
  label: '其他',
  rubric: [
    '主体清楚,能一眼看出想拍什么',
    '画面里没有明显分散注意力的东西',
    '不糊、不过曝、不过暗',
  ],
  priority: ['主体是否清楚', '有没有抢眼的杂物', '曝光是否合适', '构图是否偏'],
  examples: [
    { see: '画面杂乱,看不出重点', advise: '靠近一点,让想拍的东西占满中间' },
    { see: '主体很小,四周空', advise: '往前走两步,或者把镜头稍微朝下' },
  ],
  scoring: {
    high: '主体明确,画面干净,曝光合适',
    mid: '能看出主题,但有杂物或曝光偏了一档',
    low: '看不出想拍什么,或者糊了、过曝、过暗',
  },
};

const PORTRAIT: SceneGuide = {
  id: 'portrait',
  label: '人像',
  rubric: [
    '人物占画面 1/3 到 1/2,眼睛大致在三分线附近',
    '背景干净或明显虚化,没有比脸更抢眼的东西',
    '光从侧前方来,脸上没有大块阴影或油光',
    '人物不要被切在关节上(手腕、膝盖、脚踝)',
  ],
  priority: ['主体与背景的分离', '脸部的受光', '人物的位置与裁切', '色彩与肤色', '参数(ISO/快门)'],
  examples: [
    { see: '半身人像,身后是杂乱书架', advise: '往左半步,让白墙做背景' },
    { see: '人脸偏暗,背后窗户很亮', advise: '转过身面向窗户,让光落在脸上' },
    { see: '头顶被切掉一截', advise: '往后退半步,把头顶留出来' },
  ],
  scoring: {
    high: '眼神有光、背景干净、人物位置舒服,肤色自然',
    mid: '人清楚但背景抢戏,或光线平、脸上有阴影',
    low: '主体不突出,严重逆光或大阴影,人物被裁在关节处',
  },
};

const LANDSCAPE: SceneGuide = {
  id: 'landscape',
  label: '风光',
  rubric: [
    '地平线水平,而且不要正好在画面正中(放上三分之一或下三分之一)',
    '有前景、中景、远景的层次,不是一片平的',
    '天空占多少取决于它好不好看:没内容就少留',
    '避开电线、栏杆、路人这类破坏画面的元素',
  ],
  priority: ['地平线是否水平', '画面层次(前中远景)', '天空与地面的比例', '光线方向', '曝光'],
  examples: [
    { see: '地平线明显倾斜', advise: '把手机端平,让地平线贴着网格横线' },
    { see: '天空占了大半张、云很少', advise: '镜头往下压一点,让地面占三分之二' },
    { see: '远处很漂亮,但近处一片空白', advise: '把镜头往下移,带一点近处的枝条或石阶做前景' },
  ],
  scoring: {
    high: '地平线平、有层次、光线有方向感,画面不杂乱',
    mid: '景色不错但构图平,或者天空/地面比例失衡',
    low: '地平线歪、画面没有重点,或者被杂物挡住',
  },
};

const FOOD: SceneGuide = {
  id: 'food',
  label: '美食',
  rubric: [
    '食物占画面主体,盘子边缘不要被硬切',
    '光源从侧面或斜后方来,让食物质感(油光、热气)显出来',
    '桌面杂物移出画面,或者只留一两件当陪衬',
    '接近 45° 或平视角度,避免正上方拍成"地图"',
  ],
  priority: ['食物的受光与质感', '桌面的干净程度', '拍摄角度', '主体占比', '参数'],
  examples: [
    { see: '从正上方俯拍,影子很硬', advise: '把手机放低到 45 度,让光从侧面打过来' },
    { see: '盘子边上有一堆纸巾和筷子', advise: '把纸巾拿走,只留一副筷子当陪衬' },
    { see: '食物偏暗、看不出油光', advise: '往窗边挪一下,让光从侧后方照到食物' },
  ],
  scoring: {
    high: '质感清楚(油光/热气/层次),桌面干净,角度自然',
    mid: '食物能看清但有杂物,或光线平、颜色发灰',
    low: '看不太出是什么,或者画面被杂物占满',
  },
};

const STREET: SceneGuide = {
  id: 'street',
  label: '街拍',
  rubric: [
    '画面里有一个明确的主体(人、招牌、光影)',
    '背景元素不要互相打架,线条尽量简洁',
    '抓拍时注意人物完整,不要切头切脚',
    '逆光或硬光下注意别让人脸全黑',
  ],
  priority: ['主体是否明确', '背景是否干扰', '人物是否完整', '光线', '时机'],
  examples: [
    { see: '路人在画面边缘,只拍到半个人', advise: '等下一个路人走到画面中间再按' },
    { see: '主体和背后的招牌重叠成一团', advise: '往右走两步,让主体和背景分开' },
    { see: '逆光下人物全黑', advise: '换个角度,让光从侧面或背后斜着来' },
  ],
  scoring: {
    high: '主体明确、时机好、背景不乱',
    mid: '有内容但背景干扰大,或者主体被裁切',
    low: '画面杂乱说不出重点,或者主体全黑/全虚',
  },
};

export const SCENES: Record<SceneId, SceneGuide> = {
  other: OTHER,
  portrait: PORTRAIT,
  landscape: LANDSCAPE,
  food: FOOD,
  street: STREET,
};

/** 卡片上的选择顺序:常用的放前面 */
export const SCENE_ORDER: SceneId[] = ['portrait', 'landscape', 'food', 'street', 'other'];

export function getScene(id: SceneId | null | undefined): SceneGuide {
  return SCENES[id ?? 'other'] ?? OTHER;
}
