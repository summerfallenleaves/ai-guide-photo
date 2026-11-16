import type { PhotoMeta } from './exif';
import type { CaptureResult } from './types';

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
};

let last: LastCapture | null = null;

export function setLastCapture(next: LastCapture) {
  last = next;
}

export function getLastCapture(): LastCapture | null {
  return last;
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
