/**
 * JS ↔ 原生 的契约测试。
 *
 * 这组测试的目的是:**把相机模块重构成 Expo Module 之后,JS 侧调用面必须一字不差**。
 * 方法名、参数顺序、事件名、降级行为,任何一项变了这里都会红。
 */

type CameraModule = typeof import('../src/lib/native-camera2');

const EVENT_PARAMS = 'Camera2Params';
const EVENT_ERROR = 'Camera2Error';
const EVENT_READY = 'Camera2Ready';

function createNativeMock() {
  return {
    takePicture: jest.fn(async () => '/data/cache/camera2-1.jpg'),
    grabPreview: jest.fn(async () => 'BASE64DATA'),
    setManual: jest.fn(),
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
  };
}

/** 该模块在 import 时就读取 NativeModules,所以必须每次重新加载 */
function loadModule(setup?: (native: ReturnType<typeof createNativeMock> | undefined) => void): CameraModule {
  let mod: CameraModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native');
    const native = createNativeMock();
    NativeModules.Camera2Module = native;
    setup?.(native);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../src/lib/native-camera2') as CameraModule;
  });
  return mod!;
}

function loadWithoutNative(): CameraModule {
  let mod: CameraModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native');
    delete NativeModules.Camera2Module;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../src/lib/native-camera2') as CameraModule;
  });
  return mod!;
}

describe('原生模块存在时', () => {
  it('能检测到原生相机可用', () => {
    const mod = loadModule();
    expect(mod.isNativeCameraAvailable()).toBe(true);
  });

  it('takePicture 原样返回文件路径', async () => {
    const mod = loadModule();
    await expect(mod.takePicture()).resolves.toBe('/data/cache/camera2-1.jpg');
  });

  it('grabPreview 按 (宽度, 质量) 的顺序传参', async () => {
    let captured: ReturnType<typeof createNativeMock> | undefined;
    const mod = loadModule((n) => {
      captured = n;
    });
    await expect(mod.grabPreview(1024, 60)).resolves.toBe('BASE64DATA');
    expect(captured!.grabPreview).toHaveBeenCalledWith(1024, 60);
  });

  it('grabPreview 有默认参数(宽 1024 / 质量 60)', async () => {
    let captured: ReturnType<typeof createNativeMock> | undefined;
    const mod = loadModule((n) => {
      captured = n;
    });
    await mod.grabPreview();
    expect(captured!.grabPreview).toHaveBeenCalledWith(1024, 60);
  });

  it('setManual 把对象展开成 4 个位置参数', () => {
    let captured: ReturnType<typeof createNativeMock> | undefined;
    const mod = loadModule((n) => {
      captured = n;
    });
    mod.setManual({ iso: 200, exposureNs: 4_000_000, focusDiopters: 1, kelvin: 5000 });
    expect(captured!.setManual).toHaveBeenCalledWith(200, 4_000_000, 1, 5000);
  });

  it('setManual 只传部分轴时,其余必须是 null(表示回自动)', () => {
    let captured: ReturnType<typeof createNativeMock> | undefined;
    const mod = loadModule((n) => {
      captured = n;
    });
    mod.setManual({ iso: 400 });
    expect(captured!.setManual).toHaveBeenCalledWith(400, null, null, null);
  });

  it('setManual 空对象 = 全部回自动', () => {
    let captured: ReturnType<typeof createNativeMock> | undefined;
    const mod = loadModule((n) => {
      captured = n;
    });
    mod.setManual({});
    expect(captured!.setManual).toHaveBeenCalledWith(null, null, null, null);
  });

  it('getCapabilities 返回原生给的对象', async () => {
    const mod = loadModule();
    const caps = await mod.getCapabilities();
    expect(caps).toMatchObject({ isoMin: 100, isoMax: 800, aperture: 1.6 });
  });
});

describe('事件订阅', () => {
  it('addParamsListener 订阅 Camera2Params 并能收到载荷', () => {
    const mod = loadModule();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DeviceEventEmitter } = require('react-native');
    const received: unknown[] = [];
    const off = mod.addParamsListener((p) => received.push(p));

    const payload = { iso: 320, exposureNs: 1e6, focusDiopters: 0, kelvin: 0, manual: false };
    DeviceEventEmitter.emit(EVENT_PARAMS, payload);

    expect(received).toEqual([payload]);
    off();
    DeviceEventEmitter.emit(EVENT_PARAMS, payload);
    expect(received).toHaveLength(1);
  });

  it('addErrorListener 订阅 Camera2Error', () => {
    const mod = loadModule();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DeviceEventEmitter } = require('react-native');
    const received: string[] = [];
    const off = mod.addErrorListener((m) => received.push(m));
    DeviceEventEmitter.emit(EVENT_ERROR, '相机被占用');
    expect(received).toEqual(['相机被占用']);
    off();
  });

  it('addReadyListener 订阅 Camera2Ready', () => {
    const mod = loadModule();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DeviceEventEmitter } = require('react-native');
    const hits: number[] = [];
    const off = mod.addReadyListener(() => hits.push(1));
    DeviceEventEmitter.emit(EVENT_READY, true);
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
    const mod = loadModule();
    expect(mod.parseShutterToNs(text)).toBeCloseTo(expected, 3);
  });

  it('无法解析时返回 undefined', () => {
    const mod = loadModule();
    expect(mod.parseShutterToNs('abc')).toBeUndefined();
    expect(mod.parseShutterToNs('0')).toBeUndefined();
  });

  it('formatShutterNs 输出人可读的写法', () => {
    const mod = loadModule();
    expect(mod.formatShutterNs(4_000_000)).toBe('1/250');
    expect(mod.formatShutterNs(1_000_000)).toBe('1/1000');
    expect(mod.formatShutterNs(1_500_000_000)).toBe('1.5s');
    expect(mod.formatShutterNs(0)).toBe('—');
  });

  it('parse 和 format 能互相还原', () => {
    const mod = loadModule();
    expect(mod.formatShutterNs(mod.parseShutterToNs('1/250')!)).toBe('1/250');
  });
});
