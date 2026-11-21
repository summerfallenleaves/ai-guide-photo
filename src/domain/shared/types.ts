export type Dim = 'composition' | 'light' | 'pose' | 'background' | 'settings';

export type Metrics = {
  mean: number;
  contrast: number;
  darkPct: number;
  brightPct: number;
  centerMean: number;
  verdict: 'ok' | 'tooDark' | 'tooBright' | 'backlight' | 'flat';
};

export type SuggestionSource = 'deepseek' | 'local';

export type LiveSuggestion = {
  mode: 'live';
  dim: Dim;
  dimLabel: string;
  headline: string;
  action: string;
  reason: string;
  confidence: number;
  source: SuggestionSource;
  metrics?: Metrics | null;
  /**
   * 当前画面是否"已经可以拍了"。
   * **只是提示**:为 false 不代表不能拍,拿不到建议时也是 false。
   */
  readyToShoot: boolean;
  /**
   * 模型给出的可直接下发的参数(只有曝光/白平衡/对焦确实有问题时才给)。
   * 是否真的应用到相机由 `domain/guidance/param-policy` 的护栏决定。
   */
  params?: AdjustParams | null;
};

/** AI 给出的可执行拍摄参数(全部可选,只给需要改的项) */
export type AdjustParams = {
  iso?: number;
  /** "1/250" 或 "0.5" 这样的快门字符串 */
  shutter?: string;
  /** 色温 K */
  wb?: number;
  /** 对焦距离,单位米 */
  focusMeters?: number;
};

/** 相机当前参数的快照(调参护栏用它判断"变化够不够大") */
export type CameraParamsSnapshot = {
  manual: boolean;
  iso: number;
  exposureNs: number;
  kelvin: number;
  focusDiopters: number;
} | null;

/** 点评结论:保持 / 微调 / 重拍 */
export type CaptureVerdict = 'keep' | 'tweak' | 'reshoot';

export type CaptureResult = {
  mode: 'capture';
  score: number;
  headline: string;
  dim: Dim;
  dimLabel: string;
  /** 这张照片做得好的地方(1 条,用于平衡点评) */
  strengths: string[];
  improvements: string[];
  /** 结论:决定 UI 是否显示"没什么要改的" */
  verdict: CaptureVerdict;
  /** 建议应用的拍摄参数,没有就不给 */
  params?: AdjustParams | null;
  confidence: number;
  source: SuggestionSource;
  metrics?: Metrics | null;
};

export type AnalysisResult = LiveSuggestion | CaptureResult;

/** 一次分析的结果:取景建议或拍后点评 */
export type AnalyzeOutcome = LiveSuggestion | CaptureResult;

/** 相机硬件可调范围,用来约束模型给出的参数 */
export type CameraLimits = {
  isoMin: number;
  isoMax: number;
  exposureMinNs: number;
  exposureMaxNs: number;
};
