import { isAlbumAssetGone, needsAlbumCheck } from '@/data/history';
import type { HistoryEntry } from '@/data/history';

const entry = (patch: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: '1',
  uri: 'file:///history/1.jpg',
  createdAt: Date.now(),
  savedToAlbum: true,
  mediaId: 'media-1',
  meta: null,
  status: 'done',
  ...patch,
});

describe('相册对账 · 判定', () => {
  it('查询返回空 = 已删除', () => {
    expect(isAlbumAssetGone(null)).toBe(true);
    expect(isAlbumAssetGone(undefined)).toBe(true);
  });

  it('拿不到 id 也算已删除', () => {
    expect(isAlbumAssetGone({})).toBe(true);
  });

  it('正常存在的条目不当作删除', () => {
    expect(isAlbumAssetGone({ id: 'media-1' })).toBe(false);
  });
});

describe('相册对账 · 哪些条目要查', () => {
  it('存过相册且有 mediaId 的才查', () => {
    expect(needsAlbumCheck(entry())).toBe(true);
  });

  it('没存相册的条目永远不查(副本是唯一原件)', () => {
    expect(needsAlbumCheck(entry({ savedToAlbum: false }))).toBe(false);
  });

  it('没有 mediaId 的老记录不查', () => {
    expect(needsAlbumCheck(entry({ mediaId: undefined }))).toBe(false);
  });

  it('已经标记过缺失的不重复查', () => {
    expect(needsAlbumCheck(entry({ imageGone: true }))).toBe(false);
  });
});
