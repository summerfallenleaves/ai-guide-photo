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
  payload: string;
};

let last: LastCapture | null = null;

export function setLastCapture(next: LastCapture) {
  last = next;
}

export function getLastCapture(): LastCapture | null {
  return last;
}
