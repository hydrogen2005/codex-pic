/**
 * Cloudflare Worker entry for image studio.
 * Handles /api/config and /api/generate routes; static assets served by Workers Static Assets.
 * @author lipeng
 */

import {
  formats,
  validateInput,
  validateKey,
  setSecurityHeaders,
  callOpenAI,
} from './openai-generate.mjs';


const CASE_IMAGE_PREFIX = '/case-image/';
const CASE_IMAGE_ORIGIN = 'https://cms-assets.youmind.com/';

async function proxyCaseImage(requestPath) {
  if (!requestPath.startsWith(CASE_IMAGE_PREFIX)) return null;
  const rest = requestPath.slice(CASE_IMAGE_PREFIX.length);
  if (!rest || rest.includes('..') || rest.startsWith('/') || rest.includes('\\')) {
    return jsonResponse(400, { error: '无效的案例图片路径。' });
  }
  let upstream;
  try {
    upstream = new URL(rest, CASE_IMAGE_ORIGIN);
  } catch {
    return jsonResponse(400, { error: '无效的案例图片路径。' });
  }
  if (upstream.origin !== 'https://cms-assets.youmind.com' || !upstream.pathname.startsWith('/')) {
    return jsonResponse(400, { error: '无效的案例图片路径。' });
  }
  const doFetch = globalThis.fetch.bind(globalThis);
  let upstreamResponse;
  try {
    upstreamResponse = await doFetch(upstream, {
      headers: {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://youmind.com/',
      },
    });
  } catch {
    return jsonResponse(502, { error: '案例图片暂时无法读取。' });
  }
  if (!upstreamResponse.ok) {
    return jsonResponse(upstreamResponse.status === 404 ? 404 : 502, { error: '案例图片暂时无法读取。' });
  }
  const contentType = upstreamResponse.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.startsWith('image/')) {
    return jsonResponse(502, { error: '案例图片暂时无法读取。' });
  }
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=86400',
  });
  setSecurityHeaders(headers);
  return new Response(upstreamResponse.body, { status: 200, headers });
}

function jsonResponse(status, body, extraHeaders = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  setSecurityHeaders(headers);
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJsonBody(request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 128 * 1024) {
    throw new RangeError('Request too large');
  }
  const text = await request.text();
  if (text.length > 128 * 1024) throw new RangeError('Request too large');
  return JSON.parse(text);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/config' && request.method === 'GET') {
      const apiKey = env.OPENAI_API_KEY?.trim();
      return jsonResponse(200, { hasServerKey: Boolean(apiKey) });
    }

    if (request.method === 'GET') {
      const proxied = await proxyCaseImage(path);
      if (proxied) return proxied;
    }

    if (path !== '/api/generate' || request.method !== 'POST') {
      // With Workers Static Assets, non-/api routes are normally served by ASSETS.
      // Self-contained deploys handle static files separately; keep 404 for unknown API paths.
      return jsonResponse(404, { error: '页面不存在。' });
    }

    const contentType = request.headers.get('content-type')?.split(';')[0];
    if (contentType !== 'application/json') {
      return jsonResponse(415, { error: '请求须使用 JSON 格式。' });
    }

    let input;
    try {
      input = await readJsonBody(request);
    } catch (error) {
      const status = error instanceof RangeError ? 413 : 400;
      return jsonResponse(status, { error: '请求内容无效或过长。' });
    }

    const validation = validateInput(input);
    if (!validation.valid) {
      return jsonResponse(400, { error: validation.error });
    }

    const apiKey = env.OPENAI_API_KEY?.trim() || request.headers.get('x-openai-key')?.trim();
    if (!validateKey(apiKey)) {
      return jsonResponse(400, { error: '请输入有效的 OpenAI API Key。' });
    }

    const wantsJson = request.headers.get('accept') === 'application/json';
    const result = await callOpenAI({ payload: validation.payload, key: apiKey });

    if (wantsJson) {
      return jsonResponse(result.status, {
        ...result.body,
        log: { request: result.requestLog, response: result.responseLog },
      });
    }

    if (!result.success) {
      return jsonResponse(result.status, result.body);
    }

    const headers = new Headers({ 'Content-Type': formats[result.format] });
    setSecurityHeaders(headers);
    if (result.format === 'svg') {
      headers.set('Content-Disposition', 'attachment; filename="openai-image.svg"');
    }

    const binaryString = atob(result.encoded);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Response(bytes, { status: 200, headers });
  },
};
