import { SCENES, SCENE_ORDER, getScene } from '@/domain/guidance/scenes';
import { withScene, withSceneScoring } from '@/domain/guidance/prompt';

describe('场景数据完整性', () => {
  it('每个场景都有标准、优先级和示例', () => {
    for (const id of SCENE_ORDER) {
      const scene = SCENES[id];
      expect(scene.id).toBe(id);
      expect(scene.label.length).toBeGreaterThan(0);
      expect(scene.rubric.length).toBeGreaterThanOrEqual(3);
      expect(scene.priority.length).toBeGreaterThanOrEqual(3);
      expect(scene.examples.length).toBeGreaterThanOrEqual(2);
      expect(scene.scoring.high.length).toBeGreaterThan(0);
      expect(scene.scoring.mid.length).toBeGreaterThan(0);
      expect(scene.scoring.low.length).toBeGreaterThan(0);
    }
  });

  it('场景顺序覆盖全部场景', () => {
    expect([...SCENE_ORDER].sort()).toEqual(Object.keys(SCENES).sort());
  });

  it('未知场景退回 other', () => {
    expect(getScene(undefined).id).toBe('other');
    expect(getScene(null).id).toBe('other');
  });
});

describe('withScene', () => {
  it('只拼当前场景的标准,不泄漏其他场景', () => {
    const text = withScene('BASE', 'portrait');
    expect(text).toContain('人像');
    expect(text).toContain('人物占画面 1/3 到 1/2');
    // 风光/美食独有的句子不应出现
    expect(text).not.toContain('地平线');
    expect(text).not.toContain('45°');
  });

  it('带上判断优先级和示例', () => {
    const text = withScene('BASE', 'landscape');
    expect(text).toContain('判断优先级');
    expect(text).toContain('地平线是否水平');
    expect(text).toContain('不要照抄');
  });

  it('other 场景也有标准,不会变成空块', () => {
    const text = withScene('BASE', 'other');
    expect(text).toContain('【当前场景:其他】');
    expect(text).toContain('主体清楚');
  });
});

describe('withSceneScoring', () => {
  it('点评只给分数锚点,不塞取景示例', () => {
    const text = withSceneScoring('BASE', 'food');
    expect(text).toContain('高分:');
    expect(text).toContain('低分:');
    // 取景示例里的典型措辞不应出现在点评块
    expect(text).not.toContain('→ 建议:');
    expect(text).toContain('不要拿别的场景的标准来要求它');
  });

  it('不同场景的锚点不同', () => {
    expect(withSceneScoring('BASE', 'portrait')).toContain('眼神有光');
    expect(withSceneScoring('BASE', 'landscape')).toContain('地平线平');
  });
});
