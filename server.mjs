import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/studio.css', ['studio.css', 'text/css']],
  ['/studio.js', ['studio.js', 'text/javascript']],
  ['/history.js', ['history.js', 'text/javascript']],
  ['/cases.js', ['cases.js', 'text/javascript']],
  ['/cases.json', ['cases.json', 'application/json']],
]);
const sizes = ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152'];
const qualities = ['auto', 'low', 'medium', 'high'];
const formats = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};
const vectorAndAnimationModels = new Set(['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare']);
const endpoint = 'https://api.openai.com/v1/images/generations';

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function logBody(body, key) {
  return JSON.parse(JSON.stringify(body, (field, value) => {
    if (field === 'b64_json' && typeof value === 'string') {
      return `[省略 Base64，共 ${value.length} 字符]`;
    }
    if (/^(authorization|api_?key|x-openai-key)$/i.test(field)) return '[已隐藏]';
    if (typeof value !== 'string') return value;
    return value.replaceAll(key, '[已隐藏]').replace(/sk-[a-zA-Z0-9_*-]+/g, '[已隐藏]');
  }));
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

function openAIError(status, code) {
  if (code === 'model_not_found') return '当前项目无法使用此模型。请核对模型 ID 和项目权限。';
  if (code === 'billing_hard_limit_reached' || code === 'insufficient_quota') return 'OpenAI API 额度不足，请检查项目账单和使用限额。';
  if (code === 'content_policy_violation' || code === 'moderation_blocked') return '提示词未通过内容审核，请调整后再试。';
  if (status === 401) return 'OpenAI API Key 无效，请检查密钥。';
  if (status === 403) return 'OpenAI 拒绝了请求，请检查项目权限和组织验证状态。';
  if (status === 429) return 'OpenAI API 请求达到频率或额度限制，请检查限额后再试。';
  if (status === 400) return 'OpenAI 拒绝了生成参数，请检查模型、尺寸、画质和输出格式。';
  return 'OpenAI API 暂时无法完成请求，请稍后再试。';
}

export function createStudio({ apiKey = process.env.OPENAI_API_KEY?.trim(), send = fetch } = {}) {
  let generating = false;
  return createServer(async (request, response) => {
    const host = request.headers.host;
    const port = request.socket.localPort;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: https://cms-assets.youmind.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
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
    const { prompt, model, size, quality, output_format, frame_count, frame_duration_ms } = input ?? {};
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000 ||
        typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model) ||
        !sizes.includes(size) || !qualities.includes(quality) ||
        typeof output_format !== 'string' || !Object.hasOwn(formats, output_format)) {
      return json(response, 400, { error: '请填写提示词并检查生成参数。' });
    }
    if ((output_format === 'gif' || output_format === 'svg') && !vectorAndAnimationModels.has(model)) {
      return json(response, 400, { error: 'GIF 和 SVG 输出需要选择 GPT Image 2.6 Sunburst 或 Flare。' });
    }
    const payload = { model, prompt: prompt.trim(), size, quality, output_format, n: 1 };
    if (output_format === 'gif') {
      const frames = frame_count === undefined ? 9 : frame_count;
      const duration = frame_duration_ms === undefined ? 200 : frame_duration_ms;
      if (!Number.isInteger(frames) || frames < 2 || frames > 64 ||
          !Number.isInteger(duration) || duration < 20 || duration > 2000) {
        return json(response, 400, { error: 'GIF 帧数须为 2–64，单帧时长须为 20–2000 毫秒。' });
      }
      payload.frame_count = frames;
      payload.frame_duration_ms = duration;
    }
    const key = apiKey || request.headers['x-openai-key']?.trim();
    if (!key || !/^[\x21-\x7e]{1,512}$/.test(key)) {
      return json(response, 400, { error: '请输入有效的 OpenAI API Key。' });
    }
    if (generating) return json(response, 409, { error: '已有生成任务正在运行。' });

    generating = true;
    const signal = AbortSignal.timeout(300_000);
    const started = Date.now();
    const requestLog = logBody(payload, key);
    const wantsJson = request.headers.accept === 'application/json';
    console.log(`[${new Date(started).toISOString()}] OpenAI 请求 JSON\n${JSON.stringify(requestLog, null, 2)}`);
    let upstreamStatus = null;
    let requestId = null;
    let data = null;
    function finish(status, body, encoded, format) {
      const responseLog = logBody({
        requested_model: model,
        returned_model: typeof data?.model === 'string' ? data.model : null,
        openai_status: upstreamStatus,
        request_id: requestId,
        elapsed_ms: Date.now() - started,
        body: data,
        local_error: body.error,
      }, key);
      console.log(`[${new Date().toISOString()}] OpenAI 响应 JSON\n${JSON.stringify(responseLog, null, 2)}`);
      if (wantsJson) return json(response, status, { ...body, log: { request: requestLog, response: responseLog } });
      if (!encoded) return json(response, status, body);
      if (format === 'svg') response.setHeader('Content-Disposition', 'attachment; filename="openai-image.svg"');
      response.writeHead(status, { 'Content-Type': formats[format] });
      response.end(Buffer.from(encoded, 'base64'));
    }
    try {
      const result = await send(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal,
      });
      upstreamStatus = result.status;
      const id = result.headers.get('x-request-id');
      requestId = /^req_[\w-]{1,100}$/.test(id ?? '') ? id : null;
      data = await result.json().catch((error) => {
        if (signal.aborted) throw error;
        return null;
      });
      if (!result.ok) {
        return finish(result.status >= 500 ? 502 : result.status, {
          error: openAIError(result.status, data?.error?.code),
          requestId: requestId ?? undefined,
        });
      }
      const encoded = data?.data?.[0]?.b64_json;
      if (typeof encoded !== 'string' || !encoded.length) {
        return finish(502, { error: 'OpenAI API 未返回图片。', requestId: requestId ?? undefined });
      }
      const format = typeof data.output_format === 'string' && Object.hasOwn(formats, data.output_format)
        ? data.output_format
        : output_format;
      return finish(200, { image: encoded, contentType: formats[format], format }, encoded, format);
    } catch {
      const error = signal.aborted
        ? '等待 OpenAI API 响应超时。请稍后再试。'
        : '无法连接 OpenAI API，请检查本机网络。';
      finish(signal.aborted ? 504 : 502, { error, requestId: requestId ?? undefined });
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
