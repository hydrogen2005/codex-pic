import { readFile, writeFile } from 'node:fs/promises';

const source = 'https://github.com/YouMind-OpenLab/awesome-gpt-image-2/blob/main/README_zh.md';
const rawSource = 'https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/refs/heads/main/README_zh.md';
const output = new URL('./cases.json', import.meta.url);

let markdown;
if (process.argv[2]) {
  markdown = await readFile(process.argv[2], 'utf8');
} else {
  const response = await fetch(rawSource, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`README 下载失败（HTTP ${response.status}）`);
  markdown = await response.text();
}

const cases = new Map();
const sections = markdown.replace(/\r\n/g, '\n').split(/^### No\. \d+: /m).slice(1);
for (const section of sections) {
  const [heading, ...rest] = section.split('\n');
  const body = rest.join('\n').split(/^## /m)[0];
  const prompt = body.match(/^#### 📝 提示词\s*\n\s*```[^\n]*\n([\s\S]*?)\n```[ \t]*$/m)?.[1].trim();
  const gallery = body.match(/\]\((https:\/\/youmind\.com\/zh-CN\/gpt-image-2-prompts\?id=(\d+))\)/);
  if (!prompt || !gallery || prompt.length > 32000) continue;
  const [, url, id] = gallery;
  const split = heading.indexOf(' - ');
  const featured = body.includes('Featured-gold');
  const category = !featured && split > 0 ? heading.slice(0, split).trim() : '精选';
  const title = !featured && split > 0 ? heading.slice(split + 3).trim() : heading.trim();
  cases.set(id, {
    id, title, category, prompt, url,
    description: body.match(/^#### 📖 描述\s*\n([\s\S]*?)(?=^#### )/m)?.[1].trim() ?? '',
    image: body.match(/<img src="(https:\/\/cms-assets\.youmind\.com\/[^"]+)"/)?.[1] ?? '',
    author: body.match(/^- \*\*作者:\*\* \[([^\n]+?)\]\(/m)?.[1] ?? '',
    original: body.match(/^- \*\*来源:\*\* \[[^\n]+?\]\((https:\/\/[^\s)]+)\)/m)?.[1] ?? '',
  });
}

if (!cases.size) throw new Error('README 中未找到可导入的案例，保留现有索引。');
await writeFile(output, JSON.stringify({ source, cases: [...cases.values()] }) + '\n', 'utf8');
console.log(`已更新 ${cases.size} 条案例。`);
