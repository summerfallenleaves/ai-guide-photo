# 第三方素材来源

本项目在**复盘点评**时会附上同场景的参考照片(每个场景 2 张),用于让模型有一个
"这个场景做到什么程度算好"的参照。

图片全部来自 [Wikimedia Commons](https://commons.wikimedia.org/),按各自的许可使用。
**图片版权归原作者所有,不适用本项目的代码许可**;本文件记录来源与许可,
再分发时请保留这一节。

| 文件 | 来源(Commons 页面) | 作者 / 许可 | 原始 EXIF |
| --- | --- | --- | --- |
| `assets/reference/portrait-1.jpg` | [File:20180602 FIFA Friendly Match Austria vs. Germany Rainer Pariasek](https://commons.wikimedia.org/wiki/File:20180602_FIFA_Friendly_Match_Austria_vs._Germany_Rainer_Pariasek.jpg) | CC BY-SA 4.0 | NIKON D850 · 200mm · f/3.5 · 1/250s · ISO 720 |
| `assets/reference/portrait-2.jpg` | [File:20160805 - Inle Lake, Myanmar - 8453 DxO](https://commons.wikimedia.org/wiki/File:20160805_-_Inle_Lake,_Myanmar_-_8453_DxO.jpg) | CC BY-SA 4.0 | PENTAX K-5 II · 260mm · f/5.6 · 1/800s · ISO 800 |
| `assets/reference/landscape-1.jpg` | [File:2014 Track on Fremington Edge](https://commons.wikimedia.org/wiki/File:2014_Track_on_Fremington_Edge.jpg) | CC BY-SA 3.0 | E-M1 · 18mm · f/5.6 · 1/1000s · ISO 200 |
| `assets/reference/landscape-2.jpg` | [File:2019 - Parc national des Pyrenees - Vallée de Gavarnie](https://commons.wikimedia.org/wiki/File:2019_-_Parc_national_des_Pyrenees_-_Vall%C3%A9e_de_Gavarnie.jpg) | CC BY-SA 4.0 | Canon EOS 5D Mark II · 46mm · f/8 · 1/125s · ISO 200 |
| `assets/reference/food-1.jpg` | [File:Ajiaco in Bogotá](https://commons.wikimedia.org/wiki/File:Ajiaco_in_Bogot%C3%A1.jpg) | CC BY-SA 4.0 | ILCE-5000 · 16mm · f/1.0 · 1/60s · ISO 320 |
| `assets/reference/food-2.jpg` | [File:2018-12-20-Turkish pastry with cream filling-1253](https://commons.wikimedia.org/wiki/File:2018-12-20-Turkish_pastry_with_cream_filling-1253.jpg) | CC BY-SA 4.0 | Canon EOS 80D · 73mm · f/16 · 0.8s · ISO 100 |
| `assets/reference/street-1.jpg` | [File:112612 klezmer in mahane yehuda market PikiWiki Israel](https://commons.wikimedia.org/wiki/File:112612_klezmer_in_mahane_yehuda_market_PikiWiki_Israel.jpg) | CC BY 2.5 | iPhone 11 · 7.7mm · f/2.4 · 1/448s · ISO 20 |
| `assets/reference/street-2.jpg` | [File:114572 pakiin - mourning procession PikiWiki Israel](https://commons.wikimedia.org/wiki/File:114572_pakiin_-_mourning_procession_PikiWiki_Israel.jpg) | CC BY 2.5 | USB Camera · 64.7mm · f/6 · 1/30s · ISO 100 |

## 处理说明

- 原始图片经等比缩放到宽 800px、JPEG 质量 78 后打包,未做裁切或调色
- EXIF(机身 / 焦距 / 光圈 / 快门 / ISO)记录在 `src/domain/guidance/scene-refs.ts`,
  当前**不喂给模型**,保留是为了后续按"等效焦距 / 景深 / 快门"做更细的对比
- 场景标注(室内外 / 光向)是人工判断,不是 EXIF 字段

## 需要替换时

1. 把新图放到 `assets/reference/<场景>-<序号>.jpg`
2. 更新 `src/domain/guidance/scene-refs.ts` 的 caption 与 meta
3. 更新本文件的来源与许可
