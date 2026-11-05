import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  formats,
  CSP_HEADER,
  logBody,
  validateInput,
  validateKey,
  callOpenAI,
} from './openai-generate.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/studio.css', ['studio.css', 'text/css']],
  ['/studio.js', ['studio.js', 'text/javascript']],
  ['/history.js', ['history.js', 'text/javascript']],
  ['/cases.js', ['cases.js', 'text/javascript']],
  ['/cases.json', ['cases.json', 'application/json']],
]);

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 128 * 1024) throw new RangeError('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createStudio({ apiKey = process.env.OPENAI_API_KEY?.trim(), send = fetch } = {}) {
  let generating = false;
  return createServer(async (request, response) => {
    const host = request.headers.host;
    const port = request.socket.localPort;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', CSP_HEADER);
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return json(response, 403, { error: '请通过本机地址访问。' });
    }

    const path = request.url;
    const asset = assets.get(path);
    if (request.method === 'GET' && asset) {
      try {
        const content = await readFile(new URL(`./${asset[0]}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
        return response.end(content);
      } catch {
        return json(response, 500, { error: '无法读取界面文件。' });
      }
    }
    if (request.method === 'GET' && path === '/api/config') {
      return json(response, 200, { hasServerKey: Boolean(apiKey) });
    }
    if (request.method !== 'POST' || path !== '/api/generate') {
      return json(response, 404, { error: '页面不存在。' });
    }
    if (request.headers.origin !== `http://${host}`) {
      return json(response, 403, { error: '请在本机工具页面提交请求。' });
    }
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
      return json(response, 415, { error: '请求须使用 JSON 格式。' });
    }

    let input;
    try {
      input = await readJson(request);
    } catch (error) {
      const status = error instanceof RangeError ? 413 : 400;
      return json(response, status, { error: '请求内容无效或过长。' });
    }

    const validation = validateInput(input);
    if (!validation.valid) {
      return json(response, 400, { error: validation.error });
    }

    const key = apiKey || request.headers['x-openai-key']?.trim();
    if (!validateKey(key)) {
      return json(response, 400, { error: '请输入有效的 OpenAI API Key。' });
    }
    if (generating) return json(response, 409, { error: '已有生成任务正在运行。' });

    generating = true;
    const signal = AbortSignal.timeout(300_000);
    const wantsJson = request.headers.accept === 'application/json';
    const started = Date.now();
    console.log(`[${new Date(started).toISOString()}] OpenAI 请求 JSON\n${JSON.stringify(logBody(validation.payload, key), null, 2)}`);
    try {
      const result = await callOpenAI({ payload: validation.payload, key, signal, send });
      console.log(`[${new Date().toISOString()}] OpenAI 响应 JSON\n${JSON.stringify(result.responseLog, null, 2)}`);
      if (wantsJson) {
        return json(response, result.status, {
          ...result.body,
          log: { request: result.requestLog, response: result.responseLog },
        });
      }
      if (!result.success) {
        return json(response, result.status, result.body);
      }
      if (result.format === 'svg') response.setHeader('Content-Disposition', 'attachment; filename="openai-image.svg"');
      response.writeHead(result.status, { 'Content-Type': formats[result.format] });
      response.end(Buffer.from(result.encoded, 'base64'));
    } finally {
      generating = false;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.IMAGE_STUDIO_PORT || 3210);
  const server = createStudio();
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用。请设置 IMAGE_STUDIO_PORT 后重试。`
      : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`图像工作台 · http://127.0.0.1:${server.address().port}`);
  });
}
