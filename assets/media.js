/* DARK CODE · 미디어 엔진 (window.DCMedia)
 * 실사 사진·영상 자동 삽입, AI 실사 이미지, 나레이션(TTS) 연결부
 *  사진: Pexels → Unsplash (무료 키) → Wikimedia Commons → Openverse (키 없음 · CC 라이선스 · 출처 자동 표기)
 *  영상: Pexels → Pixabay (무료 키)
 *  AI 실사 이미지: Pollinations (pollen 키) → 키가 없으면 Classic API 재시도
 *  나레이션: Gemini TTS (무료 등급 키) → Azure Speech (F0 키)
 * 키는 DARK CODE 암호화 금고에서 setKeys() 로만 받고, 결과 HTML 에는 절대 넣지 않는다.
 * 사람이 나오는 검색어는 국적 지정이 없으면 korean 을 붙인다 (일러스트·애니 요청이 아니면 실사 기준).
 */
(function () {
  'use strict';
  const KEYS = { pexels: '', unsplash: '', pixabay: '', pollinations: '', gemini: '', azure: '', azureRegion: 'koreacentral' };
  const mem = new Map();
  const BLOCK = /(north[\s_-]?korea|pyongyang|dprk|\bwar\b|protest|funeral|military|soldier|navy|naval|\barmy\b|marines?\b|air force|troops|veteran|weapon|\bgun\b|nude|naked|blood|injur|accident|riot|demonstrat|propaganda)/i;
  const PEOPLE = /\b(people|person|man|men|woman|women|girl|boy|doctor|dentist|nurse|patient|staff|team|family|couple|child|children|kid|student|teacher|customer|client|worker|surgeon|therapist|physician|receptionist|chef|barista|trainer|portrait|smiling|face|businessman|businesswoman|employee|senior|elderly|mother|father|baby)\b/i;
  const NATION = /\b(korean|asian|japanese|chinese|american|european|african|indian|caucasian|black|white|latino|hispanic|western|arab)\b/i;
  const STYLE = /(anime|illustration|cartoon|watercolor|vector|flat design|3d render|pixel art|sketch|line art|clay|일러스트|애니|만화|그림체|수채화|픽셀|캐릭터)/i;
  const ART = /(painting|google art project|museum|drawing|engraving|illustration|lithograph|etching|\bmap\b|logo|diagram|poster|stamp|coin|banknote|manuscript|sketch|watercolou?r|fresco|statue|sculpture|\b1[5-9]\d\d\b)/i;

  const setKeys = (k) => { Object.keys(k || {}).forEach((n) => { if (n in KEYS && typeof k[n] === 'string') KEYS[n] = k[n].trim(); }); };
  const has = (n) => Boolean(KEYS[n]);
  const status = () => ({
    photo: ['pexels', 'unsplash'].filter(has).concat('wikimedia', 'openverse'),
    video: ['pexels', 'pixabay'].filter(has),
    ai: has('pollinations') ? 'pollinations' : 'classic',
    tts: ['gemini', 'azure'].filter(has),
  });

  const koreanize = (q) => { const s = String(q || '').trim(); return PEOPLE.test(s) && !NATION.test(s) ? 'korean ' + s : s; };
  const photorealPrompt = (p) => { const s = koreanize(p); return STYLE.test(s) ? s : `${s}, photorealistic, natural lighting, 35mm photo, high detail, realistic skin texture, no text, no watermark`; };
  const sig = (ms, signal) => { const list = [AbortSignal.timeout(ms)]; if (signal) list.push(signal); return AbortSignal.any ? AbortSignal.any(list) : list[0]; };
  async function getJSON(url, init, ms) {
    const r = await fetch(url, { ...(init || {}), signal: sig(ms || 15000, init && init.signal) });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }
  async function memo(key, fn) { if (mem.has(key)) return mem.get(key); const v = await fn(); mem.set(key, v); return v; }
  const blobToDataUrl = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
  const okText = (s) => !BLOCK.test(String(s || ''));

  // ---------- 사진 ----------
  const ORI = {
    landscape: { pexels: 'landscape', unsplash: 'landscape', ov: 'wide' },
    portrait: { pexels: 'portrait', unsplash: 'portrait', ov: 'tall' },
    square: { pexels: 'square', unsplash: 'squarish', ov: 'square' },
  };
  async function pexelsPhotos(q, o, signal) {
    const j = await getJSON(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=20&orientation=${ORI[o].pexels}`, { headers: { Authorization: KEYS.pexels }, signal });
    return (j.photos || []).filter((p) => okText(p.alt)).map((p) => ({ id: 'pexels:' + p.id, url: p.src.large2x || p.src.large, small: p.src.large, w: p.width, h: p.height, alt: p.alt || q, credit: { source: 'Pexels', author: p.photographer || '', link: p.url, license: 'Pexels License' } }));
  }
  async function unsplashPhotos(q, o, signal) {
    const j = await getJSON(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=20&orientation=${ORI[o].unsplash}&content_filter=high`, { headers: { Authorization: `Client-ID ${KEYS.unsplash}` }, signal });
    return (j.results || []).filter((p) => okText(p.alt_description)).map((p) => ({ id: 'unsplash:' + p.id, url: `${p.urls.raw}&w=1800&q=80&fm=jpg&fit=crop`, small: p.urls.regular, w: p.width, h: p.height, alt: p.alt_description || q, credit: { source: 'Unsplash', author: (p.user && p.user.name) || '', link: `${p.links.html}?utm_source=darkcode_ai&utm_medium=referral`, license: 'Unsplash License' } }));
  }
  // 방향이 맞는 사진을 앞으로 (없으면 나머지도 사용)
  const fits = (x, o) => { const r = (x.w || 1) / (x.h || 1); return o === 'portrait' ? r < 0.87 : o === 'square' ? r >= 0.87 && r <= 1.15 : r > 1.15; };
  const byOrientation = (list, o) => list.filter((x) => fits(x, o)).concat(list.filter((x) => !fits(x, o)));
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  async function wikimediaPhotos(q, o, signal) {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&iiextmetadatafilter=LicenseShortName|Artist`;
    const j = await getJSON(url, { signal }, 15000);
    const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const list = pages.map((p) => {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii) return null;
      const em = ii.extmetadata || {};
      const lic = strip(em.LicenseShortName && em.LicenseShortName.value);
      const title = String(p.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
      if ((ii.width || 0) < 800 || !/(cc|public domain|pd)/i.test(lic) || /\b(nc|nd)\b/i.test(lic) || !okText(title) || ART.test(title)) return null;
      return { id: 'wm:' + p.pageid, url: ii.thumburl || ii.url, small: ii.thumburl || ii.url, w: ii.width, h: ii.height, alt: title, credit: { source: 'Wikimedia Commons', author: strip(em.Artist && em.Artist.value).slice(0, 60), link: ii.descriptionurl || ii.url, license: lic, title } };
    }).filter(Boolean);
    return byOrientation(list, o);
  }
  // Openverse 는 느리고 동시 요청을 막는 편이라 한 번에 하나씩 보낸다
  let ovChain = Promise.resolve();
  const ovQueue = (fn) => { const p = ovChain.then(fn, fn); ovChain = p.catch(() => {}); return p; };
  async function openversePhotos(q, o, signal) {
    return ovQueue(async () => {
      const j = await getJSON(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&mature=false&page_size=20`, { signal }, 20000);
      const list = (j.results || [])
        .filter((r) => r.url && okText(r.title) && okText((r.tags || []).map((t) => t.name).join(' ')) && (r.width || 0) >= 640 && !ART.test(r.title || ''))
        .map((r) => ({ id: 'ov:' + r.id, url: r.url, small: r.thumbnail || r.url, w: r.width, h: r.height, alt: r.title || q, credit: { source: 'Openverse', author: r.creator || '', link: r.foreign_landing_url || r.url, license: `CC ${String(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(), title: r.title || '' } }));
      return byOrientation(list, o);
    });
  }
  // 키 있는 스톡(검색이 정확): 긴 검색어부터 · 키 없는 공개 아카이브: 짧은 핵심어만
  function variants(q, open) {
    const base = String(q || '').replace(/^(photo|ai|video)\s*:\s*/i, '').trim();
    const words = base.split(/[\s,]+/).filter(Boolean);
    const w3 = words.slice(0, 3).join(' '), w2 = words.slice(0, 2).join(' ');
    const list = open ? [koreanize(w3), w3, w2] : [koreanize(base), base, w3];
    return [...new Set(list.filter(Boolean))];
  }
  async function findPhoto(query, { orientation = 'landscape', used = new Set(), signal } = {}) {
    const o = ORI[orientation] ? orientation : 'landscape';
    const sources = [['pexels', pexelsPhotos], ['unsplash', unsplashPhotos], ['wikimedia', wikimediaPhotos], ['openverse', openversePhotos]].filter(([n]) => n === 'wikimedia' || n === 'openverse' || has(n));
    for (const [name, fn] of sources) {
      for (const q of variants(query, name === 'wikimedia' || name === 'openverse')) {
        let list = [];
        try { list = await memo(`${name}|${o}|${q}`, () => fn(q, o, signal)); } catch (e) { if (e.status === 401 || e.status === 403) break; continue; }
        const pick = list.find((x) => !used.has(x.id));
        if (pick) { used.add(pick.id); return pick; }
      }
    }
    return null;
  }

  // ---------- 영상 ----------
  function pickPexelsFile(files) {
    const mp4 = (files || []).filter((f) => /mp4/i.test(f.file_type || '') && f.link);
    return mp4.filter((f) => f.width >= 1280 && f.width <= 1920).sort((a, b) => b.width - a.width)[0] || mp4.filter((f) => f.width <= 1920).sort((a, b) => b.width - a.width)[0] || mp4[0] || null;
  }
  async function pexelsVideos(q, o, signal) {
    const j = await getJSON(`https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(q)}&per_page=15&orientation=${ORI[o].pexels}`, { headers: { Authorization: KEYS.pexels }, signal });
    return (j.videos || []).map((v) => { const f = pickPexelsFile(v.video_files); return f && { id: 'pexels-v:' + v.id, url: f.link, w: f.width, h: f.height, poster: v.image, dur: v.duration, credit: { source: 'Pexels', author: (v.user && v.user.name) || '', link: v.url, license: 'Pexels License' } }; }).filter(Boolean);
  }
  async function pixabayVideos(q, o, signal) {
    const j = await getJSON(`https://pixabay.com/api/videos/?key=${encodeURIComponent(KEYS.pixabay)}&q=${encodeURIComponent(q)}&per_page=15&safesearch=true`, { signal });
    return (j.hits || []).filter((h) => okText(h.tags)).map((h) => { const v = (h.videos && (h.videos.medium && h.videos.medium.url ? h.videos.medium : h.videos.small)) || null; return v && { id: 'pixabay-v:' + h.id, url: v.url, w: v.width, h: v.height, poster: v.thumbnail || '', dur: h.duration, credit: { source: 'Pixabay', author: h.user || '', link: h.pageURL, license: 'Pixabay Content License' } }; }).filter(Boolean);
  }
  async function findVideo(query, { orientation = 'landscape', used = new Set(), signal } = {}) {
    const o = ORI[orientation] ? orientation : 'landscape';
    const sources = [['pexels', pexelsVideos], ['pixabay', pixabayVideos]].filter(([n]) => has(n));
    for (const [name, fn] of sources) {
      for (const q of variants(query)) {
        let list = [];
        try { list = await memo(`v:${name}|${o}|${q}`, () => fn(q, o, signal)); } catch (e) { if (e.status === 401 || e.status === 403) break; continue; }
        const pick = list.find((x) => !used.has(x.id));
        if (pick) { used.add(pick.id); return pick; }
      }
    }
    return null;
  }

  // ---------- AI 실사 이미지 ----------
  async function aiPhoto(prompt, { width = 1280, height = 768, signal, retries = 3, onWait } = {}) {
    const p = photorealPrompt(prompt);
    const seed = Math.floor(Math.random() * 1e6);
    if (has('pollinations')) {
      const r = await fetch(`https://gen.pollinations.ai/image/${encodeURIComponent(p)}?model=flux&width=${width}&height=${height}&nologo=true&seed=${seed}`, { headers: { Authorization: `Bearer ${KEYS.pollinations}` }, signal: sig(120000, signal) });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.startsWith('image/')) throw new Error(`AI 이미지 실패 (HTTP ${r.status})`);
      const blob = await r.blob();
      return { url: null, dataUrl: await blobToDataUrl(blob), blob, prompt: p, source: 'Pollinations', credit: { source: 'AI 생성 (Pollinations)', author: '', link: '', license: '' } };
    }
    const classicUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
    for (let i = 0; i < retries; i++) {
      const r = await fetch(classicUrl, { signal: sig(120000, signal) });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.startsWith('image/')) { const blob = await r.blob(); return { url: classicUrl, dataUrl: await blobToDataUrl(blob), blob, prompt: p, source: 'Pollinations Classic', credit: { source: 'AI 생성 (Pollinations)', author: '', link: '', license: '' } }; }
      if (![429, 502, 503].includes(r.status) || i === retries - 1) throw new Error(`AI 이미지 서버 ${r.status} (무료 Classic API 혼잡 · pollen 키를 넣으면 안정적)`);
      if (onWait) onWait(i + 1);
      await new Promise((res) => setTimeout(res, 11000));
    }
    throw new Error('AI 이미지 실패');
  }

  // ---------- HTML 표식 → 실사 사진·영상 ----------
  function orientOf(el, kind) {
    const o = (el.getAttribute('data-dc-orient') || '').toLowerCase();
    if (ORI[o]) return o;
    if (kind !== 'img') return 'landscape';
    const w = Number(el.getAttribute('width')), h = Number(el.getAttribute('height'));
    if (w && h) return w / h > 1.15 ? 'landscape' : w / h < 0.87 ? 'portrait' : 'square';
    const hint = `${el.className || ''} ${el.getAttribute('alt') || ''} ${el.getAttribute('data-dc-img') || ''}`;
    if (/avatar|profile|portrait|doctor-card|team|staff|인물|원장|의료진/i.test(hint)) return 'portrait';
    return 'landscape';
  }
  async function pool(tasks, n) {
    const out = []; let i = 0;
    const worker = async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } };
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
    return out;
  }
  function creditsHtml(credits) {
    if (!credits.length) return '';
    const by = {};
    credits.forEach((c) => { (by[c.source] = by[c.source] || []).push(c); });
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const parts = Object.entries(by).map(([src, list]) => {
      if (src === 'Openverse' || src === 'Wikimedia Commons') return `${esc(src)}: ` + list.map((c) => `<a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.title || '사진')}</a>${c.author ? ' · ' + esc(c.author) : ''} (${esc(c.license)})`).join(', ');
      const authors = [...new Set(list.map((c) => c.author).filter(Boolean))].slice(0, 6).map(esc).join(', ');
      const home = { Pexels: 'https://www.pexels.com', Unsplash: 'https://unsplash.com', Pixabay: 'https://pixabay.com' }[src];
      return `${home ? `<a href="${home}" target="_blank" rel="noopener">${esc(src)}</a>` : esc(src)}${authors ? ` (${authors})` : ''}`;
    });
    return `사진·영상 출처: ${parts.join(' · ')}`;
  }
  async function resolveHtml(html, { log = () => {}, signal } = {}) {
    const stats = { photos: 0, bgs: 0, videos: 0, ai: 0, failed: 0, sources: [] };
    if (!/data-dc-(img|bg|video)\s*=/.test(html)) return { html, stats };
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const used = new Set(); const usedV = new Set(); const credits = [];
    const note = (item) => { if (item && item.credit) { credits.push(item.credit); if (!stats.sources.includes(item.credit.source)) stats.sources.push(item.credit.source); } };
    const tasks = [];
    doc.querySelectorAll('img[data-dc-img]').forEach((el, idx) => {
      if (/^(https?:|data:|blob:)/.test(el.getAttribute('src') || '')) return;
      tasks.push(async () => {
        const q = el.getAttribute('data-dc-img');
        let item = null;
        try {
          if (/^ai\s*:/i.test(q)) { const a = await aiPhoto(q.replace(/^ai\s*:/i, ''), { signal, retries: 2 }); item = { url: a.url || a.dataUrl, alt: q, credit: a.credit }; stats.ai++; }
          else item = await findPhoto(q, { orientation: orientOf(el, 'img'), used, signal });
        } catch (e) { log(`사진 실패 "${q}" · ${e.message}`, 'warn'); }
        if (!item) { stats.failed++; el.setAttribute('src', 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="10"><rect width="16" height="10" fill="#d9dde3"/></svg>')); return; }
        el.setAttribute('src', item.url);
        if (!el.getAttribute('alt')) el.setAttribute('alt', item.alt || q);
        el.setAttribute('loading', idx < 2 ? 'eager' : 'lazy');
        el.setAttribute('decoding', 'async');
        if (!/object-fit/.test(el.getAttribute('style') || '')) el.setAttribute('style', `${el.getAttribute('style') || ''};object-fit:cover`.replace(/^;/, ''));
        stats.photos++; note(item);
      });
    });
    doc.querySelectorAll('[data-dc-bg]').forEach((el) => {
      if (/background-image\s*:\s*url\(\s*['"]?(https?:|data:)/.test(el.getAttribute('style') || '')) return;
      tasks.push(async () => {
        const q = el.getAttribute('data-dc-bg');
        let item = null;
        try { item = await findPhoto(q, { orientation: 'landscape', used, signal }); } catch (e) { log(`배경 실패 "${q}" · ${e.message}`, 'warn'); }
        if (!item) { stats.failed++; return; }
        const st = (el.getAttribute('style') || '').replace(/;\s*$/, '');
        el.setAttribute('style', `${st}${st ? ';' : ''}background-image:url("${item.url}");background-size:cover;background-position:center`);
        stats.bgs++; note(item);
      });
    });
    doc.querySelectorAll('video[data-dc-video]').forEach((el) => {
      if (el.getAttribute('src') || el.querySelector('source[src]')) return;
      tasks.push(async () => {
        const q = el.getAttribute('data-dc-video');
        let v = null;
        try { v = await findVideo(q, { orientation: 'landscape', used: usedV, signal }); } catch (e) { log(`영상 실패 "${q}" · ${e.message}`, 'warn'); }
        ['muted', 'playsinline', 'loop', 'autoplay'].forEach((a) => el.setAttribute(a, ''));
        if (v) { el.setAttribute('src', v.url); if (v.poster) el.setAttribute('poster', v.poster); stats.videos++; note(v); return; }
        let p = null;
        try { p = await findPhoto(q, { orientation: 'landscape', used, signal }); } catch { /* 아래 처리 */ }
        if (p) { el.setAttribute('poster', p.url); stats.photos++; note(p); log(`영상 키 없음 → "${q}" 사진으로 대체 (Pexels 키를 넣으면 실제 영상)`, 'warn'); }
        else stats.failed++;
      });
    });
    log(`표식 ${tasks.length}개 처리 (사진 ${status().photo.join('·')} / 영상 ${status().video.join('·') || '키 없음'})`, 't');
    await pool(tasks, 3);
    const text = creditsHtml(credits);
    if (text && !doc.querySelector('.dc-media-credits')) {
      const p = doc.createElement('p');
      p.className = 'dc-media-credits';
      p.setAttribute('style', 'font:11px/1.6 system-ui,sans-serif;opacity:.65;text-align:center;padding:10px 16px;margin:0');
      p.innerHTML = text;
      (doc.querySelector('footer') || doc.body).appendChild(p);
    }
    const hadDoctype = /^\s*<!doctype/i.test(html);
    return { html: `${hadDoctype ? '<!doctype html>\n' : ''}${doc.documentElement.outerHTML}`, stats, credits };
  }

  window.DCMedia = { version: '1.0', setKeys, has, status, koreanize, photorealPrompt, findPhoto, findVideo, aiPhoto, resolveHtml, creditsHtml };
})();
