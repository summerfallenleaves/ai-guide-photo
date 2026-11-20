import type { PhotoMeta } from '@/domain/shared/exif';
import type { AdjustParams, CaptureResult } from '@/domain/shared/types';

/**
 * 把"刚刚拍下的这张"存在内存里,跨页面读取。
 *
 * 为什么不只用路由参数:file:// 地址经过 URL 编解码容易出岔子,
 * 一旦参数丢了,复盘页就只能显示一片黑。这里做双保险。
 */
export type LastCapture = {
  uri: string;
  saved: boolean;
  savedError?: string;
  /** 相机记录的光学参数,用于在复盘页展示 */
  meta?: PhotoMeta | null;
  /** 按下快门前 AI 最后给的一条建议(可能没有:断网/关闭自动分析) */
  lastSuggestion?: { headline: string; action: string } | null;
};

let last: LastCapture | null = null;

export function setLastCapture(next: LastCapture) {
  last = next;
}

export function getLastCapture(): LastCapture | null {
  return last;
}

/** 复盘页点「应用并重拍」时暂存,回到相机页消费一次 */
let pendingAdjust: AdjustParams | null = null;

export function setPendingAdjust(next: AdjustParams | null) {
  pendingAdjust = next;
}

export function takePendingAdjust(): AdjustParams | null {
  const value = pendingAdjust;
  pendingAdjust = null;
  return value;
}

/** 复盘页的点评状态:照片先到,点评后到 */
export type ReviewState =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'done'; result: CaptureResult }
  | { status: 'failed'; error: string };

let reviewState: ReviewState = { status: 'idle' };
const listeners = new Set<() => void>();

export function getReviewState(): ReviewState {
  return reviewState;
}

export function setReviewState(next: ReviewState) {
  reviewState = next;
  listeners.forEach((notify) => notify());
}

export function subscribeReviewState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
