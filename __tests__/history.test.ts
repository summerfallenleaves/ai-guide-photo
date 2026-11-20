/**
 * 拍照历史的保留策略测试。
 *
 * 重点:按自然日保留最近 7 天、过期时连带删除照片文件、重启时把
 * "点评中" 的残留记录标记为失败。
 */

const DAY = 24 * 60 * 60 * 1000;

type FsSpy = { copied: string[]; deleted: string[] };
let mockFsSpy: FsSpy;

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((p) => (typeof p === 'string' ? p : (p as { uri?: string })?.uri ?? ''))
        .join('/');
    }
    get exists() {
      return true;
    }
    async copy(dest: MockFile) {
      mockFsSpy.copied.push(dest.uri);
    }
    delete() {
      mockFsSpy.deleted.push(this.uri);
    }
  }
  class MockDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((p) => (typeof p === 'string' ? p : (p as { uri?: string })?.uri ?? ''))
        .join('/');
    }
    get exists() {
      return true;
    }
    create() {}
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: { uri: 'file:///doc' } },
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store[k] = v;
      }),
      removeItem: jest.fn(async (k: string) => {
        delete store[k];
      }),
      __reset: () => {
        store = {};
      },
      __seed: (k: string, v: string) => {
        store[k] = v;
      },
    },
  };
});

type HistoryModule = typeof import('@/data/history');
type Storage = { __reset: () => void; __seed: (k: string, v: string) => void };

function loadHistory(seed?: unknown[]): HistoryModule {
  mockFsSpy = { copied: [], deleted: [] };
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const storage = require('@react-native-async-storage/async-storage').default as Storage;
  storage.__reset();
  if (seed) storage.__seed('history.v1', JSON.stringify(seed));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/data/history') as HistoryModule;
}

function entry(id: string, ageMs = 0, status: 'analyzing' | 'done' | 'failed' = 'done') {
  return {
    id,
    uri: `file:///doc/history/${id}.jpg`,
    createdAt: Date.now() - ageMs,
    savedToAlbum: true,
    meta: null,
    status,
  };
}

describe('加载', () => {
  it('空存储时不报错,列表为空', async () => {
    const h = loadHistory();
    await h.loadHistory();
    expect(h.getHistory()).toEqual([]);
  });

  it('读取已有记录', async () => {
    const h = loadHistory([entry('a')]);
    await h.loadHistory();
    expect(h.getHistory()).toHaveLength(1);
    expect(h.getHistory()[0].id).toBe('a');
  });

  it('把"点评中"的残留记录标记为失败(避免永远转圈)', async () => {
    const h = loadHistory([entry('a', 0, 'analyzing')]);
    await h.loadHistory();
    expect(h.getHistory()[0].status).toBe('failed');
    expect(h.getHistory()[0].error).toContain('没有完成');
  });
});

describe('保留 7 天', () => {
  it('6 天前的记录保留', async () => {
    const h = loadHistory([entry('old', 6 * DAY)]);
    await h.loadHistory();
    expect(h.getHistory()).toHaveLength(1);
  });

  it('8 天前的记录被清掉,并且删除了照片文件', async () => {
    const h = loadHistory([entry('old', 8 * DAY), entry('new')]);
    await h.loadHistory();
    expect(h.getHistory().map((e) => e.id)).toEqual(['new']);
    expect(mockFsSpy.deleted).toContain('file:///doc/history/old.jpg');
  });

  it('新增记录时也会顺带清理过期项', async () => {
    const h = loadHistory([entry('old', 10 * DAY)]);
    await h.loadHistory();
    h.addHistoryEntry(entry('fresh'));
    const ids = h.getHistory().map((e) => e.id);
    expect(ids).toContain('fresh');
    expect(ids).not.toContain('old');
  });
});

describe('增删', () => {
  it('新增的记录排在最前面', async () => {
    const h = loadHistory([entry('a')]);
    await h.loadHistory();
    h.addHistoryEntry(entry('b'));
    expect(h.getHistory().map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('更新指定记录(点评结果回填)', async () => {
    const h = loadHistory([entry('a', 0, 'analyzing')]);
    await h.loadHistory();
    h.updateHistoryEntry('a', { status: 'done' });
    expect(h.getHistory()[0].status).toBe('done');
  });

  it('删除记录时同时删除照片文件', async () => {
    const h = loadHistory([entry('a')]);
    await h.loadHistory();
    h.removeHistoryEntry('a');
    expect(h.getHistory()).toHaveLength(0);
    expect(mockFsSpy.deleted).toContain('file:///doc/history/a.jpg');
  });

  it('清空会删除所有照片文件', async () => {
    const h = loadHistory([entry('a'), entry('b')]);
    await h.loadHistory();
    h.clearHistory();
    expect(h.getHistory()).toHaveLength(0);
    expect(mockFsSpy.deleted).toHaveLength(2);
  });
});

describe('持久化照片', () => {
  it('persistPhoto 复制到文档目录并返回新地址', async () => {
    const h = loadHistory();
    await h.loadHistory();
    const uri = await h.persistPhoto('file:///cache/x.jpg', 'id1');
    expect(mockFsSpy.copied.length).toBe(1);
    expect(uri).toContain('id1.jpg');
  });
});
