const section = document.getElementById('cases');
const query = document.getElementById('case-query');
const category = document.getElementById('case-category');
const grid = document.getElementById('case-grid');
const status = document.getElementById('case-status');
const pages = document.getElementById('case-pages');
const previous = document.getElementById('case-prev');
const next = document.getElementById('case-next');
const pageLabel = document.getElementById('case-page');
const pageSize = 12;
let page = 0;
let cases = [];

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function link(label, url) {
  const node = element('a', 'text-button', label);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function caseCard(item) {
  const card = element('article', 'case-card');
  const preview = element('div', 'case-preview');
  const placeholder = element('small', '', '样图暂不可用');
  preview.append(placeholder);
  if (item.image) {
    placeholder.hidden = true;
    const image = element('img');
    image.alt = item.title + '的生成样图';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.hidden = true;
      placeholder.hidden = false;
    }, { once: true });
    // YouMind CDN hotlink-protects foreign Referers; serve via same-origin proxy.
    const prefix = 'https://cms-assets.youmind.com/';
    image.src = item.image.startsWith(prefix)
      ? '/case-image/' + item.image.slice(prefix.length)
      : item.image;
    preview.append(image);
  }
  const body = element('div', 'case-body');
  body.append(
    element('small', 'case-category', item.category),
    element('h3', '', item.title),
    element('p', '', item.description),
  );
  if (item.author) body.append(element('small', 'case-author', item.author));
  const details = element('details');
  details.append(element('summary', '', '查看提示词'), element('pre', '', item.prompt));
  const actions = element('div', 'case-actions');
  const use = element('button', 'case-button case-import', '导入工作台');
  use.type = 'button';
  use.addEventListener('click', () => {
    const prompt = item.prompt.replace(/\{argument name=(\\?")[^{}\r\n]*?\1 default=\1([^{}\r\n]*?)\1\}/g, (_match, _quote, value) => value);
    section.dispatchEvent(new CustomEvent('case-import', { detail: prompt }));
  });
  actions.append(use, link('案例来源 ↗', item.url));
  if (item.original) actions.append(link('原帖 ↗', item.original));
  body.append(details, actions);
  card.append(preview, body);
  return card;
}

function render() {
  const words = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = cases.filter((item) =>
    (!category.value || item.category === category.value) &&
    words.every((word) => item.search.includes(word)),
  );
  const totalPages = Math.ceil(matches.length / pageSize);
  grid.replaceChildren(...matches.slice(page * pageSize, (page + 1) * pageSize).map(caseCard));
  status.textContent = matches.length ? `找到 ${matches.length} 条案例` : '没有匹配的案例，试试其他关键词或分类。';
  pages.hidden = totalPages < 2;
  pageLabel.textContent = `第 ${page + 1} / ${totalPages} 页`;
  previous.disabled = page === 0;
  next.disabled = page + 1 >= totalPages;
}

function resetSearch() {
  page = 0;
  render();
}

async function loadCases() {
  try {
    const response = await fetch('/cases.json');
    if (!response.ok) throw new Error('Unable to load case data');
    const data = await response.json();
    cases = data.cases.map((item) => ({
      ...item,
      search: [item.title, item.category, item.description, item.author, item.prompt].join('\n').toLowerCase(),
    }));
    for (const name of new Set(cases.map((item) => item.category))) category.add(new Option(name, name));
    query.addEventListener('input', resetSearch);
    category.addEventListener('change', resetSearch);
    previous.addEventListener('click', () => {
      page--;
      render();
      section.scrollIntoView();
    });
    next.addEventListener('click', () => {
      page++;
      render();
      section.scrollIntoView();
    });
    render();
  } catch {
    status.textContent = '案例库暂时无法读取，可打开中文 README 查看。';
  }
}

void loadCases();
