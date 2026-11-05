import { saveHistory } from './history.js';
import './cases.js';

const byId = (id) => document.getElementById(id);
const form = byId('generate-form');
const promptField = byId('prompt');
const keyField = byId('key');
const button = byId('generate');
const buttonLabel = byId('generate-label');
const canvas = byId('canvas');
const status = byId('status');
const errorMessage = byId('error');
const image = byId('image');
const download = byId('download');
const model = byId('model');
const format = byId('format');
const size = byId('size');
const quality = byId('quality');
const reuseStatus = byId('reuse-status');
const gifSettings = byId('gif-settings');
const gifInputs = [...gifSettings.querySelectorAll('input')];
const requestLog = byId('request-log');
const responseLog = byId('response-log');
let imageUrl;
let hasServerKey = false;
let stillSize = size.value;

function updateFormats() {
  byId('model-id').textContent = model.value;
  const supportsExtraFormats = model.selectedOptions[0].hasAttribute('data-extra-formats');
  if (!supportsExtraFormats && format.selectedOptions[0]?.hasAttribute('data-extra-format')) {
    format.value = 'png';
  }
  for (const option of format.querySelectorAll('[data-extra-format]')) {
    option.hidden = !supportsExtraFormats;
    option.disabled = !supportsExtraFormats;
  }
  const isGif = format.value === 'gif';
  if (isGif && gifSettings.hidden) {
    stillSize = size.value;
    size.value = 'auto';
  } else if (!isGif && !gifSettings.hidden) {
    size.value = stillSize;
  }
  gifSettings.hidden = !isGif;
  for (const input of gifInputs) input.disabled = !isGif;
}

model.addEventListener('change', updateFormats);
format.addEventListener('change', updateFormats);
updateFormats();

function restoreSelect(select, value) {
  if (![...select.options].some((option) => option.value === value)) return false;
  select.value = value;
  return true;
}

function restoreGenerationSettings(settings) {
  const unavailable = [];
  if (!restoreSelect(model, settings.model)) unavailable.push('模型');
  const formatFound = restoreSelect(format, settings.output_format);
  updateFormats();
  if (!formatFound || format.value !== settings.output_format) unavailable.push('格式');
  if (!restoreSelect(size, settings.size)) unavailable.push('尺寸');
  if (!restoreSelect(quality, settings.quality)) unavailable.push('画质');
  if (format.value === 'gif' && settings.output_format === 'gif') {
    for (const input of gifInputs) {
      const savedValue = settings[input.name];
      if (Number.isInteger(savedValue)) {
        input.valueAsNumber = savedValue;
      } else {
        unavailable.push(input.name === 'frame_count' ? 'GIF 帧数' : '单帧时长');
      }
    }
  }
  return unavailable.length
    ? `已回填可用参数。${unavailable.join('、')}无法恢复，请检查当前设置。`
    : '已回填提示词和生成参数。';
}

function fillPrompt(prompt, message) {
  promptField.value = prompt;
  reuseStatus.textContent = message;
  promptField.focus();
  promptField.setSelectionRange(promptField.value.length, promptField.value.length);
}

byId('history-dialog').addEventListener('history-reuse', ({ detail }) => {
  fillPrompt(detail.prompt, detail.settings ? restoreGenerationSettings(detail.settings) : '');
});

byId('cases').addEventListener('case-import', ({ detail }) => {
  fillPrompt(detail, '已导入案例提示词。可以修改后再生成。');
  promptField.scrollIntoView({ block: 'center' });
});

fetch('/api/config')
  .then((response) => response.json())
  .then((config) => {
    if (!config.hasServerKey) return;
    hasServerKey = true;
    keyField.disabled = true;
    keyField.value = '';
    byId('key-field').hidden = true;
    byId('key-ready').hidden = false;
  })
  .catch(() => {});

byId('sample').addEventListener('click', () => {
  promptField.value = '清晨的旧温室，一只橘猫坐在铺满苔藓的石阶上。晨光透过带水珠的玻璃，照亮空气中的雾气。低机位构图，纪实胶片摄影，自然的绿色和暖橘色。';
  promptField.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  const options = Object.fromEntries(new FormData(form));
  if (options.output_format === 'gif') {
    for (const input of gifInputs) options[input.name] = input.valueAsNumber;
  }
  options.prompt = options.prompt.trim();
  if (!options.prompt) {
    promptField.value = '';
    promptField.reportValidity();
    return;
  }

  button.disabled = true;
  buttonLabel.textContent = '正在生成…';
  canvas.setAttribute('aria-busy', 'true');
  status.textContent = 'OpenAI 正在生成图片';
  reuseStatus.textContent = '';
  errorMessage.hidden = true;
  const key = keyField.value.trim();
  const loggedPrompt = (key ? options.prompt.replaceAll(key, '[已隐藏]') : options.prompt)
    .replace(/sk-[a-zA-Z0-9_*-]+/g, '[已隐藏]');
  requestLog.textContent = JSON.stringify({ ...options, prompt: loggedPrompt, n: 1 }, null, 2);
  responseLog.textContent = '等待响应…';
  let loggedResponse = false;

  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!hasServerKey) headers['X-OpenAI-Key'] = key;
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify(options),
    });
    const result = await response.json().catch(() => null);
    if (result?.log) {
      requestLog.textContent = JSON.stringify(result.log.request, null, 2);
      responseLog.textContent = JSON.stringify(result.log.response, null, 2);
      loggedResponse = true;
    }
    if (!response.ok) {
      const message = result?.error ?? `请求失败（HTTP ${response.status}）。`;
      if (!loggedResponse) {
        responseLog.textContent = JSON.stringify({ local_status: response.status, error: message }, null, 2);
        loggedResponse = true;
      }
      throw new Error(result?.requestId ? `${message} 请求 ID ${result.requestId}` : message);
    }
    if (typeof result?.image !== 'string') throw new Error('本地服务未返回图片 JSON，请重启工作台后再试。');
    const decoded = atob(result.image);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    const blob = new Blob([bytes], { type: result.contentType });
    const nextUrl = URL.createObjectURL(blob);
    const nextImage = new Image();
    nextImage.src = nextUrl;
    try {
      await nextImage.decode();
    } catch {
      URL.revokeObjectURL(nextUrl);
      throw new Error('收到的图片无法解码。');
    }

    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = nextUrl;
    image.src = imageUrl;
    image.hidden = false;
    byId('empty').hidden = true;
    download.href = imageUrl;
    const extension = result.format === 'jpeg' ? 'jpg' : result.format;
    const createdAt = Date.now();
    const filename = `openai-image-${createdAt}.${extension}`;
    download.download = filename;
    download.hidden = false;
    byId('metadata').textContent = `${nextImage.naturalWidth} × ${nextImage.naturalHeight} · ${result.format.toUpperCase()}`;
    status.textContent = '生成完成';
    await saveHistory({
      createdAt,
      prompt: result.log?.request?.prompt ?? loggedPrompt,
      model: options.model,
      format: result.format,
      parameters: {
        size: options.size,
        quality: options.quality,
        output_format: options.output_format,
        ...(options.output_format === 'gif' && {
          frame_count: options.frame_count,
          frame_duration_ms: options.frame_duration_ms,
        }),
      },
      blob,
      filename,
    }).catch(() => {
      status.textContent = '生成完成，但历史记录保存失败。你仍可下载图片。';
    });
  } catch (error) {
    status.textContent = imageUrl ? '本次生成失败，仍显示上一张' : '生成失败';
    errorMessage.textContent = error instanceof TypeError ? '无法连接本地服务，请确认服务仍在运行。' : error.message;
    if (!loggedResponse) responseLog.textContent = JSON.stringify({ error: errorMessage.textContent }, null, 2);
    errorMessage.hidden = false;
  } finally {
    button.disabled = false;
    buttonLabel.textContent = '生成图片';
    canvas.removeAttribute('aria-busy');
  }
});
