import { followUpDelay, speechWatchdogMs } from '@/domain/guidance/voice-policy';

describe('followUpDelay', () => {
  it('离上次分析够久了就立刻跑', () => {
    expect(followUpDelay(0, 5000, 1500)).toBe(0);
  });

  it('太近就等剩下的时间', () => {
    expect(followUpDelay(4000, 4500, 1500)).toBe(1000);
  });
});

describe('speechWatchdogMs', () => {
  it('按字数估算,并且有上限', () => {
    expect(speechWatchdogMs(0)).toBe(2500);
    expect(speechWatchdogMs(10)).toBe(4700);
    expect(speechWatchdogMs(1000)).toBe(15000);
  });
});
