import { continuityNote, nextRepeat, type Advice } from '@/domain/guidance/continuity';

const advice = (action: string, dim = 'composition'): Advice => ({
  headline: '标题',
  action,
  dim,
});

describe('nextRepeat', () => {
  it('第一次没有历史时算第 1 次', () => {
    expect(nextRepeat(null, '把手机抬高约 20 厘米')).toBe(1);
  });

  it('动作文本相同算同一条建议(第 2 次)', () => {
    expect(nextRepeat(advice('把手机抬高约 20 厘米'), '把手机抬高约 20 厘米')).toBe(2);
  });

  it('动作不同就是新建议,重新计数', () => {
    expect(nextRepeat(advice('把手机抬高约 20 厘米'), '往左横移一步')).toBe(1);
  });

  it('首尾空格不影响判定', () => {
    expect(nextRepeat(advice('  抬高手机  '), '抬高手机')).toBe(2);
  });

  it('空动作按第 1 次处理,不会误判成重复', () => {
    expect(nextRepeat(advice('抬高手机'), '   ')).toBe(1);
  });
});

describe('continuityNote', () => {
  it('没有历史时返回 null(不往 prompt 里塞东西)', () => {
    expect(continuityNote(null, 1)).toBeNull();
  });

  it('第一次带上上一轮的建议原文', () => {
    const note = continuityNote(advice('把手机抬高约 20 厘米'), 1);
    expect(note).toContain('把手机抬高约 20 厘米');
    // 要求它先判断有没有照做,并且不要原样重复
    expect(note).toContain('不要原样重复');
    expect(note).toContain('相反的方向');
  });

  it('重复第 2 次时要求换维度,而不是再说一遍', () => {
    const note = continuityNote(advice('把手机抬高约 20 厘米'), 2);
    expect(note).toContain('已经连续提了 2 次');
    expect(note).toContain('不要再说第 3 次');
    expect(note).toContain('换一个维度');
  });

  it('重复次数继续增长时提示更大的数字', () => {
    expect(continuityNote(advice('抬高'), 4)).toContain('不要再说第 5 次');
  });

  it('建议动作是空字符串时视为没有历史', () => {
    expect(continuityNote(advice(''), 1)).toBeNull();
  });
});
