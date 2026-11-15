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

export type CaptureResult = {
  mode: 'capture';
  score: number;
  headline: string;
  dim: Dim;
  dimLabel: string;
  improvements: string[];
  confidence: number;
  source: SuggestionSource;
  metrics?: Metrics | null;
};

export type AnalysisResult = LiveSuggestion | CaptureResult;
