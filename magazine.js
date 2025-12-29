/*!
BCS Magazine Reader Runtime (WordPress Plugin)
Build: 20251229-015301
*/
(function(){
  'use strict';

  // Visible proof in console (helps cache debugging)
  window.__BCS_MAG_BUILD = "20251229-015301";
  try{ console.log("BCS Magazine build", window.__BCS_MAG_BUILD); }catch(_e){}

  const DEFAULTS = {
    backgroundUrl: "",
    coverImageUrl: "",
    coverText: "",
    themePack: "default",

    // Placement intro (closed cover only)
    placementEnabled: true,
    placementStartZoom: 1.25,   // closer (bigger)
    placementEndZoom: 1.0,      // full view
    placementStartY: -0.06,     // slightly above
    placementEndY: 0.0,
    placementDurationMs: 1200,
    placementDelayMs: 80,

    // Closed resting pose (right side)
    closedBias: 0.18,           // right side
    closedZoom: 1.0,

    // Opened pose (center)
    openBias: 0.0,
    openZoom: 1.0,
    openDurationMs: 650,

    // Accessibility
    enableKeyboard: true,
    announcePageChanges: true,

    // Audio
    introMusicUrl: "",
    themeMusicUrl: "",
    startMusicOnOpen: true,
    showAudioControl: true,
    musicFadeMs: 650,

    // Navigation
    showToc: true,
    showThumbnails: true,

    // Branding
    showBranding: true,
    brandingText: "Powered by BCS Magazine",

    // Analytics
    analyticsEnabled: true
  };

  function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
  function safeJsonParse(str, fallback){ try{ return str ? JSON.parse(str) : fallback; }catch(_e){ return fallback; } }
  async function fetchJson(url){
    const r = await fetch(url, { cache:'no-store' });
    if(!r.ok) throw new Error('Failed to load magazine JSON');
    return await r.json();
  }

  function el(tag, attrs={}, children=[]) {
    const n = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs||{})) {
      if(k==='class') n.className = v;
      else if(k==='text') n.textContent = v;
      else if(k==='html') n.innerHTML = v;
      else if(k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if(v !== undefined && v !== null) n.setAttribute(k, String(v));
    }
    for(const c of children) n.appendChild(c);
    return n;
  }

  function sessionKeyFor(url, suffix) {
    const base = btoa(unescape(encodeURIComponent(url))).slice(0, 64);
    return 'bcs_mag_' + suffix + '__' + base;
  }

  function isTypingTarget(activeEl){
    if(!activeEl) return false;
    const t = (activeEl.tagName||'').toLowerCase();
    return ['input','textarea','select'].includes(t) || activeEl.isContentEditable;
  }

  async function postEvent(cfg, payload){
    if(!cfg.analyticsEnabled) return;
    const restUrl = (window.BCS_MAG && window.BCS_MAG.restUrl) ? window.BCS_MAG.restUrl : '';
    const nonce = (window.BCS_MAG && window.BCS_MAG.nonce) ? window.BCS_MAG.nonce : '';
    if(!restUrl) return;
    try {
      await fetch(restUrl, {
        method:'POST',
        headers: Object.assign({'Content-Type':'application/json'}, nonce ? {'X-WP-Nonce': nonce} : {}),
        body: JSON.stringify(payload)
      });
    } catch(_e) {}
  }

  function fadeTo(audio, targetVol, ms){
    if(!audio) return;
    ms = clamp(Number(ms||650), 100, 4000);
    const start = audio.volume;
    const startT = performance.now();
    function step(t){
      const k = clamp((t-startT)/ms, 0, 1);
      audio.volume = start + (targetVol-start)*k;
      if(k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function normalizeToc(rawToc) {
    if(!Array.isArray(rawToc)) return [];
    // Remove Cover entry (cover is NOT a page)
    return rawToc.filter(x => String(x?.label||'').toLowerCase() !== 'cover');
  }

  function findPageThumb(page) {
    const els = Array.isArray(page?.elements) ? page.elements : [];
    const imgEl = els.find(e => e?.type === 'image' && e?.content?.imageUrl);
    return imgEl?.content?.imageUrl || "";
  }

  function buildPageModel(data) {
    const pages = Array.isArray(data?.pages) ? data.pages : [];
    // Cover is handled by WP settings; content pages are all JSON pages.
    // (If you later add an explicit cover page in JSON, we can skip it by marker.)
    return pages.map((p, idx) => {
      return {
        id: p.id || ('page_'+(idx+1)),
        index: idx,
        pageNumber: idx+1,
        elements: Array.isArray(p.elements) ? p.elements : [],
        fallbackText: p.fallbackText || ''
      };
    });
  }

  function renderElements(pageInner, elements) {
    // If no positioning info, stack gently.
    let stackY = 8;
    for(const e of elements) {
      const type = e?.type;
      const link = e?.linkUrl;
      const style = e?.style || {};

      // Optional normalized placement (if you add later)
      const hasBox = (style && (style.x !== undefined || style.y !== undefined || style.w !== undefined || style.h !== undefined));
      const x = hasBox ? clamp(Number(style.x ?? 0.1), 0, 1) : null;
      const y = hasBox ? clamp(Number(style.y ?? 0.1), 0, 1) : null;
      const w = hasBox ? clamp(Number(style.w ?? 0.8), 0, 1) : null;
      const h = hasBox ? clamp(Number(style.h ?? 0.2), 0, 1) : null;

      function applyBox(node) {
        node.style.position = 'absolute';
        node.style.left = (x*100)+'%';
        node.style.top = (y*100)+'%';
        node.style.width = (w*100)+'%';
        node.style.height = (h*100)+'%';
      }

      if(type === 'image') {
        const url = e?.content?.imageUrl || '';
        if(!url) continue;
        const img = el('img', {
          class: 'bcs-mag-el bcs-mag-el-image',
          src: url,
          alt: e?.content?.alt || ''
        });
        if(hasBox) {
          applyBox(img);
          img.style.objectFit = 'cover';
        } else {
          // stack
          img.style.display = 'block';
          img.style.maxWidth = '92%';
          img.style.maxHeight = '72%';
          img.style.margin = stackY + 'px auto 0';
          img.style.borderRadius = '12px';
          stackY += 10;
        }
        if(link) {
          const a = el('a', { class:'bcs-mag-linkwrap', href: link, target:'_blank', rel:'noopener' }, [img]);
          if(hasBox) applyBox(a);
          pageInner.appendChild(a);
        } else {
          pageInner.appendChild(img);
        }
      } else if(type === 'text') {
        const text = e?.content?.text ?? '';
        if(!String(text).trim()) continue;
        const isHeading = (style?.role === 'heading');
        const t = el('div', {
          class: 'bcs-mag-el bcs-mag-el-text' + (isHeading ? ' is-heading' : ''),
          text: String(text)
        });
        if(hasBox) {
          applyBox(t);
        } else {
          t.style.position = 'relative';
          t.style.margin = stackY + 'px 6% 0';
          t.style.maxWidth = '88%';
          stackY += isHeading ? 18 : 12;
        }
        if(link) {
          const a = el('a', { class:'bcs-mag-linktext', href: link, target:'_blank', rel:'noopener' }, [t]);
          if(hasBox) applyBox(a);
          pageInner.appendChild(a);
        } else {
          pageInner.appendChild(t);
        }
      }
    }
  }

  function createReader(container) {
    const jsonUrl = container.getAttribute('data-json-url') || container.getAttribute('data-json') || '';
    const cfgAttr = container.getAttribute('data-config') || '';
    const cfg = Object.assign({}, DEFAULTS, safeJsonParse(cfgAttr, {}));

    container.classList.add('bcs-magazine');
    container.innerHTML = '';

    const wrapper = el('div', { class:'bcs-mag-wrapper' });
    wrapper.classList.add('theme-' + (cfg.themePack || 'default'));

    const stage = el('div', { class:'bcs-mag-stage' });
    const bg = el('div', { class:'bcs-mag-background', 'aria-hidden':'true' });
    const magObj = el('div', { class:'bcs-magazine-object', role:'group', 'aria-label':'Magazine reader' });
    const live = el('div', { class:'bcs-mag-live', 'aria-live':'polite', 'aria-atomic':'true' });
    if(!cfg.announcePageChanges) live.setAttribute('aria-live','off');

    // Controls
    const controls = el('div', { class:'bcs-mag-controls' });
    const btnPrev = el('button', { class:'bcs-mag-btn', type:'button', 'aria-label':'Previous page', text:'‹' });
    const btnNext = el('button', { class:'bcs-mag-btn', type:'button', 'aria-label':'Next page', text:'›' });
    const pageLabel = el('div', { class:'bcs-mag-page-label', role:'status', 'aria-live':'polite', text:'' });
    controls.appendChild(btnPrev); controls.appendChild(pageLabel); controls.appendChild(btnNext);

    // Nav buttons
    const nav = el('div', { class:'bcs-mag-nav' });
    const btnToc = el('button', { class:'bcs-mag-nav-btn', type:'button', 'aria-label':'Table of contents', text:'☰' });
    const btnThumbs = el('button', { class:'bcs-mag-nav-btn', type:'button', 'aria-label':'Thumbnails', text:'▦' });
    if(!cfg.showToc) btnToc.style.display='none';
    if(!cfg.showThumbnails) btnThumbs.style.display='none';
    nav.appendChild(btnToc); nav.appendChild(btnThumbs);

    // Audio
    const audioWrap = el('div', { class:'bcs-mag-audio' });
    const audioBtn = el('button', { class:'bcs-mag-audio-btn', type:'button', 'aria-label':'Toggle music', text:'♪' });
    if(!cfg.showAudioControl) audioWrap.style.display='none';
    audioWrap.appendChild(audioBtn);

    const branding = el('div', { class:'bcs-mag-branding', text: cfg.brandingText });
    if(!cfg.showBranding) branding.style.display='none';

    // Panels
    const tocPanel = el('div', { class:'bcs-mag-panel bcs-mag-toc', 'aria-hidden':'true' });
    const thumbsPanel = el('div', { class:'bcs-mag-panel bcs-mag-thumbs', 'aria-hidden':'true' });

    stage.appendChild(bg);
    stage.appendChild(magObj);
    wrapper.appendChild(stage);
    wrapper.appendChild(controls);
    wrapper.appendChild(nav);
    wrapper.appendChild(audioWrap);
    wrapper.appendChild(branding);
    wrapper.appendChild(tocPanel);
    wrapper.appendChild(thumbsPanel);
    wrapper.appendChild(live);
    container.appendChild(wrapper);

    if(cfg.backgroundUrl) {
      bg.style.backgroundImage = `url("${cfg.backgroundUrl}")`;
      bg.classList.add('has-bg');
    }

    // Motion vars
    function setMotion({scale, x, y, ms}) {
      stage.style.setProperty('--bcs-mag-motion-ms', (ms ?? 800) + 'ms');
      stage.style.setProperty('--bcs-mag-scale', String(scale ?? 1.0));
      stage.style.setProperty('--bcs-mag-x', String(x ?? 0.0));
      stage.style.setProperty('--bcs-mag-y', String(y ?? 0.0));
    }

    // Audio
    let introAudio=null, themeAudio=null, musicEnabled=true, introPlayed=false;
    function ensureAudio() {
      if(introAudio || themeAudio) return;
      if(cfg.introMusicUrl) {
        introAudio = new Audio(cfg.introMusicUrl);
        introAudio.preload='auto';
        introAudio.volume=0.0;
      }
      if(cfg.themeMusicUrl) {
        themeAudio = new Audio(cfg.themeMusicUrl);
        themeAudio.preload='auto';
        themeAudio.loop=true;
        themeAudio.volume=0.0;
      }
    }
    function stopAllMusic() {
      for(const a of [introAudio, themeAudio]) {
        if(!a) continue;
        try{ a.pause(); a.currentTime=0; a.volume=0.0; }catch(_e){}
      }
    }
    async function playMusicOnOpenGesture() {
      if(!cfg.startMusicOnOpen || !musicEnabled) return;
      ensureAudio();
      try {
        if(introAudio && !introPlayed) {
          introPlayed=true;
          await introAudio.play();
          fadeTo(introAudio, 1.0, cfg.musicFadeMs);
          introAudio.onended = async () => {
            if(themeAudio && musicEnabled) {
              try{ await themeAudio.play(); fadeTo(themeAudio, 1.0, cfg.musicFadeMs); }catch(_e){}
            }
          };
        } else if(themeAudio) {
          await themeAudio.play();
          fadeTo(themeAudio, 1.0, cfg.musicFadeMs);
        }
      } catch(_e) {}
    }
    function toggleMusic() {
      ensureAudio();
      musicEnabled = !musicEnabled;
      audioBtn.classList.toggle('is-off', !musicEnabled);
      if(!musicEnabled) {
        fadeTo(introAudio, 0.0, cfg.musicFadeMs);
        fadeTo(themeAudio, 0.0, cfg.musicFadeMs);
        window.setTimeout(()=>stopAllMusic(), clamp(cfg.musicFadeMs,100,4000));
      } else if(themeAudio) {
        themeAudio.play().then(()=>fadeTo(themeAudio, 1.0, cfg.musicFadeMs)).catch(()=>{});
      }
    }
    audioBtn.addEventListener('click', (e)=>{ e.preventDefault(); toggleMusic(); });
    document.addEventListener('visibilitychange', ()=>{
      if(document.hidden) {
        fadeTo(introAudio, 0.0, 250); fadeTo(themeAudio, 0.0, 250);
        window.setTimeout(()=>{ try{ introAudio && introAudio.pause(); }catch(_e){} try{ themeAudio && themeAudio.pause(); }catch(_e){} }, 260);
      } else if(musicEnabled && themeAudio) {
        themeAudio.play().then(()=>fadeTo(themeAudio, 1.0, cfg.musicFadeMs)).catch(()=>{});
      }
    });

    // State
    let data=null;
    let pages=[];
    let toc=[];
    let currentIndex=0;
    let mode='closed'; // closed | open

    function announce(msg) {
      if(!cfg.announcePageChanges) return;
      live.textContent = msg;
    }

    function setPageLabel() {
      if(mode==='closed') { pageLabel.textContent = 'Cover'; return; }
      const total = pages.length;
      pageLabel.textContent = total ? `Page ${currentIndex+1} of ${total}` : '';
    }

    function setButtons() {
      if(mode==='closed') {
        btnPrev.disabled = true;
        btnNext.disabled = true;
        controls.style.visibility = 'hidden';
        nav.style.visibility = 'hidden';
        return;
      }
      controls.style.visibility = 'visible';
      nav.style.visibility = 'visible';
      btnPrev.disabled = (currentIndex<=0);
      btnNext.disabled = (currentIndex>=Math.max(0,pages.length-1));
    }

    function closePanels() {
      tocPanel.classList.remove('is-open');
      thumbsPanel.classList.remove('is-open');
      tocPanel.setAttribute('aria-hidden','true');
      thumbsPanel.setAttribute('aria-hidden','true');
    }

    function buildTocUI() {
      tocPanel.innerHTML = '';
      tocPanel.appendChild(el('div', {class:'bcs-mag-panel-title', text:'Contents'}));
      if(!toc.length) {
        tocPanel.appendChild(el('div', {class:'bcs-mag-panel-empty', text:'No contents'}));
        return;
      }
      const list = el('div', {class:'bcs-mag-panel-list'});
      for(const item of toc) {
        // item.pageNumber in your JSON is 1-based; cover removed so this aligns to pages
        const target = clamp((Number(item.pageNumber||1)-1), 0, Math.max(0,pages.length-1));
        const row = el('button', {class:'bcs-mag-panel-row', type:'button', text: String(item.label||('Page '+(target+1))) });
        row.addEventListener('click', ()=>{ goTo(target); closePanels(); });
        list.appendChild(row);
      }
      tocPanel.appendChild(list);
    }

    function buildThumbsUI() {
      thumbsPanel.innerHTML = '';
      thumbsPanel.appendChild(el('div', {class:'bcs-mag-panel-title', text:'Thumbnails'}));
      if(!pages.length) {
        thumbsPanel.appendChild(el('div', {class:'bcs-mag-panel-empty', text:'No pages'}));
        return;
      }
      const grid = el('div', {class:'bcs-mag-thumbs-grid'});
      pages.forEach((p, idx)=>{
        const thumb = findPageThumb(p._raw || p);
        const cell = el('button', {class:'bcs-mag-thumb', type:'button', 'aria-label':'Go to page '+(idx+1)});
        if(thumb) cell.style.backgroundImage = `url("${thumb}")`;
        else cell.textContent = String(idx+1);
        cell.addEventListener('click', ()=>{ goTo(idx); closePanels(); });
        grid.appendChild(cell);
      });
      thumbsPanel.appendChild(grid);
    }

    btnToc.addEventListener('click', ()=>{
      if(mode!=='open') return;
      const open = tocPanel.classList.toggle('is-open');
      thumbsPanel.classList.remove('is-open');
      tocPanel.setAttribute('aria-hidden', open ? 'false':'true');
      thumbsPanel.setAttribute('aria-hidden','true');
    });
    btnThumbs.addEventListener('click', ()=>{
      if(mode!=='open') return;
      const open = thumbsPanel.classList.toggle('is-open');
      tocPanel.classList.remove('is-open');
      thumbsPanel.setAttribute('aria-hidden', open ? 'false':'true');
      tocPanel.setAttribute('aria-hidden','true');
    });
    wrapper.addEventListener('click', (e)=>{
      // click outside panels closes
      if(e.target === wrapper || e.target === stage || e.target === magObj) return;
      if(!tocPanel.contains(e.target) && !thumbsPanel.contains(e.target) && !btnToc.contains(e.target) && !btnThumbs.contains(e.target)) {
        closePanels();
      }
    });

    // Rendering
    function renderClosedCover() {
      mode='closed';
      wrapper.classList.add('is-closed');
      wrapper.classList.remove('is-open');
      closePanels();

      setButtons();
      setPageLabel();

      magObj.innerHTML='';
      const cover = el('div', { class:'bcs-mag-cover', tabindex:'0', role:'button', 'aria-label':'Open magazine' });
      const coverInner = el('div', { class:'bcs-mag-cover-inner' });

      const url = cfg.coverImageUrl || '';
      if(url) {
        coverInner.style.backgroundImage = `url("${url}")`;
        coverInner.classList.add('has-image');
      } else {
        coverInner.classList.add('no-image');
        coverInner.appendChild(el('div', {class:'bcs-mag-cover-fallback', text:'Magazine'}));
      }

      const ctext = String(cfg.coverText||'').trim() || String(data?.coverText||'').trim() || "";
      if(ctext) {
        coverInner.appendChild(el('div', {class:'bcs-mag-cover-text', text: ctext}));
      }

      cover.appendChild(coverInner);
      magObj.appendChild(cover);

      announce('Cover view');
      postEvent(cfg, { event:'cover_view', json_url: jsonUrl, ts: Date.now() });

      const open = ()=> openMagazine(true);
      cover.addEventListener('click', open);
      cover.addEventListener('keydown', (e)=>{
        if(e.key==='Enter' || e.key===' ') { e.preventDefault(); open(); }
      });
    }

    function renderOpenPage() {
      mode='open';
      wrapper.classList.remove('is-closed');
      wrapper.classList.add('is-open');

      setButtons();
      setPageLabel();

      magObj.innerHTML='';
      const page = pages[currentIndex];
      const pageEl = el('div', { class:'bcs-mag-page', tabindex:'0', role:'document', 'aria-label':`Page ${currentIndex+1}` });
      const inner = el('div', { class:'bcs-mag-page-inner' });

      // If a full-page image element exists and has a box, we can treat it as background later.
      // For now render elements directly.
      renderElements(inner, page.elements || []);

      pageEl.appendChild(inner);
      magObj.appendChild(pageEl);

      announce(`Page ${currentIndex+1}`);
      postEvent(cfg, { event:'page_change', json_url: jsonUrl, page_index: currentIndex, ts: Date.now() });
    }

    function goTo(i) {
      currentIndex = clamp(i, 0, Math.max(0,pages.length-1));
      renderOpenPage();
      setButtons();
      setPageLabel();
    }

    btnNext.addEventListener('click', ()=> goTo(currentIndex+1));
    btnPrev.addEventListener('click', ()=> goTo(currentIndex-1));

    // Placement intro: background visible; magazine "placed" down and zoomed OUT to full view on right.
    function runPlacementIntroIfNeeded() {
      if(!cfg.placementEnabled) {
        setMotion({ scale: cfg.closedZoom, x: cfg.closedBias, y: 0, ms: 0 });
        return;
      }
      const k = sessionKeyFor(jsonUrl, 'placed');
      const done = sessionStorage.getItem(k) === '1';
      if(done) {
        setMotion({ scale: cfg.closedZoom, x: cfg.closedBias, y: cfg.placementEndY, ms: 0 });
        return;
      }

      // START: close-up (bigger), slightly above
      // NOTE: startZoom MUST be > endZoom to avoid "zooming in".
      const startZoom = Math.max(Number(cfg.placementStartZoom||1.25), Number(cfg.placementEndZoom||1.0) + 0.05);
      const endZoom = Number(cfg.placementEndZoom||1.0);

      setMotion({ scale: startZoom, x: cfg.closedBias, y: Number(cfg.placementStartY||-0.06), ms: 0 });
      wrapper.classList.add('is-placing');

      window.setTimeout(()=>{
        // END: zoom OUT to full view on right while settling down
        setMotion({ scale: endZoom, x: cfg.closedBias, y: Number(cfg.placementEndY||0.0), ms: clamp(Number(cfg.placementDurationMs||1200), 400, 5000) });
        wrapper.classList.add('placed');
        window.setTimeout(()=>{
          wrapper.classList.remove('is-placing');
          sessionStorage.setItem(k, '1');
        }, clamp(Number(cfg.placementDurationMs||1200), 400, 5000) + 40);
      }, clamp(Number(cfg.placementDelayMs||80), 0, 1500));
    }

    function openMagazine(fromCover) {
      closePanels();
      playMusicOnOpenGesture();
      // Animate from right closed pose -> centered open pose while "folding open"
      setMotion({ scale: cfg.openZoom, x: cfg.openBias, y: 0.0, ms: clamp(Number(cfg.openDurationMs||650), 250, 2500) });
      wrapper.classList.add('is-opening');
      window.setTimeout(()=> wrapper.classList.remove('is-opening'), clamp(Number(cfg.openDurationMs||650), 250, 2500)+20);

      renderOpenPage();
      postEvent(cfg, { event:'issue_open', json_url: jsonUrl, from_cover: !!fromCover, ts: Date.now() });
      announce('Magazine opened');
    }

    function closeMagazine() {
      currentIndex = 0;
      stopAllMusic();
      // Return to right-side closed pose (no placement replay)
      setMotion({ scale: cfg.closedZoom, x: cfg.closedBias, y: 0.0, ms: 450 });
      renderClosedCover();
    }

    function onKey(e) {
      if(!cfg.enableKeyboard) return;
      if(isTypingTarget(document.activeElement)) return;

      if(mode==='closed') {
        if(e.key==='Enter' || e.key===' ') { e.preventDefault(); openMagazine(true); }
        return;
      }
      if(e.key==='ArrowRight' || e.key==='PageDown') { e.preventDefault(); goTo(currentIndex+1); return; }
      if(e.key==='ArrowLeft' || e.key==='PageUp') { e.preventDefault(); goTo(currentIndex-1); return; }
      if(e.key==='Escape') { e.preventDefault(); closeMagazine(); return; }
    }
    window.addEventListener('keydown', onKey);

    // Init
    async function init() {
      try {
        if(!jsonUrl) throw new Error('Missing json_url');
        wrapper.classList.add('loading');
        data = await fetchJson(jsonUrl);
        wrapper.classList.remove('loading');

        pages = buildPageModel(data);
        // Keep raw pointer for thumbs (optional)
        const rawPages = Array.isArray(data?.pages) ? data.pages : [];
        pages.forEach((p,i)=> p._raw = rawPages[i] || null);

        toc = normalizeToc(data?.toc);
        buildTocUI();
        buildThumbsUI();

        // closed state only on load
        renderClosedCover();

        // Placement intro runs after initial render
        runPlacementIntroIfNeeded();
      } catch(err) {
        wrapper.classList.remove('loading');
        wrapper.classList.add('error');
        container.innerHTML = '';
        const box = el('div', { class:'bcs-mag-error', role:'alert' }, [
          el('div', { class:'bcs-mag-error-title', text:'Unable to load magazine' }),
          el('div', { class:'bcs-mag-error-msg', text:(err && err.message) ? err.message : 'Unknown error' })
        ]);
        container.appendChild(box);
      }
    }
    init();

    return { destroy(){ window.removeEventListener('keydown', onKey); } };
  }

  function boot() {
    const candidates = Array.from(document.querySelectorAll('.bcs-magazine, [data-json-url], [data-json]'));
    for(const c of candidates) {
      const hasJson = c.getAttribute('data-json-url') || c.getAttribute('data-json');
      if(!hasJson) continue;
      if(c.__bcsMagInit) continue;
      c.__bcsMagInit = true;
      createReader(c);
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
