/**
 * JS ↔ 原生 的契约测试。
 *
 * 这组测试的目的是:**把相机模块重构成 Expo Module 之后,JS 侧调用面必须一字不差**。
 * 方法名、参数顺序、事件名、降级行为,任何一项变了这里都会红。
 */

type CameraModule = typeof import('@/infra/camera/native-camera2');

type NativeMock = {
  takePicture: jest.Mock;
  grabPreview: jest.Mock;
  setManual: jest.Mock;
  setZoom: jest.Mock;
  setFlashMode: jest.Mock;
  setExposureCompensation: jest.Mock;
  focusAt: jest.Mock;
  getCapabilities: jest.Mock;
  addListener: jest.Mock;
  __emit: (event: string, payload: unknown) => void;
};

let mockNative: NativeMock | null = null;

jest.mock('expo', () => ({
  requireOptionalNativeModule: () => mockNative,
  requireNativeView: () => 'MockCamera2Preview',
}));

function createNativeMock(): NativeMock {
  const listeners: Record<string, ((payload: unknown) => void)[]> = {};
  return {
    takePicture: jest.fn(async () => ({ path: '/data/cache/camera2-1.jpg', rotation: 90 })),
    grabPreview: jest.fn(async () => 'BASE64DATA'),
    setManual: jest.fn(),
    setZoom: jest.fn(),
    setFlashMode: jest.fn(),
    setExposureCompensation: jest.fn(),
    focusAt: jest.fn(),
    getCapabilities: jest.fn(async () => ({
      isoMin: 100,
      isoMax: 800,
      exposureMinNs: 26000,
      exposureMaxNs: 1000000000,
      minFocusDistance: 10,
      focalLengthMm: 6.06,
      aperture: 1.6,
      colorTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    })),
    addListener: jest.fn((event: string, cb: (payload: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
      return {
        remove: () => {
          listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
        },
      };
    }),
    __emit: (event: string, payload: unknown) => {
      (listeners[event] || []).forEach((fn) => fn(payload));
    },
  };
}

function loadModule(): { mod: CameraModule; native: NativeMock } {
  const native = createNativeMock();
  mockNative = native;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@/infra/camera/native-camera2') as CameraModule;
  return { mod, native };
}

function loadWithoutNative(): CameraModule {
  mockNative = null;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/infra/camera/native-camera2') as CameraModule;
}

describe('原生模块存在时', () => {
  it('能检测到原生相机可用', () => {
    expect(loadModule().mod.isNativeCameraAvailable()).toBe(true);
  });

  it('takePicture 返回路径与 JPEG 方向角', async () => {
    const { mod } = loadModule();
    await expect(mod.takePicture()).resolves.toEqual({
      path: '/data/cache/camera2-1.jpg',
      rotation: 90,
    });
  });

  it('grabPreview 按 (宽度, 质量) 的顺序传参', async () => {
    const { mod, native } = loadModule();
    await expect(mod.grabPreview(1024, 60)).resolves.toBe('BASE64DATA');
    expect(native.grabPreview).toHaveBeenCalledWith(1024, 60);
  });

  it('grabPreview 有默认参数(宽 1024 / 质量 60)', async () => {
    const { mod, native } = loadModule();
    await mod.grabPreview();
    expect(native.grabPreview).toHaveBeenCalledWith(1024, 60);
  });

  it('setManual 把对象展开成 4 个位置参数', () => {
    const { mod, native } = loadModule();
    mod.setManual({ iso: 200, exposureNs: 4_000_000, focusDiopters: 1, kelvin: 5000 });
    expect(native.setManual).toHaveBeenCalledWith(200, 4_000_000, 1, 5000);
  });

  it('setManual 只传部分轴时,其余必须是 null(表示回自动)', () => {
    const { mod, native } = loadModule();
    mod.setManual({ iso: 400 });
    expect(native.setManual).toHaveBeenCalledWith(400, null, null, null);
  });

  it('setManual 空对象 = 全部回自动', () => {
    const { mod, native } = loadModule();
    mod.setManual({});
    expect(native.setManual).toHaveBeenCalledWith(null, null, null, null);
  });

  it('getCapabilities 返回原生给的对象', async () => {
    const { mod } = loadModule();
    await expect(mod.getCapabilities()).resolves.toMatchObject({ isoMin: 100, isoMax: 800, aperture: 1.6 });
  });
});

describe('取景控制(缩放/闪光灯/曝光补偿/对焦)', () => {
  it('setZoom 直接传倍数', () => {
    const { mod, native } = loadModule();
    mod.setZoom(2.5);
    expect(native.setZoom).toHaveBeenCalledWith(2.5);
  });

  it('setFlashMode 传 off/auto/torch', () => {
    const { mod, native } = loadModule();
    mod.setFlashMode('torch');
    expect(native.setFlashMode).toHaveBeenCalledWith('torch');
  });

  it('setExposureCompensation 传的是 EV 档数', () => {
    const { mod, native } = loadModule();
    mod.setExposureCompensation(-3);
    expect(native.setExposureCompensation).toHaveBeenCalledWith(-3);
  });

  it('focusAt 传归一化坐标', () => {
    const { mod, native } = loadModule();
    mod.focusAt(0.25, 0.75);
    expect(native.focusAt).toHaveBeenCalledWith(0.25, 0.75);
  });

  it('原生缺失时,这四个方法都静默不抛错', () => {
    const mod = loadWithoutNative();
    expect(() => mod.setZoom(2)).not.toThrow();
    expect(() => mod.setFlashMode('auto')).not.toThrow();
    expect(() => mod.setExposureCompensation(1)).not.toThrow();
    expect(() => mod.focusAt(0.5, 0.5)).not.toThrow();
  });
});

describe('事件订阅', () => {
  it('addParamsListener 订阅 onParams 并能收到载荷', () => {
    const { mod, native } = loadModule();
    const received: unknown[] = [];
    const off = mod.addParamsListener((p) => received.push(p));

    const payload = { iso: 320, exposureNs: 1e6, focusDiopters: 0, kelvin: 0, manual: false };
    native.__emit('onParams', payload);

    expect(received).toEqual([payload]);
    off();
    native.__emit('onParams', payload);
    expect(received).toHaveLength(1);
  });

  it('addErrorListener 把 {message} 解包成字符串', () => {
    const { mod, native } = loadModule();
    const received: string[] = [];
    const off = mod.addErrorListener((m) => received.push(m));
    native.__emit('onError', { message: '相机被占用' });
    expect(received).toEqual(['相机被占用']);
    off();
  });

  it('addErrorListener 在载荷缺失时给出兜底文案', () => {
    const { mod, native } = loadModule();
    const received: string[] = [];
    mod.addErrorListener((m) => received.push(m));
    native.__emit('onError', undefined);
    expect(received).toEqual(['相机出错了']);
  });

  it('addReadyListener 订阅 onReady', () => {
    const { mod, native } = loadModule();
    const hits: number[] = [];
    const off = mod.addReadyListener(() => hits.push(1));
    native.__emit('onReady', {});
    expect(hits).toHaveLength(1);
    off();
  });
});

describe('原生模块不存在时(如 Expo Go)', () => {
  it('isNativeCameraAvailable 返回 false', () => {
    expect(loadWithoutNative().isNativeCameraAvailable()).toBe(false);
  });

  it('takePicture 抛出可读错误,而不是崩在 undefined 上', async () => {
    await expect(loadWithoutNative().takePicture()).rejects.toThrow('原生相机模块');
  });

  it('grabPreview 同样抛出可读错误', async () => {
    await expect(loadWithoutNative().grabPreview()).rejects.toThrow('原生相机模块');
  });

  it('setManual 静默无操作,不抛错', () => {
    expect(() => loadWithoutNative().setManual({ iso: 100 })).not.toThrow();
  });

  it('getCapabilities 返回 null', async () => {
    await expect(loadWithoutNative().getCapabilities()).resolves.toBeNull();
  });

  it('订阅函数返回空的取消函数,不抛错', () => {
    const mod = loadWithoutNative();
    expect(() => mod.addParamsListener(() => {})()).not.toThrow();
    expect(() => mod.addErrorListener(() => {})()).not.toThrow();
    expect(() => mod.addReadyListener(() => {})()).not.toThrow();
  });
});

describe('快门字符串互转', () => {
  const cases: [string, number][] = [
    ['1/250', 4_000_000],
    ['1/1000', 1_000_000],
    ['1/60', 16_666_666.6667],
    ['0.5', 500_000_000],
    ['2', 2_000_000_000],
    ['1/250s', 4_000_000],
  ];

  it.each(cases)('parseShutterToNs(%s) ≈ %d ns', (text, expected) => {
    expect(loadModule().mod.parseShutterToNs(text)).toBeCloseTo(expected, 3);
  });

  it('无法解析时返回 undefined', () => {
    const { mod } = loadModule();
    expect(mod.parseShutterToNs('abc')).toBeUndefined();
    expect(mod.parseShutterToNs('0')).toBeUndefined();
  });

  it('formatShutterNs 输出人可读的写法', () => {
    const { mod } = loadModule();
    expect(mod.formatShutterNs(4_000_000)).toBe('1/250');
    expect(mod.formatShutterNs(1_000_000)).toBe('1/1000');
    expect(mod.formatShutterNs(1_500_000_000)).toBe('1.5s');
    expect(mod.formatShutterNs(0)).toBe('—');
  });

  it('parse 和 format 能互相还原', () => {
    const { mod } = loadModule();
    expect(mod.formatShutterNs(mod.parseShutterToNs('1/250')!)).toBe('1/250');
  });
});
