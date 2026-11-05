const list = document.getElementById('history-list');
const status = document.getElementById('history-status');
const dialog = document.getElementById('history-dialog');
const preview = document.getElementById('history-image');
const download = document.getElementById('history-download');
const historyPrompt = document.getElementById('history-prompt');
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' });
let databasePromise;
let previewUrl;
let generationSettings;
let thumbnailUrls = [];

function openDatabase() {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('image-studio-history', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('generations', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

async function accessHistory(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('generations', mode);
    const request = operation(transaction.objectStore('generations'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

function describe(record) {
  return `${dateFormat.format(record.createdAt)} · ${record.model} · ${record.format.toUpperCase()}`;
}

async function showRecord(id) {
  try {
    const record = await accessHistory('readonly', (store) => store.get(id));
    if (!record) throw new Error('Missing history record');
    if (dialog.open) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(record.blob);
    preview.src = previewUrl;
    download.href = previewUrl;
    download.download = record.filename;
    document.getElementById('history-meta').textContent = describe(record);
    historyPrompt.textContent = record.prompt;
    generationSettings = { model: record.model, output_format: record.format, ...record.parameters };
    dialog.showModal();
  } catch {
    status.textContent = '无法打开这条历史记录。';
  }
}

function historyRow({ id, prompt, createdAt, model, format }, thumbnailUrl) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  const thumbnail = document.createElement('img');
  thumbnail.className = 'history-thumbnail';
  thumbnail.alt = '';
  thumbnail.loading = 'lazy';
  thumbnail.decoding = 'async';
  thumbnail.src = thumbnailUrl;
  const caption = document.createElement('div');
  caption.className = 'history-caption';
  const snippet = document.createElement('span');
  snippet.textContent = prompt.length > 160 ? `${prompt.slice(0, 160)}…` : prompt;
  const detail = document.createElement('small');
  detail.textContent = describe({ createdAt, model, format });
  caption.append(snippet, detail);
  button.append(thumbnail, caption);
  button.addEventListener('click', () => void showRecord(id));
  item.append(button);
  return item;
}

async function loadHistory() {
  const records = await accessHistory('readonly', (store) => store.getAll());
  const rows = document.createDocumentFragment();
  const nextUrls = [];
  for (const record of records.reverse()) {
    const thumbnailUrl = URL.createObjectURL(record.blob);
    nextUrls.push(thumbnailUrl);
    rows.append(historyRow(record, thumbnailUrl));
  }
  list.replaceChildren(rows);
  for (const url of thumbnailUrls) URL.revokeObjectURL(url);
  thumbnailUrls = nextUrls;
  status.textContent = records.length ? `共 ${records.length} 张图像` : '暂无记录。成功生成的图像会自动保存在这里。';
}

export async function saveHistory(record) {
  await accessHistory('readwrite', (store) => store.add(record));
  await loadHistory().catch(() => {
    status.textContent = '已保存，刷新页面后可重新读取历史记录。';
  });
}

document.getElementById('history-close').addEventListener('click', () => dialog.close());
function reuseHistory(settings) {
  const detail = { prompt: historyPrompt.textContent, settings };
  dialog.close();
  dialog.dispatchEvent(new CustomEvent('history-reuse', { detail }));
}

document.getElementById('history-reuse').addEventListener('click', () => reuseHistory());
document.getElementById('history-reuse-settings').addEventListener('click', () => reuseHistory(generationSettings));
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  generationSettings = undefined;
  preview.removeAttribute('src');
  download.removeAttribute('href');
});

loadHistory().catch(() => {
  status.textContent = '无法读取历史记录，请检查浏览器是否允许本地存储。';
});
