jest.mock('expo-file-system', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));

function normalize(payload: Record<string, unknown>, isCapture = false) {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@/domain/guidance/scoring') as typeof import('@/domain/guidance/scoring');
  return mod.__normalize(payload, isCapture);
}

describe('readyToShoot', () => {
  it('模型明确给 true 就是 true', () => {
    const r = normalize({ dim: 'composition', headline: '可以拍了', action: '按快门', readyToShoot: true }, false);
    expect(r.mode === 'live' && r.readyToShoot).toBe(true);
  });
  it('没给布尔值时,标题含"可以拍了"也算', () => {
    const r = normalize({ dim: 'composition', headline: '可以拍了', action: '按快门' }, false);
    expect(r.mode === 'live' && r.readyToShoot).toBe(true);
  });
  it('普通建议一律 false', () => {
    const r = normalize({ dim: 'light', headline: '往右挪', action: '向右移动一步' }, false);
    expect(r.mode === 'live' && r.readyToShoot).toBe(false);
  });
});
