import {
  MAX_INTERVENTIONS,
  countAutoShots,
  countParams,
  lastParamsNote,
  pushIntervention,
  summarizeInterventions,
  type Intervention,
} from '@/domain/guidance/interventions';

const params = (detail = 'ISO 800 · 1/125s', reason?: string): Intervention => ({
  at: 1,
  kind: 'params',
  detail,
  reason,
});
const shot = (): Intervention => ({ at: 2, kind: 'auto-shot', detail: '连续两轮可以拍了' });

describe('干预记录', () => {
  it('超过上限只保留最近 N 条', () => {
    let list: Intervention[] = [];
    for (let i = 0; i < MAX_INTERVENTIONS + 5; i += 1) list = pushIntervention(list, params(`p${i}`));
    expect(list).toHaveLength(MAX_INTERVENTIONS);
    expect(list[list.length - 1].detail).toBe(`p${MAX_INTERVENTIONS + 4}`);
  });
});

describe('summarizeInterventions', () => {
  it('没有记录时返回 null(随手拍不显示废话)', () => {
    expect(summarizeInterventions([])).toBeNull();
  });

  it('只调过参数', () => {
    expect(summarizeInterventions([params(), params('ISO 400')])).toBe('拍摄时:AI 调过 2 次参数');
  });

  it('只自动拍过', () => {
    expect(summarizeInterventions([shot()])).toBe('拍摄时:由 AI 自动按快门');
  });

  it('两者都有时都写出来', () => {
    expect(summarizeInterventions([params(), shot()])).toBe('拍摄时:AI 调过 1 次参数 · 由 AI 自动按快门');
  });
});

describe('计数与最近一条', () => {
  it('分别统计调参与自动拍', () => {
    const list = [params(), shot(), params(), shot()];
    expect(countParams(list)).toBe(2);
    expect(countAutoShots(list)).toBe(2);
  });

  it('最近一条调参带理由时拼进说明', () => {
    expect(lastParamsNote([params('ISO 800', '画面偏暗')])).toBe('已自动调 ISO 800（画面偏暗）');
  });

  it('没有理由时只显示改了什么', () => {
    expect(lastParamsNote([params('ISO 800')])).toBe('已自动调 ISO 800');
  });

  it('只有自动拍记录时没有调参说明', () => {
    expect(lastParamsNote([shot()])).toBeNull();
  });
});
