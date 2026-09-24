import { snapdom } from 'https://esm.sh/@zumer/snapdom@3.0.0';
import { GIFEncoder, quantize, applyPalette } from 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/src/index.js';
import DOMPurify from 'https://esm.sh/dompurify@3.2.6';
import UPNG from 'https://esm.sh/upng-js@2.1.0';
import JSZip from 'https://esm.sh/jszip@3.10.1';

const ldrs = `Ring:ring|Ring 2:ring-2|Tailspin:tailspin|Line Spinner:line-spinner|Squircle:squircle|Square:square|Reuleaux:reuleaux|Tail Chase:tail-chase|Dot Spinner:dot-spinner|Spiral:spiral|Bouncy:bouncy|Treadmill:treadmill|Bouncy Arc:bouncy-arc|Waveform:waveform|Hatch:hatch|Hourglass:hourglass|Zoomies:zoomies|Line Wobble:line-wobble|Infinity:infinity|Trefoil:trefoil|Cardio:cardio|Helix:helix|Grid:grid|Quantum:quantum|Wobble:wobble|Orbit:orbit|Chaotic Orbit:chaotic-orbit|Superballs:superballs|Trio:trio|Momentum:momentum|Dot Wave:dot-wave|Leapfrog:leapfrog|Newton's Cradle:newtons-cradle|Dot Stream:dot-stream|Dot Pulse:dot-pulse|Metronome:metronome|Jelly:jelly|Jelly Triangle:jelly-triangle|Mirage:mirage|Ping:ping|Pulsar:pulsar|Ripples:ripples|Miyagi:miyagi|Pinwheel:pinwheel`.split('|').map((part) => { const [name, slug] = part.split(':'); return { name, slug, module: slug.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase()), type: 'ldrs' }; });
const $ = (id) => document.getElementById(id);
const stage = $('capture-stage'), mount = $('animation-mount'), list = $('asset-list'), exportButton = $('export');
let source = 'url', assets = [], selected = null, busy = false, loadId = 0, outputUrls = [];

function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function safeName(name) { return (name || 'animation').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'animation'; }
function clearResults() { $('result').hidden = true; $('result-preview').hidden = false; $('result-links').replaceChildren(); for (const url of outputUrls) URL.revokeObjectURL(url); outputUrls = []; }
function renderList() {
  const query = $('search').value.trim().toLowerCase();
  list.replaceChildren();
  for (const asset of assets.filter((item) => item.name.toLowerCase().includes(query))) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'preset-item' + (selected === asset ? ' selected' : '');
    button.textContent = asset.name; button.title = asset.sourceUrl || asset.name;
    button.setAttribute('aria-pressed', String(selected === asset));
    button.addEventListener('click', () => loadAsset(asset)); list.append(button);
  }
  if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'preset-empty'; empty.textContent = assets.length ? '没有匹配的动画' : '扫描后将在这里显示 SVG'; list.append(empty); }
  $('asset-count').textContent = assets.length ? `${assets.length} 个` : '';
  $('batch-export').disabled = busy || !assets.length;
}
function updateLdrs() {
  if (selected?.type !== 'ldrs' || !mount.firstElementChild) return;
  const element = mount.firstElementChild;
  element.setAttribute('size', $('size').value); element.setAttribute('speed', $('speed').value); element.setAttribute('color', $('color').value);
}
function prepareSvg(text) {
  const opening = text.match(/<svg\b[^>]*>/i)?.[0];
  if (opening && !/\sxmlns\s*=/.test(opening)) text = text.replace(opening, opening.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"'));
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('SVG 格式不正确');
  const cleaned = DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['style', 'animate', 'animateTransform', 'animateMotion', 'set', 'mpath'], FORBID_TAGS: ['script', 'foreignObject', 'image', 'iframe', 'a'] });
  const svg = new DOMParser().parseFromString(cleaned, 'image/svg+xml').documentElement;
  if (svg.localName !== 'svg') throw new Error('SVG 内容无法安全预览');
  for (const node of svg.querySelectorAll('*')) {
    if (['animate', 'animateTransform', 'animateMotion', 'set'].includes(node.localName) && /^(href|xlink:href|style|src)$/i.test(node.getAttribute('attributeName') || '')) { node.remove(); continue; }
    for (const attr of [...node.attributes]) {
      if (/^(href|xlink:href)$/i.test(attr.name) && attr.value && !attr.value.startsWith('#')) node.removeAttribute(attr.name);
      else if (/url\s*\(/i.test(attr.value) && !/^url\s*\(\s*['"]?#[^)]+\)/i.test(attr.value)) node.removeAttribute(attr.name);
    }
  }
  for (const style of svg.querySelectorAll('style')) style.textContent = style.textContent.replace(/@import\s+[^;]+;?/gi, '').replace(/url\s*\((?!\s*['"]?#)[^)]*\)/gi, 'none');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width')) || 100} ${parseFloat(svg.getAttribute('height')) || 100}`);
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.style.width = `${$('size').value}px`; svg.style.height = `${$('size').value}px`;
  svg.style.color = $('color').value;
  return document.importNode(svg, true);
}
async function loadAsset(asset, force = false) {
  if (busy && !force) return;
  const token = ++loadId; selected = asset; clearResults(); renderList();
  $('selected-label').textContent = asset.name; exportButton.disabled = true; status(`正在加载 ${asset.name}…`);
  try {
    let element;
    if (asset.type === 'ldrs') { await import(`https://esm.sh/ldrs@1.1.9/${asset.module}`); element = document.createElement(`l-${asset.slug}`); }
    else element = prepareSvg(asset.svg);
    if (token !== loadId) return;
    mount.replaceChildren(element); updateLdrs(); exportButton.disabled = false; status('预览已就绪，可录制导出。');
  } catch (error) { if (token !== loadId) return; mount.replaceChildren(); status(`加载失败：${error.message || '未知错误'}`, true); }
}
function setTab(next) {
  if (busy) return; source = next; const urlMode = next === 'url';
  $('url-view').hidden = !urlMode; $('svg-view').hidden = urlMode;
  for (const [name, active] of [['url', urlMode], ['svg', !urlMode]]) { $(`${name}-tab`).classList.toggle('active', active); $(`${name}-tab`).setAttribute('aria-selected', String(active)); }
  if (urlMode && selected && assets.includes(selected)) loadAsset(selected);
  else { ++loadId; selected = null; mount.replaceChildren(); exportButton.disabled = true; $('selected-label').textContent = urlMode ? '等待选择' : '自定义 SVG'; clearResults(); status(urlMode ? '输入网址并扫描 SVG。' : '请选择 SVG 文件或粘贴 SVG 代码。'); }
  renderList();
}
async function fetchText(url) {
  let proxyResponse;
  try { proxyResponse = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`); }
  catch (_) { /* Static GitHub Pages: try a CORS-enabled public URL directly. */ }
  if (proxyResponse?.headers.get('content-type')?.includes('application/json')) {
    const data = await proxyResponse.json();
    if (!proxyResponse.ok) throw new Error(data.error || `HTTP ${proxyResponse.status}`);
    return data;
  }
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 3_000_000) throw new Error('网页内容超过 3 MB');
  return { text, url: response.url, contentType: response.headers.get('content-type') || '' };
}
function isSvgUrl(url) { try { return new URL(url).pathname.toLowerCase().endsWith('.svg'); } catch (_) { return false; } }
async function scanUrl() {
  if (busy) return;
  let input;
  try { input = new URL($('page-url').value.trim()); if (!['https:', 'http:'].includes(input.protocol)) throw new Error(); }
  catch (_) { $('scan-status').textContent = '请输入完整的 http:// 或 https:// 地址。'; return; }
  $('scan-url').disabled = true; $('scan-status').textContent = '正在扫描网页…';
  assets = []; selected = null; mount.replaceChildren(); exportButton.disabled = true; clearResults(); renderList();
  try {
    if (/(^|\.)uiball\.com$/i.test(input.hostname) && /^\/ldrs\/?$/i.test(input.pathname)) {
      assets = [...ldrs];
      $('scan-status').textContent = `识别到 LDRS 动态动画：${assets.length} 款。可逐个导出或打包全部。`;
    } else {
      const page = await fetchText(input.href);
      if (page.contentType.includes('image/svg+xml') || isSvgUrl(page.url)) assets = [{ name: safeName(new URL(page.url).pathname.split('/').pop().replace(/\.svg$/i, '')), type: 'svg', svg: page.text, sourceUrl: page.url }];
      else {
        const doc = new DOMParser().parseFromString(page.text, 'text/html');
        const inline = [...doc.querySelectorAll('svg')].filter((node) => !node.parentElement?.closest('svg'));
        assets.push(...inline.map((node, index) => ({ name: `Inline SVG ${index + 1}`, type: 'svg', svg: node.outerHTML, sourceUrl: page.url })));
        const refs = new Set();
        for (const node of doc.querySelectorAll('img[src], object[data], embed[src], a[href]')) {
          const raw = node.getAttribute('src') || node.getAttribute('data') || node.getAttribute('href');
          if (!raw) continue;
          try { const ref = new URL(raw, page.url).href; if (isSvgUrl(ref)) refs.add(ref); } catch (_) { /* Ignore invalid URLs. */ }
        }
        for (const match of page.text.matchAll(/url\(\s*['"]?([^)'"\s]+\.svg(?:\?[^)'"\s]*)?)['"]?\s*\)/gi)) {
          try { refs.add(new URL(match[1], page.url).href); } catch (_) { /* Ignore invalid URLs. */ }
        }
        const external = await Promise.allSettled([...refs].slice(0, 100).map(async (ref, index) => {
          const data = await fetchText(ref);
          return { name: decodeURIComponent(new URL(ref).pathname.split('/').pop()).replace(/\.svg$/i, '') || `SVG ${index + 1}`, type: 'svg', svg: data.text, sourceUrl: ref };
        }));
        assets.push(...external.filter((result) => result.status === 'fulfilled').map((result) => result.value));
      }
      $('scan-status').textContent = `找到 ${assets.length} 个 SVG。扫描静态 HTML 和 SVG 文件；运行后生成的内容需要专门适配。`;
    }
    renderList();
    if (assets.length) await loadAsset(assets[0]); else status('该网页没有找到可导出的 SVG。', true);
  } catch (error) {
    const message = error instanceof TypeError ? '目标网站禁止跨域读取；完整网址扫描需要运行项目自带的服务端。' : error.message;
    $('scan-status').textContent = `扫描失败：${message}`; status('网页扫描失败。', true);
  } finally { $('scan-url').disabled = false; }
}
function options() { return { resolution: Number($('resolution').value), fps: Number($('fps').value), duration: Number($('duration').value), background: $('background').value, maxColors: Number($('colors').value), format: $('format').value }; }
function animatedValue(target, name) {
  const prop = target[name];
  const value = prop?.animVal;
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (value && typeof value.value === 'number') return String(value.value);
  if (value?.consolidate) {
    const matrix = value.consolidate()?.matrix;
    if (matrix) return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
  }
  return getComputedStyle(target).getPropertyValue(name) || target.getAttribute(name);
}
function freezeSmil(svg, timeMs) {
  svg.pauseAnimations();
  svg.setCurrentTime(timeMs / 1000);
  const clone = svg.cloneNode(true);
  const originals = [svg, ...svg.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  for (const animation of svg.querySelectorAll('animate, animateTransform, animateMotion, set')) {
    const name = animation.getAttribute('attributeName') || (animation.localName === 'animateMotion' ? 'transform' : null);
    if (!name) continue;
    const target = animation.parentElement;
    const copy = copies[originals.indexOf(target)];
    const value = animatedValue(target, name);
    if (copy && value) copy.setAttribute(name, value);
  }
  clone.querySelectorAll('animate, animateTransform, animateMotion, set, mpath').forEach((animation) => animation.remove());
  return clone;
}
async function captureFrames(o) {
  const delay = Math.round(1000 / o.fps), count = Math.max(2, Math.round(o.duration / delay));
  const frames = [], start = performance.now();
  const svg = selected?.type === 'svg' ? mount.querySelector('svg') : null;
  const hasSmil = !!svg?.querySelector('animate, animateTransform, animateMotion, set');
  let offscreen = null;
  if (hasSmil) {
    offscreen = stage.cloneNode(false);
    offscreen.removeAttribute('id');
    offscreen.style.cssText = `position:fixed;left:-10000px;top:0;width:256px;height:256px;box-shadow:none;background:${o.background}`;
    document.body.append(offscreen);
  }
  try {
    for (let i = 0; i < count; i++) {
      if (!hasSmil) {
        const wait = start + i * delay - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      } else {
        offscreen.replaceChildren(freezeSmil(svg, i * delay));
      }
      const canvas = await snapdom.toCanvas(offscreen || stage, { width: o.resolution, height: o.resolution, dpr: 1, backgroundColor: o.background, invalidate: true });
      const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, o.resolution, o.resolution).data;
      frames.push(new Uint8Array(pixels));
    }
  } finally {
    offscreen?.remove();
    if (hasSmil) svg.unpauseAnimations();
  }
  return { frames, delay };
}
async function produce(o) {
  const { frames, delay } = await captureFrames(o);
  const files = [];
  if (o.format !== 'apng') {
    const gif = GIFEncoder();
    frames.forEach((rgba, index) => {
      const palette = quantize(rgba, o.maxColors);
      const pixels = applyPalette(rgba, palette);
      gif.writeFrame(pixels, o.resolution, o.resolution, { palette, delay, repeat: index === 0 ? 0 : undefined, dispose: 2 });
    });
    gif.finish();
    files.push({ extension: 'gif', blob: new Blob([gif.bytes()], { type: 'image/gif' }) });
  }
  if (o.format !== 'gif') files.push({ extension: 'png', blob: new Blob([UPNG.encode(frames.map((frame) => frame.buffer), o.resolution, o.resolution, 0, Array(frames.length).fill(delay))], { type: 'image/png' }) });
  for (const file of files) if (file.blob.size < 100) throw new Error(`${file.extension.toUpperCase()} 文件为空`);
  return files;
}
function showFiles(files, name) {
  clearResults();
  for (const file of files) {
    const url = URL.createObjectURL(file.blob); outputUrls.push(url);
    const link = document.createElement('a'); link.className = 'download-link'; link.href = url;
    link.download = `${safeName(name)}-${$('resolution').value}px.${file.extension}`;
    link.textContent = file.extension === 'gif' ? '下载 GIF ↓' : file.extension === 'png' ? '下载无损 APNG ↓' : '下载 ZIP ↓';
    $('result-links').append(link);
  }
  if (files[0].extension === 'zip') $('result-preview').hidden = true;
  else $('result-preview').src = outputUrls[0];
  $('result').hidden = false;
}
async function exportOne() {
  if (busy || !mount.firstElementChild) return;
  busy = true; exportButton.disabled = true; $('batch-export').disabled = true; exportButton.textContent = '正在录制…'; clearResults(); status('正在录制并编码，请保持页面打开…');
  try { const files = await produce(options()); showFiles(files, selected?.name); status(`完成：${files.map((file) => `${file.extension.toUpperCase()} ${Math.round(file.blob.size / 1024)} KB`).join(' · ')}`); }
  catch (error) { console.error(error); status(`导出失败：${error.message || '请降低分辨率和帧率后重试'}`, true); }
  finally { busy = false; exportButton.disabled = !mount.firstElementChild; exportButton.innerHTML = '录制并导出 <span aria-hidden="true">↗</span>'; renderList(); }
}
async function exportAll() {
  if (busy || !assets.length) return;
  busy = true; exportButton.disabled = true; $('scan-url').disabled = true; $('batch-export').disabled = true; clearResults();
  const zip = new JSZip(), o = options(); let succeeded = 0;
  try {
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]; status(`批量导出 ${i + 1}/${assets.length}：${asset.name}`);
      try {
        let element;
        if (asset.type === 'ldrs') { await import(`https://esm.sh/ldrs@1.1.9/${asset.module}`); element = document.createElement(`l-${asset.slug}`); }
        else element = prepareSvg(asset.svg);
        mount.replaceChildren(element); selected = asset; updateLdrs();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        for (const file of await produce(o)) zip.file(`${String(i + 1).padStart(3, '0')}-${safeName(asset.name)}.${file.extension}`, file.blob);
        succeeded++;
      } catch (error) { zip.file(`errors/${String(i + 1).padStart(3, '0')}-${safeName(asset.name)}.txt`, String(error.message || error)); }
    }
    if (!succeeded) throw new Error('所有动画都导出失败');
    status('正在打包 ZIP…'); showFiles([{ extension: 'zip', blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }) }], 'svg-animations');
    status(`已打包 ${succeeded}/${assets.length} 个动画。`);
  } catch (error) { status(`批量导出失败：${error.message}`, true); }
  finally { busy = false; $('scan-url').disabled = false; $('selected-label').textContent = selected?.name || '等待选择'; exportButton.disabled = !mount.firstElementChild; renderList(); }
}

$('url-tab').addEventListener('click', () => setTab('url'));
$('svg-tab').addEventListener('click', () => setTab('svg'));
$('search').addEventListener('input', renderList);
$('scan-url').addEventListener('click', scanUrl);
$('page-url').addEventListener('keydown', (event) => { if (event.key === 'Enter') scanUrl(); });
$('batch-export').addEventListener('click', exportAll);
$('apply-svg').addEventListener('click', () => loadAsset({ name: '自定义 SVG', type: 'svg', svg: $('svg-code').value }));
$('svg-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  if (file.size > 2_000_000) { status('SVG 文件请小于 2 MB。', true); return; }
  const svg = await file.text(); $('svg-code').value = svg; loadAsset({ name: file.name, type: 'svg', svg });
});
for (const id of ['color', 'background', 'size', 'speed']) $(id).addEventListener('input', () => {
  if (id === 'color' || id === 'background') $(`${id}-value`).textContent = $(id).value.toUpperCase();
  if (id === 'size') $('size-value').textContent = `${$('size').value} px`;
  if (id === 'speed') $('speed-value').textContent = `${$('speed').value} s`;
  stage.style.backgroundColor = $('background').value;
  if (selected?.type === 'svg' && mount.firstElementChild) { mount.firstElementChild.style.width = `${$('size').value}px`; mount.firstElementChild.style.height = `${$('size').value}px`; mount.firstElementChild.style.color = $('color').value; }
  updateLdrs(); clearResults();
});
for (const id of ['resolution', 'fps', 'duration', 'format', 'colors']) $(id).addEventListener('change', clearResults);
exportButton.addEventListener('click', exportOne);
renderList(); status('输入网址并扫描 SVG。');
