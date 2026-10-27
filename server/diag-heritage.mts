// 临时诊断脚本:用真实剪纸类 prompt + 图片调用 glm-4.6v,检查输出是否超 2048 tokens 截断
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { env } from './src/config/env.js';
import { buildSystemPrompt, buildUserPrompt } from './src/services/ai-vision.service.js';

const cfg = env();
const j = JSON.parse(fs.readFileSync('../public/data/heritage-works.json', 'utf8'));
const w = j.items.find((x) => x.category === 'papercut');
const imgPath = path.resolve('../public/images/heritage/thumb/' + w.id + '.jpg');
if (!fs.existsSync(imgPath)) {
  console.log('image not found:', imgPath);
  process.exit(1);
}
const b64 = fs.readFileSync(imgPath).toString('base64');
const mime = imgPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
console.log(`剪纸作品: ${w.title} (${(fs.statSync(imgPath).size / 1024).toFixed(1)}KB)`);

const systemPrompt = buildSystemPrompt('heritage', 'teaching');
const userPrompt = buildUserPrompt({
  artType: 'heritage',
  heritageCategory: 'papercut',
  diagnosisMode: 'teaching',
  title: w.title,
} as never);
console.log('userPrompt 长度(字符):', userPrompt.length, '/ systemPrompt 长度:', systemPrompt.length);

const body = {
  model: cfg.aiApiModels[0],
  messages: [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
      ],
    },
  ],
  max_tokens: 2048,
  temperature: 0.7,
};

const started = Date.now();
const timeoutMs = Math.min(cfg.aiEnhanceTimeout ?? 15000, 120000);
console.log(`调用模型: ${cfg.aiApiModels[0]} / 超时: ${timeoutMs}ms / max_tokens: 2048`);
try {
  const res = await axios.post(cfg.aiApiUrl, body, {
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.aiApiKey}`,
    },
  });
  const elapsed = Date.now() - started;
  const content = res.data?.choices?.[0]?.message?.content ?? '';
  const finish = res.data?.choices?.[0]?.finish_reason;
  console.log('HTTP', res.status, '/ 耗时', elapsed, 'ms / finish_reason:', finish);
  console.log('content 长度:', content.length);
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ?? content.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const keys = Object.keys(parsed);
      console.log('JSON 解析成功, 顶层字段:', keys.join(', '));
      console.log('heritage_cultural_context:', JSON.stringify(parsed.heritage_cultural_context ?? null).slice(0, 200));
    } catch (e) {
      console.log('JSON 解析失败:', e.message);
      console.log('片段(head 150):', content.slice(0, 150).replace(/\n/g, '\\n'));
      console.log('片段(tail 150):', content.slice(-150).replace(/\n/g, '\\n'));
    }
  } else {
    console.log('未找到 JSON 块! head 150:', content.slice(0, 150).replace(/\n/g, '\\n'));
  }
} catch (e) {
  const elapsed = Date.now() - started;
  console.log('调用失败:', e.message, '/ 耗时', elapsed, 'ms');
  if (e.response?.data) console.log('响应体:', JSON.stringify(e.response.data).slice(0, 300));
}
