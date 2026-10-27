#!/usr/bin/env node
/**
 * 丹青有AI 官网 GitHub Pages 部署脚本
 *
 * 用途:
 *   将 website/out/ 静态导出产物推送至 GitHub Pages。
 *   与 Web 端 deploy-gh-pages.cjs(主仓库根目录)分离,
 *   独立推送到 `website-gh-pages` 分支,避免分支冲突。
 *
 * 使用:
 *   cd website
 *   npm run deploy
 *
 * 流程:
 *   1. npm run build         # 静态导出至 website/out/
 *   2. cd out && git init
 *   3. git add -A && git commit
 *   4. git push -f <repo> main:website-gh-pages
 *
 * 环境变量:
 *   - DEPLOY_REPO (可选):覆盖默认仓库地址,如 git@github.com:Owner/repo.git
 *   - DEPLOY_BRANCH (可选):覆盖默认分支名,默认 website-gh-pages
 *   - DEPLOY_MESSAGE (可选):覆盖默认 commit message
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 默认配置(可通过环境变量覆盖)
const DEFAULT_REPO = 'https://github.com/Xyangshaun/danqing-ai.git';
const DEFAULT_BRANCH = 'website-gh-pages';
const DEFAULT_MESSAGE = 'deploy: 官网 GitHub Pages 部署';

const repo = process.env.DEPLOY_REPO || DEFAULT_REPO;
const branch = process.env.DEPLOY_BRANCH || DEFAULT_BRANCH;
const message = process.env.DEPLOY_MESSAGE || DEFAULT_MESSAGE;

const websiteDir = __dirname;
const outDir = path.join(websiteDir, 'out');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: websiteDir, ...opts });
}

function ensureCleanOut() {
  if (!fs.existsSync(outDir)) {
    console.error(`\n[deploy] 错误:未找到 ${outDir}`);
    console.error(`\n[deploy] 请先运行 \`npm run build\` 生成静态导出产物。`);
    process.exit(1);
  }
  // 清理可能残留的 .git
  const outGit = path.join(outDir, '.git');
  if (fs.existsSync(outGit)) {
    console.log(`[deploy] 清理残留 ${outGit}`);
    fs.rmSync(outGit, { recursive: true, force: true });
  }
}

function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  丹青有AI 官网 → GitHub Pages 部署');
  console.log('═══════════════════════════════════════════════');
  console.log(`  仓库:  ${repo}`);
  console.log(`  分支:  ${branch}`);
  console.log(`  消息:  ${message}`);
  console.log('───────────────────────────────────────────────\n');

  // 1. 构建静态导出
  console.log('[1/4] 构建静态导出 (npm run build)...');
  run('npm run build');

  // 2. 校验 out/ 存在
  ensureCleanOut();

  // 3. 在 out/ 中初始化独立 git 仓库并提交
  console.log('\n[2/4] 初始化 out/ 临时 git 仓库...');
  run('git init', { cwd: outDir });
  run('git add -A', { cwd: outDir });

  // 允许空目录提交(防止 .gitignore 误伤)
  try {
    run(`git commit -m "${message}" --quiet`, { cwd: outDir });
  } catch (e) {
    console.error('\n[deploy] commit 失败:可能是无变更或 git 身份未配置。');
    process.exit(1);
  }

  // 4. 强制推送到目标分支
  console.log(`\n[3/4] 推送到 ${branch} 分支...`);
  run(`git push -f ${repo} main:${branch}`, { cwd: outDir });

  // 5. 清理临时 .git
  console.log('\n[4/4] 清理临时 git 仓库...');
  fs.rmSync(path.join(outDir, '.git'), { recursive: true, force: true });

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✓ 部署完成');
  console.log('═══════════════════════════════════════════════');
  console.log(`\n  下一步:在 GitHub 仓库 Settings → Pages 中`);
  console.log(`  将 Source 设为分支 ${branch} /(root) 目录。`);
  console.log(`  部署 URL 形如:https://<owner>.github.io/<repo>/\n`);
}

main();
