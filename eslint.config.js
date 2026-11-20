// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const nodeGlobals = {
  Buffer: 'readonly',
  AbortController: 'readonly',
  URL: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  process: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // 相机侧不允许依赖 AI:没有 API Key 时相机必须完全可用。
    // 唯一例外是 use-capture-flow —— 拍完之后请求点评。
    files: [
      'src/hooks/use-camera-session.ts',
      'src/hooks/use-shutter-timer.ts',
      'src/hooks/use-preview-gestures.ts',
      'src/hooks/use-tilt.ts',
      'src/infra/camera/**/*.ts',
      'src/infra/media.ts',
      'src/infra/analysis-image.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/domain/guidance', '@/domain/guidance/*', '@/infra/ai', '@/infra/ai/*'],
              message:
                '相机侧不允许依赖 AI:没有 API Key 时相机必须完全可用。需要点评请走 use-capture-flow。',
            },
          ],
        },
      ],
    },
  },
  {
    // 本地代理服务跑在 Node 里,不是 RN 环境
    files: ['server/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: nodeGlobals,
    },
  },
]);
