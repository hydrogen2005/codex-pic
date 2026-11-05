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

    if (path !== '/api/generate' || request.method !== 'POST') {
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
