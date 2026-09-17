import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

/** 版本号单一真源：package.json。界面与 APK 都从这里读，避免多处手写漂移 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  /** 相对基址：WebView 用 file:// 加载与 GitHub Pages 子路径部署都靠它 */
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) }
});
