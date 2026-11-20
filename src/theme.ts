/**
 * 设计 token —— 全项目唯一的视觉事实来源。
 *
 * 规则:
 * - 颜色 / 字号 / 间距 / 圆角 / 动效**一律从这里取**,页面里不写字面量
 * - 一次性的光学微调(比如图标偏移 1px)可以留在原地,但要写注释
 * - 新增 token 前先确认它真的会被用到第二次
 *
 * 这个 App 是**固定的深色相机界面**(全屏预览 + 半透明浮层),
 * 所以不用平台语义色,直接用一套手调的暗色令牌。
 */

export const palette = {
  /** 页面底色(相机页是纯黑,其他页面用 bgElevated) */
  bg: '#000000',
  bgElevated: '#0A0A0C',

  /** 浮层卡片 */
  card: 'rgba(20,20,24,0.82)',
  cardStrong: 'rgba(28,28,34,0.92)',

  /** 描边:常规 1px 与发丝线 */
  border: 'rgba(255,255,255,0.14)',
  hairline: 'rgba(255,255,255,0.08)',

  /** 半透明填充(按钮底、缩略图占位) */
  fillSubtle: 'rgba(255,255,255,0.05)',
  fill: 'rgba(255,255,255,0.10)',
  fillStrong: 'rgba(255,255,255,0.25)',

  /** 浮层控件背后的压暗底 */
  scrim: 'rgba(0,0,0,0.35)',
  /** 复盘页照片背后的深色底 */
  scrimStrong: 'rgba(10,10,12,0.55)',
  /** 实心面板(复盘信息栏) */
  surface: '#111114',

  /** 文字 */
  text: '#FFFFFF',
  textDim: 'rgba(255,255,255,0.58)',
  textFaint: 'rgba(255,255,255,0.34)',
  /** 比正文略淡、但仍需高可读性(实心面板上的文字) */
  textSoft: 'rgba(255,255,255,0.82)',

  /** 强调色及其派生 */
  accent: '#5BC8FF',
  accentSoft: 'rgba(91,200,255,0.16)',
  accentBorder: 'rgba(91,200,255,0.45)',
  accentStrong: 'rgba(91,200,255,0.9)',
  /** 强调色上的文字(深色,保证对比度) */
  onAccent: '#00131F',

  /** 成功 */
  good: '#4ADE80',
  goodSoft: 'rgba(74,222,128,0.14)',
  goodBorder: 'rgba(74,222,128,0.35)',
  goodStrong: 'rgba(74,222,128,0.9)',
  onGood: '#04240F',

  /** 警告 / 危险 */
  warn: '#FBBF24',
  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.14)',

  /** 快门环这类需要高亮白的地方 */
  ring: 'rgba(255,255,255,0.9)',

  /**
   * 取景网格线。单独留两个档位是因为别处没有合适的值:
   * 亮线太淡在亮背景(白墙、天空)看不见,太亮又抢视线;
   * 所以要配一层暗色描边,让它在任何画面上都可见。
   */
  gridLine: 'rgba(255,255,255,0.55)',
  gridHalo: 'rgba(0,0,0,0.38)',
} as const;

/**
 * 间距。基于 4 点栅格;6 和 10 是从现有界面里提炼的高频值,单独留成一步,
 * 避免为了"对齐栅格"把已经很紧的芯片内边距改得不伦不类。
 */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
  xxxl: 24,
  huge: 32,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
} as const;

export const weight = {
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

/**
 * 文字层级。字号来自现有界面的高频值(15 / 13 / 12.5 / 11),
 * 零散的 10.5 / 11.5 / 12 / 13.5 / 14 / 17 / 18 收敛到最近的一档。
 */
export const type = {
  /** 极小标注:参数行、调试信息 */
  overline: { fontSize: 10, fontWeight: weight.bold, color: palette.textFaint },
  /** 说明文字、时间戳 */
  caption: { fontSize: 11, fontWeight: weight.medium, color: palette.textFaint },
  /** 次要正文 */
  subhead: { fontSize: 12.5, fontWeight: weight.medium, color: palette.textDim },
  /** 标签、按钮文字 */
  callout: { fontSize: 13, fontWeight: weight.semibold, color: palette.text },
  /** 默认正文 */
  body: { fontSize: 15, fontWeight: weight.medium, color: palette.text },
  /** 卡片标题 */
  headline: { fontSize: 16, fontWeight: weight.bold, color: palette.text },
  /** 页面标题 */
  title: { fontSize: 19, fontWeight: weight.bold, color: palette.text },
  /** 大号数字(评分、参数读数) */
  metric: { fontSize: 22, fontWeight: weight.heavy, color: palette.text },
  /** 评分环里的主数字 */
  display: { fontSize: 26, fontWeight: weight.heavy, color: palette.text },
} as const;

/** 等宽数字,避免读数跳动时宽度抖动 */
export const tabularNums = { fontVariant: ['tabular-nums'] } as const;

/** 动效时长(毫秒)。用 react-native 的 Animated 时直接取这里 */
export const motion = {
  /** 按压、开关反馈 */
  fast: 150,
  /** 元素进出 */
  base: 250,
  /** 大面积:面板、页面切换 */
  slow: 400,
} as const;
