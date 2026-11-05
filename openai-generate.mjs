/**
 * Shared OpenAI image generation logic for both Node server and Cloudflare Worker.
 * @author lipeng
 */

export const sizes = ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152'];
export const qualities = ['auto', 'low', 'medium', 'high'];
export const formats = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};
export const vectorAndAnimationModels = new Set(['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare']);
export const endpoint = 'https://api.openai.com/v1/images/generations';

export function logBody(body, key) {
  return JSON.parse(JSON.stringify(body, (field, value) => {
    if (field === 'b64_json' && typeof value === 'string') {
      return `[省略 Base64，共 ${value.length} 字符]`;
    }
    if (/^(authorization|api_?key|x-openai-key)$/i.test(field)) return '[已隐藏]';
    if (typeof value !== 'string') return value;
    return value.replaceAll(key, '[已隐藏]').replace(/sk-[a-zA-Z0-9_*-]+/g, '[已隐藏]');
  }));
}

export function openAIError(status, code) {
  if (code === 'model_not_found') return '当前项目无法使用此模型。请核对模型 ID 和项目权限。';
  if (code === 'billing_hard_limit_reached' || code === 'insufficient_quota') return 'OpenAI API 额度不足，请检查项目账单和使用限额。';
  if (code === 'content_policy_violation' || code === 'moderation_blocked') return '提示词未通过内容审核，请调整后再试。';
  if (status === 401) return 'OpenAI API Key 无效，请检查密钥。';
  if (status === 403) return 'OpenAI 拒绝了请求，请检查项目权限和组织验证状态。';
  if (status === 429) return 'OpenAI API 请求达到频率或额度限制，请检查限额后再试。';
  if (status === 400) return 'OpenAI 拒绝了生成参数，请检查模型、尺寸、画质和输出格式。';
  return 'OpenAI API 暂时无法完成请求，请稍后再试。';
}

export function validateInput(input) {
  const { prompt, model, size, quality, output_format, frame_count, frame_duration_ms } = input ?? {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000 ||
      typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model) ||
      !sizes.includes(size) || !qualities.includes(quality) ||
      typeof output_format !== 'string' || !Object.hasOwn(formats, output_format)) {
    return { valid: false, error: '请填写提示词并检查生成参数。' };
  }
  if ((output_format === 'gif' || output_format === 'svg') && !vectorAndAnimationModels.has(model)) {
    return { valid: false, error: 'GIF 和 SVG 输出需要选择 GPT Image 2.6 Sunburst 或 Flare。' };
  }
  const payload = { model, prompt: prompt.trim(), size, quality, output_format, n: 1 };
  if (output_format === 'gif') {
    const frames = frame_count === undefined ? 9 : frame_count;
    const duration = frame_duration_ms === undefined ? 200 : frame_duration_ms;
    if (!Number.isInteger(frames) || frames < 2 || frames > 64 ||
        !Number.isInteger(duration) || duration < 20 || duration > 2000) {
      return { valid: false, error: 'GIF 帧数须为 2–64，单帧时长须为 20–2000 毫秒。' };
    }
    payload.frame_count = frames;
    payload.frame_duration_ms = duration;
  }
  return { valid: true, payload };
}

export function validateKey(key) {
  return key && /^[\x21-\x7e]{1,512}$/.test(key);
}

export const CSP_HEADER = "default-src 'self'; img-src 'self' blob: https://cms-assets.youmind.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function setSecurityHeaders(headers) {
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Content-Security-Policy', CSP_HEADER);
}

export async function callOpenAI({ payload, key, signal, send }) {
  const doFetch = send ?? globalThis.fetch.bind(globalThis);
  const started = Date.now();
  const requestLog = logBody(payload, key);
  let upstreamStatus = null;
  let requestId = null;
  let data = null;

  try {
    const result = await doFetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    upstreamStatus = result.status;
    const id = result.headers.get('x-request-id');
    requestId = /^req_[\w-]{1,100}$/.test(id ?? '') ? id : null;
    const aborted = signal?.aborted ?? false;
    data = await result.json().catch((error) => {
      if (aborted) throw error;
      return null;
    });
    if (!result.ok) {
      return {
        success: false,
        status: result.status >= 500 ? 502 : result.status,
        body: {
          error: openAIError(result.status, data?.error?.code),
          requestId: requestId ?? undefined,
        },
        requestLog,
        responseLog: makeResponseLog({ model: payload.model, data, upstreamStatus, requestId, started, key }),
      };
    }
    const encoded = data?.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || !encoded.length) {
      return {
        success: false,
        status: 502,
        body: { error: 'OpenAI API 未返回图片。', requestId: requestId ?? undefined },
        requestLog,
        responseLog: makeResponseLog({ model: payload.model, data, upstreamStatus, requestId, started, key }),
      };
    }
    const format = typeof data.output_format === 'string' && Object.hasOwn(formats, data.output_format)
      ? data.output_format
      : payload.output_format;
    return {
      success: true,
      status: 200,
      encoded,
      format,
      body: { image: encoded, contentType: formats[format], format },
      requestLog,
      responseLog: makeResponseLog({ model: payload.model, data, upstreamStatus, requestId, started, key }),
    };
  } catch (err) {
    const aborted = signal?.aborted ?? false;
    const userError = aborted
      ? '等待 OpenAI API 响应超时。请稍后再试。'
      : '无法连接 OpenAI API，请检查本机网络。';
    const logDetail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return {
      success: false,
      status: aborted ? 504 : 502,
      body: { error: userError, requestId: requestId ?? undefined },
      requestLog,
      responseLog: makeResponseLog({ model: payload.model, data, upstreamStatus, requestId, started, key, localError: logDetail }),
    };
  }
}

function makeResponseLog({ model, data, upstreamStatus, requestId, started, key, localError }) {
  return logBody({
    requested_model: model,
    returned_model: typeof data?.model === 'string' ? data.model : null,
    openai_status: upstreamStatus,
    request_id: requestId,
    elapsed_ms: Date.now() - started,
    body: data,
    local_error: localError,
  }, key);
}
