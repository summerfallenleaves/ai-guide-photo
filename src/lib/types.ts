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

export type CaptureResult = {
  mode: 'capture';
  score: number;
  headline: string;
  dim: Dim;
  dimLabel: string;
  improvements: string[];
  /** 建议应用的拍摄参数,没有就不给 */
  params?: AdjustParams | null;
  confidence: number;
  source: SuggestionSource;
  metrics?: Metrics | null;
};

export type AnalysisResult = LiveSuggestion | CaptureResult;
