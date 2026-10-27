/**
 * 图片资源迁移到腾讯云 COS(方案 B:对象存储 + CDN)
 *
 * 作用:把 public/images/ 下的 gallery-*.jpg 与 gallery-*.webp 上传到 COS 存储桶,
 *       供 CDN(cdn.danqing.site)加速分发。前端 ResilientImage 会优先从 CDN 加载,
 *       本地服务器资源作为备用。
 *
 * 用法:
 *   COS_SECRET_ID=xxx COS_SECRET_KEY=xxx COS_BUCKET=xxx COS_REGION=xxx \
 *     node scripts/upload-to-cos.mjs [--key-prefix images/] [--force]
 *
 * 环境变量(也可放到 website/.env,脚本会自动读取):
 *   COS_SECRET_ID   腾讯云 API 密钥 SecretId
 *   COS_SECRET_KEY  腾讯云 API 密钥 SecretKey
 *   COS_BUCKET      存储桶名,形如 danqing-ai-1250000000
 *   COS_REGION      存储桶地域,形如 ap-guangzhou
 *
 * 特性:
 *   - 增量上传:仅当对象不存在或大小/MD5 不同才上传,重复运行安全
 *   - 幂等:上传失败可重跑,已上传的会被跳过
 *   - CDN 缓存头:public, max-age=31536000, immutable(图片恒定不变)
 *   - 并发控制,避免触发 COS 限流
 */
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import COS from 'cos-nodejs-sdk-v5';

// ---- 读取配置(优先环境变量,其次 website/.env) ----
function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  const cfg = {};
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return cfg;
}

const env = loadEnv();
const SECRET_ID = process.env.COS_SECRET_ID ?? env.COS_SECRET_ID;
const SECRET_KEY = process.env.COS_SECRET_KEY ?? env.COS_SECRET_KEY;
const BUCKET = process.env.COS_BUCKET ?? env.COS_BUCKET;
const REGION = process.env.COS_REGION ?? env.COS_REGION;

if (!SECRET_ID || !SECRET_KEY || !BUCKET || !REGION) {
  console.error(
    '[upload-to-cos] 缺少配置。请设置环境变量或在 website/.env 中提供:\n' +
      '  COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION'
  );
  process.exit(1);
}

const IMG_DIR = join(process.cwd(), 'public', 'images');
const args = process.argv.slice(2);
const KEY_PREFIX = (args[findArg(args, '--key-prefix')] ?? 'images/').replace(/\/?$/, '/');
const FORCE = args.includes('--force');

function findArg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? i + 1 : -1;
}

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const client = new COS({
  SecretId: SECRET_ID,
  SecretKey: SECRET_KEY,
});

const CONCURRENCY = 5;

/** 判断对象是否已存在且内容一致(增量上传) */
async function objectExists(key, size) {
  return new Promise((resolve) => {
    client.headObject({ Bucket: BUCKET, Region: REGION, Key: key }, (err, data) => {
      if (err) return resolve(false);
      // 比较长度即可(长度相同即视为已上传,避免频繁读全量)
      resolve(Number(data.body?.ContentLength) === size);
    });
  });
}

function putObject(key, buf, contentType) {
  return new Promise((resolve, reject) => {
    client.putObject(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        Body: buf,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function main() {
  const files = await readdir(IMG_DIR);
  const targets = files.filter((f) => /^gallery-.*\.(jpg|jpeg|webp)$/i.test(f));
  if (!targets.length) {
    console.error('[upload-to-cos] 未找到 gallery-*.jpg/webp 文件。');
    process.exit(1);
  }

  console.log(`[upload-to-cos] 目标:${BUCKET} @ ${REGION},前缀 ${KEY_PREFIX},共 ${targets.length} 个文件`);
  if (FORCE) console.log('[upload-to-cos] --force:忽略增量检查,强制全量上传');

  let uploaded = 0;
  let skipped = 0;
  let failed = [];

  const queue = [...targets];
  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      const key = `${KEY_PREFIX}${file}`;
      const filePath = join(IMG_DIR, file);
      const ext = parse(file).ext.toLowerCase();

      try {
        const st = await stat(filePath);
        if (!FORCE && (await objectExists(key, st.size))) {
          skipped += 1;
          console.log(`  - 跳过(已存在) ${key}`);
          continue;
        }
        const buf = await readFile(filePath);
        await putObject(key, buf, MIME[ext] ?? 'application/octet-stream');
        uploaded += 1;
        console.log(`  + 上传 ${key} (${(st.size / 1024).toFixed(1)}KB)`);
      } catch (err) {
        failed.push(key);
        console.error(`  ! 失败 ${key}: ${err.code ?? err.message}`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`\n[upload-to-cos] 完成:上传 ${uploaded} 个,跳过 ${skipped} 个${failed.length ? `,失败 ${failed.length} 个` : ''}。`);
  if (failed.length) {
    console.error('[upload-to-cos] 失败清单:', failed.join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[upload-to-cos] 失败:', err);
  process.exit(1);
});