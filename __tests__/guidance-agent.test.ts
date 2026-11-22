import {
  INITIAL_STATE,
  adviceDigest,
  isSessionActive,
  reduce,
  shouldArmCapture,
  type CaptureGuard,
  type SessionEvent,
  type SessionState,
} from '@/domain/guidance/agent';

const guardOn: CaptureGuard = { autoCapture: true, blocked: false };
const guardOff: CaptureGuard = { autoCapture: false, blocked: false };
const guardBlocked: CaptureGuard = { autoCapture: true, blocked: true };

const ok = (_action: string, readyToShoot = false) => ({ type: 'ROUND_OK' as const, readyToShoot });

/** 跑一串事件,返回最终状态(GUARD 事件先行,模拟页面同步护栏条件) */
function run(state: SessionState, events: SessionEvent[], guard: CaptureGuard = guardOn) {
  let current = reduce(state, { type: 'GUARD', autoCapture: guard.autoCapture, blocked: guard.blocked }).state;
  let capture = false;
  for (const event of events) {
    const result = reduce(current, event);
    current = result.state;
    capture = capture || result.capture;
  }
  return { state: current, capture };
}

describe('会话状态机', () => {
  it('START 进入 observing 并清空所有历史', () => {
    const dirty: SessionState = {
      ...INITIAL_STATE,
      phase: 'observing',
      readyStreak: 1,
      rounds: 5,
      failures: 2,
    };
    const { state } = run(dirty, [{ type: 'START' }]);
    expect(state.phase).toBe('observing');
    expect(state.readyStreak).toBe(0);
    expect(state.rounds).toBe(0);
    expect(state.failures).toBe(0);
  });

  it('STOP 回到 idle', () => {
    const { state } = run({ ...INITIAL_STATE, phase: 'observing' }, [{ type: 'STOP' }]);
    expect(state.phase).toBe('idle');
    expect(isSessionActive(state)).toBe(false);
  });

  it('ROUND_OK 累计轮数', () => {
    const { state } = run(INITIAL_STATE, [{ type: 'START' }, ok('抬高手机')]);
    expect(state.rounds).toBe(1);
  });
});

describe('自动拍摄护栏', () => {
  it('只 ready 一轮不进入倒计时', () => {
    const { state } = run(INITIAL_STATE, [{ type: 'START' }, ok('抬高手机', true)]);
    expect(state.readyStreak).toBe(1);
    expect(state.phase).toBe('observing');
  });

  it('连续两轮 ready 立刻按快门(没有倒计时)', () => {
    const first = run(INITIAL_STATE, [{ type: 'START' }, ok('抬高手机', true)]);
    expect(first.capture).toBe(false);

    const second = run(first.state, [ok('可以拍了', true)]);
    expect(second.capture).toBe(true);
    // 拍完把 streak 清零,避免拍摄流程没走完又来一轮重复触发
    expect(second.state.readyStreak).toBe(0);
  });

  it('相机会立刻拍,不需要等任何计时', () => {
    const { capture } = run(INITIAL_STATE, [
      { type: 'START' },
      ok('抬高手机', true),
      ok('可以拍了', true),
    ]);
    expect(capture).toBe(true);
  });

  it('中间夹一轮不 ready 会打断连续计数', () => {
    const { state } = run(INITIAL_STATE, [
      { type: 'START' },
      ok('抬高手机', true),
      ok('左边有杂物', false),
      ok('可以拍了', true),
    ]);
    expect(state.phase).toBe('observing');
    expect(state.readyStreak).toBe(1);
  });

  it('自动拍摄开关关闭时永远不按快门', () => {
    const { state } = run(
      INITIAL_STATE,
      [{ type: 'START' }, ok('抬高手机', true), ok('可以拍了', true), ok('可以拍了', true)],
      guardOff,
    );
    expect(state.phase).toBe('observing');
    expect(state.readyStreak).toBe(3);
  });

  it('被遮挡(专业面板/后台)时不按快门', () => {
    const { state } = run(
      INITIAL_STATE,
      [{ type: 'START' }, ok('抬高手机', true), ok('可以拍了', true)],
      guardBlocked,
    );
    expect(state.phase).toBe('observing');
  });

  it('shouldArmCapture 对暂停中的会话返回 false', () => {
    const paused: SessionState = { ...INITIAL_STATE, phase: 'observing', readyStreak: 2, paused: true };
    expect(shouldArmCapture(paused, guardOn)).toBe(false);
  });

  it('会话结束后不再触发拍摄', () => {
    const idle: SessionState = { ...INITIAL_STATE, phase: 'idle' };
    const { state, capture } = run(idle, [ok('可以拍了', true), ok('可以拍了', true)]);
    expect(capture).toBe(false);
    expect(state.phase).toBe('idle');
  });
});

describe('失败处理', () => {
  it('失败会打断连续 ready', () => {
    const { state } = run(INITIAL_STATE, [{ type: 'START' }, ok('抬高手机', true), { type: 'ROUND_FAIL' }]);
    expect(state.readyStreak).toBe(0);
    expect(state.failures).toBe(1);
  });

  it('连续失败 3 次后暂停', () => {
    const { state } = run(INITIAL_STATE, [
      { type: 'START' },
      { type: 'ROUND_FAIL' },
      { type: 'ROUND_FAIL' },
      { type: 'ROUND_FAIL' },
    ]);
    expect(state.failures).toBe(3);
    expect(state.paused).toBe(true);
  });

  it('成功一轮会清掉失败计数', () => {
    const { state } = run(INITIAL_STATE, [
      { type: 'START' },
      { type: 'ROUND_FAIL' },
      { type: 'ROUND_FAIL' },
      ok('抬高手机'),
    ]);
    expect(state.failures).toBe(0);
  });

  it('RESUME 解除暂停', () => {
    const paused: SessionState = { ...INITIAL_STATE, phase: 'observing', paused: true, failures: 3 };
    const { state } = run(paused, [{ type: 'RESUME' }]);
    expect(state.paused).toBe(false);
  });
});

describe('复盘摘要 adviceDigest', () => {
  it('摘要不带编号,避免点评时出现"第 N 条建议"', () => {
    const digest = adviceDigest([
      { headline: 'a', action: '抬高手机', dim: 'composition', scene: 'portrait' },
      { headline: 'b', action: '往左半步', dim: 'composition', scene: 'portrait' },
    ])!;
    expect(digest).not.toMatch(/^\s*\d+\./m);
    expect(digest).toContain('- [构图] 抬高手机');
  });

  it('换场景时插入切换标记,且不合并不同场景的相同动作', () => {
    const digest = adviceDigest([
      { headline: 'a', action: '往左半步', dim: 'composition', scene: 'portrait' },
      { headline: 'b', action: '往左半步', dim: 'composition', scene: 'landscape' },
    ])!;
    expect(digest).toContain('场景切换到「风光」');
    expect(digest).toContain('之前是「人像」');
    // 不同场景不算"同一建议重复"
    expect(digest).not.toContain('同一建议第 2 次');
  });

  it('同一场景不插标记', () => {
    const digest = adviceDigest([
      { headline: 'a', action: '抬高', dim: 'composition', scene: 'portrait' },
      { headline: 'b', action: '往左', dim: 'composition', scene: 'portrait' },
    ])!;
    expect(digest).not.toContain('场景切换');
  });

  const a = (action: string, dim = 'composition') => ({ headline: '标题', action, dim });

  it('没有建议时返回 null', () => {
    expect(adviceDigest([])).toBeNull();
  });

  it('包含轮数、维度标签和动作', () => {
    const digest = adviceDigest([a('抬高手机'), a('移开纸盒', 'background')]);
    expect(digest).toContain('共 2 轮');
    expect(digest).toContain('[构图] 抬高手机');
    expect(digest).toContain('[背景] 移开纸盒');
  });

  it('连续相同动作合并并标注次数', () => {
    const digest = adviceDigest([a('抬高手机'), a('抬高手机'), a('抬高手机')]);
    expect(digest).toContain('同一建议第 3 次');
    // 合并后只剩一行动作
    expect(digest!.split('\n').filter((line) => line.includes('抬高手机'))).toHaveLength(1);
  });

  it('超过 8 条时保留开头 2 条和结尾 6 条', () => {
    const list = Array.from({ length: 12 }, (_, i) => a(`动作 ${i}`));
    const digest = adviceDigest(list)!;
    expect(digest).toContain('共 12 轮');
    expect(digest).toContain('动作 0'); // 开头保留
    expect(digest).toContain('动作 1');
    expect(digest).toContain('动作 11'); // 结尾保留
    expect(digest).not.toContain('动作 5'); // 中间被裁掉
  });
});
