import {
  MIN_APPLY_GAP_MS,
  decideAgentParams,
  describeApplied,
  isMeaningfulChange,
  normalizeAgentParams,
  type ParamLimits,
  type ParamSnapshot,
} from '@/domain/guidance/param-policy';

const limits: ParamLimits = {
  isoMin: 100,
  isoMax: 800,
  exposureMinNs: Math.round(1e9 / 38460),
  exposureMaxNs: 1e9,
};

const manual = (iso: number, exposureNs: number, kelvin = 5000, focusDiopters = 0): ParamSnapshot => ({
  manual: true,
  iso,
  exposureNs,
  kelvin,
  focusDiopters,
});

describe('normalizeAgentParams', () => {
  it('空参数返回 null', () => {
    expect(normalizeAgentParams({}, limits)).toBeNull();
    expect(normalizeAgentParams(null, limits)).toBeNull();
  });

  it('手动曝光必须 ISO 与快门成对', () => {
    expect(normalizeAgentParams({ iso: 400 }, limits)).toBeNull();
    expect(normalizeAgentParams({ shutter: '1/125' }, limits)).toBeNull();
    expect(normalizeAgentParams({ iso: 400, shutter: '1/125' }, limits)).toEqual({
      iso: 400,
      shutter: '1/125',
    });
  });

  it('超出硬件范围的 ISO 会被夹住,而不是报错', () => {
    expect(normalizeAgentParams({ iso: 6400, shutter: '1/125' }, limits)?.iso).toBe(800);
    expect(normalizeAgentParams({ iso: 10, shutter: '1/125' }, limits)?.iso).toBe(100);
  });

  it('超慢快门会被夹到上限', () => {
    // 上限 1s,给 5s 应该变成 1s
    expect(normalizeAgentParams({ iso: 400, shutter: '5' }, limits)?.shutter).toBe('1');
  });

  it('白平衡夹在 2500~8000K', () => {
    expect(normalizeAgentParams({ wb: 1200 }, limits)?.wb).toBe(2500);
    expect(normalizeAgentParams({ wb: 12000 }, limits)?.wb).toBe(8000);
  });

  it('对焦距离夹在 0.1~20 米', () => {
    expect(normalizeAgentParams({ focusMeters: 0 }, limits)).toBeNull();
    expect(normalizeAgentParams({ focusMeters: 0.01 }, limits)?.focusMeters).toBe(0.1);
    expect(normalizeAgentParams({ focusMeters: 99 }, limits)?.focusMeters).toBe(20);
  });

  it('没有 limits 时仍然能归一化(不夹范围)', () => {
    expect(normalizeAgentParams({ iso: 3200, shutter: '1/60' }, null)).toEqual({
      iso: 3200,
      shutter: '1/60',
    });
  });
});

describe('isMeaningfulChange', () => {
  it('没有当前快照时总是值得调', () => {
    expect(isMeaningfulChange({ iso: 200, shutter: '1/60' }, null)).toBe(true);
  });

  it('自动模式下没有基准值,视为值得调', () => {
    expect(
      isMeaningfulChange({ iso: 200, shutter: '1/60' }, {
        manual: false,
        iso: 0,
        exposureNs: 0,
        kelvin: 0,
        focusDiopters: 0,
      }),
    ).toBe(true);
  });

  it('ISO 变化太小就跳过(防止来回抖)', () => {
    // 400 → 420,不到 1/3 档
    expect(isMeaningfulChange({ iso: 420, shutter: '1/125' }, manual(400, 8_000_000))).toBe(false);
  });

  it('ISO 变化够大就下发', () => {
    expect(isMeaningfulChange({ iso: 800, shutter: '1/125' }, manual(400, 8_000_000))).toBe(true);
  });

  it('色温变化小于 250K 跳过', () => {
    expect(isMeaningfulChange({ wb: 5200 }, manual(400, 8_000_000, 5000))).toBe(false);
    expect(isMeaningfulChange({ wb: 5400 }, manual(400, 8_000_000, 5000))).toBe(true);
  });

  it('对焦距离按屈光度比较', () => {
    // 1m(1.0 屈光度)→ 1.02m 变化很小
    expect(isMeaningfulChange({ focusMeters: 1.02 }, manual(400, 8_000_000, 5000, 1))).toBe(false);
    // 1m → 0.5m(2.0 屈光度)变化够大
    expect(isMeaningfulChange({ focusMeters: 0.5 }, manual(400, 8_000_000, 5000, 1))).toBe(true);
  });
});

describe('decideAgentParams', () => {
  const base = {
    enabled: true,
    busy: false,
    userTakeover: false,
    now: 100_000,
    lastAppliedAt: 0,
    params: { iso: 800, shutter: '1/125' } as const,
    current: manual(400, 8_000_000),
  };

  it('正常情况下发', () => {
    expect(decideAgentParams({ ...base })).toEqual({ apply: true, reason: 'ok' });
  });

  it('开关关闭时不下发', () => {
    expect(decideAgentParams({ ...base, enabled: false }).reason).toBe('disabled');
  });

  it('正在拍照时不下发', () => {
    expect(decideAgentParams({ ...base, busy: true }).reason).toBe('busy');
  });

  it('用户手动接管后不再抢', () => {
    expect(decideAgentParams({ ...base, userTakeover: true }).reason).toBe('user-takeover');
  });

  it('没有参数时不下发', () => {
    expect(decideAgentParams({ ...base, params: null }).reason).toBe('no-params');
  });

  it('两次下发之间有最小间隔', () => {
    const recent = decideAgentParams({
      ...base,
      lastAppliedAt: base.now - (MIN_APPLY_GAP_MS - 1),
    });
    expect(recent.reason).toBe('too-soon');
    const later = decideAgentParams({
      ...base,
      lastAppliedAt: base.now - MIN_APPLY_GAP_MS,
    });
    expect(later.apply).toBe(true);
  });

  it('变化太小时跳过', () => {
    expect(
      decideAgentParams({ ...base, params: { iso: 410, shutter: '1/125' }, current: manual(400, 8_000_000) })
        .reason,
    ).toBe('no-change');
  });
});

describe('describeApplied', () => {
  it('拼出给用户看的说明', () => {
    expect(describeApplied({ iso: 400, shutter: '1/125' })).toBe('已自动调 ISO 400 · 1/125s');
    expect(describeApplied({ wb: 5200 })).toBe('已自动调 5200K');
    expect(describeApplied({})).toBe('已自动调整参数');
  });
});
