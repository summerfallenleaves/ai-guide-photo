import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { getSceneReferences } from '@/domain/guidance/scene-refs';
import { SCENE_ORDER } from '@/domain/guidance/scenes';

describe('复盘参考图', () => {
  it('四个场景各有 2 张,other 没有', () => {
    for (const scene of SCENE_ORDER) {
      const refs = getSceneReferences(scene);
      if (scene === 'other') {
        expect(refs).toHaveLength(0);
      } else {
        expect(refs).toHaveLength(2);
      }
    }
  });

  it('每张都有 caption 和结构化元数据', () => {
    for (const scene of SCENE_ORDER) {
      for (const ref of getSceneReferences(scene)) {
        expect(ref.caption.length).toBeGreaterThan(4);
        // jest 会把图片模块 mock 成对象,运行时 RN 里是数字 
        expect(ref.asset).toBeTruthy();
        expect(ref.meta.camera).toBeTruthy();
        expect(ref.meta.focalLengthMm).toBeGreaterThan(0);
        expect(ref.meta.aperture).toBeGreaterThan(0);
        expect(ref.meta.shutter).toBeTruthy();
        expect(ref.meta.iso).toBeGreaterThan(0);
      }
    }
  });

  it('图片文件真实存在', () => {
    const root = join(__dirname, '..', 'assets', 'reference');
    for (const scene of ['portrait', 'landscape', 'food', 'street']) {
      for (let n = 1; n <= 2; n += 1) {
        expect(existsSync(join(root, `${scene}-${n}.jpg`))).toBe(true);
      }
    }
  });

  it('每一张都在 CREDITS 里登记了来源与许可', () => {
    const credits = readFileSync(join(__dirname, '..', 'docs', 'CREDITS.md'), 'utf8');
    for (const scene of ['portrait', 'landscape', 'food', 'street']) {
      for (let n = 1; n <= 2; n += 1) {
        const file = `assets/reference/${scene}-${n}.jpg`;
        expect(credits).toContain(file);
      }
    }
    expect(credits).toContain('CC BY-SA');
  });
});
