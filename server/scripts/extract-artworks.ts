// ============================================================
// 一次性脚本:从前端 src/services/artworksDatabase.ts 提取艺术品数据
// 输出 server/data/artworks.json + server/data/style-categories.json
// 运行:npx tsx scripts/extract-artworks.ts
// 不参与 tsc build(tsconfig include 仅 src/**)
// ============================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { artworksDatabase, styleCategories } from '../../src/services/artworksDatabase';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

writeFileSync(
  join(dataDir, 'artworks.json'),
  JSON.stringify(artworksDatabase, null, 2),
  'utf-8',
);
writeFileSync(
  join(dataDir, 'style-categories.json'),
  JSON.stringify(styleCategories, null, 2),
  'utf-8',
);

console.log(`[extract] artworks: ${artworksDatabase.length}`);
console.log(`[extract] output: ${join(dataDir, 'artworks.json')}`);
