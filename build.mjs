// src/ 를 파일 하나(dist/index.html)로 묶는다 — 내려받아 더블클릭(file://)해도 열리도록
// 사용: npm install (처음 한 번) → npm run build
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = p => path.join(root, 'src', p);

const result = await build({
  entryPoints: [src('js/main.js')],
  bundle: true,
  format: 'iife',
  charset: 'utf8',
  target: 'es2020',
  write: false,
});
// HTML 안에 넣을 때 </script> 가 중간에 끊지 않게
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
const css = fs.readFileSync(src('style.css'), 'utf8');
let html = fs.readFileSync(src('index.html'), 'utf8');

const LINK = '<link rel="stylesheet" href="style.css">';
const SCRIPT = '<script type="module" src="js/main.js"></script>';
if (!html.includes(LINK) || !html.includes(SCRIPT)) throw new Error('index.html 에서 style.css / main.js 연결 줄을 찾지 못했습니다');
html = html.replace(LINK, () => `<style>\n${css}\n</style>`);
html = html.replace(SCRIPT, () => `<script>\n${js}</script>`);

// 단일 파일 조건 검사: 모듈 스크립트·바깥 주소가 남으면 실패 (SVG 이름공간 w3.org 는 요청이 아니라 제외)
const bad = [/type="module"/, /<script[^>]+src=/, /<link[^>]+href=/, /https?:\/\/(?!www\.w3\.org\/)/].filter(re => re.test(html));
if (bad.length) throw new Error('dist 에 남으면 안 되는 것이 있습니다: ' + bad.join(', '));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
// 내려받아 더블클릭하는 사람용 — 내용은 index.html 과 같고 이름만 알아보기 쉽게
fs.writeFileSync(path.join(root, 'dist', '직업재활평가 및 계획서 작성기.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + 'KB');
