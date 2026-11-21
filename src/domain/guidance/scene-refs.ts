/**
 * 复盘用的参考图片(每个场景 2 张)。
 *
 * 取景侧只用文字(rubric + 文本示例),因为每 3 秒一轮带图太贵;
 * 点评是一次性请求,可以带上真实照片当"这个场景做到什么算好"的参照。
 *
 * 图片来自 Wikimedia Commons,许可与作者见 `docs/CREDITS.md`。
 * 元数据(相机/焦距/光圈/快门/ISO)取自 Commons 的原始 EXIF,
 * **保留下来是为了后续能按"等效焦距/景深"这类维度做更细的对比**,
 * 当前 prompt 里只用 caption(为什么这张算好),不把这些数字喂给模型
 * —— 数字容易诱导模型去模仿参数,而不是理解画面。
 */

import type { SceneId } from '@/domain/shared/types';

export type ReferenceMeta = {
  /** 相机/机身(EXIF Model) */
  camera?: string;
  /** 物理焦距,单位 mm */
  focalLengthMm?: number;
  /** 光圈值,如 2.8 */
  aperture?: number;
  /** 快门,如 "1/250" */
  shutter?: string;
  iso?: number;
  /** 拍摄场景补充:室内/室外、光向、时段(人工标注,EXIF 里没有) */
  place?: 'indoor' | 'outdoor';
  light?: 'front' | 'side' | 'back' | 'soft' | 'hard';
  timeOfDay?: string;
  /** 天气(能从画面判断时才填) */
  weather?: string;
};

export type SceneReference = {
  /** 打包进 APK 的图片模块 */
  asset: number;
  /** 这张为什么算"好"——这一段会进 prompt */
  caption: string;
  meta: ReferenceMeta;
};

const REFERENCES: Record<SceneId, SceneReference[]> = {
  portrait: [
    {
      asset: require('../../../assets/reference/portrait-1.jpg'),
      caption: '浅景深把背景压糊,人物占画面约一半,柔和的正面光,眼神有光',
      meta: { camera: 'NIKON D850', focalLengthMm: 200, aperture: 3.5, shutter: '1/250', iso: 720, place: 'outdoor', light: 'soft' },
    },
    {
      asset: require('../../../assets/reference/portrait-2.jpg'),
      caption: '环境人像:人物与环境同时交代,侧光,主体略偏一侧,背景不抢人',
      meta: { camera: 'PENTAX K-5 II', focalLengthMm: 260, aperture: 5.6, shutter: '1/800', iso: 800, place: 'outdoor', light: 'side' },
    },
  ],
  landscape: [
    {
      asset: require('../../../assets/reference/landscape-1.jpg'),
      caption: '前景的小径把视线带进去,中景有孤树,远景是天空,层次清楚',
      meta: { camera: 'E-M1', focalLengthMm: 18, aperture: 5.6, shutter: '1/1000', iso: 200, place: 'outdoor', light: 'side' },
    },
    {
      asset: require('../../../assets/reference/landscape-2.jpg'),
      caption: '山谷的纵深构图,山脊线放在上三分之一,光线有方向感',
      meta: { camera: 'Canon EOS 5D Mark II', focalLengthMm: 46, aperture: 8, shutter: '1/125', iso: 200, place: 'outdoor', light: 'side' },
    },
  ],
  food: [
    {
      asset: require('../../../assets/reference/food-1.jpg'),
      caption: '碗放在木桌上,侧后方光让汤面有层次,背景压暗不抢主体',
      meta: { camera: 'ILCE-5000', focalLengthMm: 16, aperture: 1, shutter: '1/60', iso: 320, place: 'indoor', light: 'back' },
    },
    {
      asset: require('../../../assets/reference/food-2.jpg'),
      caption: '深色背景衬托浅色食物,侧光打出纹理,主体斜放不呆板',
      meta: { camera: 'Canon EOS 80D', focalLengthMm: 73, aperture: 16, shutter: '0.8', iso: 100, place: 'indoor', light: 'side' },
    },
  ],
  street: [
    {
      asset: require('../../../assets/reference/street-1.jpg'),
      caption: '街头艺人作为明确主体,环境交代清楚,树和路人不抢戏',
      meta: { camera: 'iPhone 11', focalLengthMm: 7.7, aperture: 2.4, shutter: '1/448', iso: 20, place: 'outdoor', light: 'hard' },
    },
    {
      asset: require('../../../assets/reference/street-2.jpg'),
      caption: '道路形成引导线,人群是主体群,逆光勾出轮廓',
      meta: { camera: 'USB Camera', focalLengthMm: 64.7, aperture: 6, shutter: '1/30', iso: 100, place: 'outdoor', light: 'back' },
    },
  ],
  other: [],
};

export function getSceneReferences(scene: SceneId | null | undefined): SceneReference[] {
  return REFERENCES[scene ?? 'other'] ?? [];
}
