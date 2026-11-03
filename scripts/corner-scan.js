// Layout check: opens every DeskFolio page and window through the ☰ menu and lists
// elements whose rounded corners eat into their text: a pill radius on a box taller
// than one line, or text that starts inside the corner curve. Run it in the browser
// preview (npm run build, serve dist/ with a stand-in Tauri bridge, open a PDF) by
// evaluating this file in the page, e.g. over Chrome DevTools: it returns
// { found: [...], missing: [...] }. Empty `found` and `missing` = pass.
// Set window.__OLD = true first to prove it still catches the 0.4.7 tool-link pill.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const burger = () => document.querySelector('.menu-burger');
  const press = (el) => { for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true })); };
  async function nav(label) {
    press(burger()); await wait(250);
    const tops = [...document.querySelectorAll('.menu-row.has-sub')].length;
    for (let i = 0; i < tops; i++) {
      const top = [...document.querySelectorAll('.menu-row.has-sub')][i];
      top.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      press(top); await wait(200);
      const hit = [...document.querySelectorAll('button.menu-row')].find((b) => b.querySelector('.menu-label')?.textContent.trim() === label);
      if (hit) { press(hit); await wait(800); return true; }
    }
    press(burger()); await wait(150);
    return false;
  }
  function scan(where) {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
      const rad = parseFloat(cs.borderTopLeftRadius) || 0;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (rad < 8 || !(ownText || el.matches('button, a, [role=button]'))) continue;
      // Known see-through buttons whose hover adds no background either (folio.css).
      if (el.matches('.recent-open')) continue;
      // Buttons count even when see-through: hovering gives them a background.
      const bg = el.matches('button, [role=button]') || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none';
      if (!bg) continue;
      const effective = Math.min(rad, r.height / 2, r.width / 2);
      const padL = parseFloat(cs.paddingLeft) || 0;
      // Tall pill: more than one line in a shape that is round at the ends.
      const tallPill = effective >= r.height / 2 - 1 && r.height > 44 && r.width > r.height * 1.2;
      // Text starting inside the curve: left padding much smaller than the radius on a box taller than a line.
      const tight = r.height > 44 && padL + 2 < effective * 0.45;
      if (tallPill || tight) out.push({ where, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), h: Math.round(r.height), radius: Math.round(effective), padL: Math.round(padL), text: el.textContent.trim().slice(0, 40) });
    }
    return out;
  }
  const pages = ['About DeskFolio', "What's new", 'Keyboard shortcuts', 'Search commands…', 'Report a problem…', 'Settings…', 'DeskLab account…', 'Agreements', 'Digital IDs', 'Merge', 'Split', 'Compress', 'Batch', 'Convert', 'Recognise text (OCR)',
    'Organize pages', 'Fill & Sign', 'Watermark', 'Header & footer', 'Crop pages', 'Document properties', 'Compare', 'Protect', 'Request signatures', 'Home'];
  if (window.__OLD) { const st = document.createElement('style'); st.textContent = '.tool-link{border-radius:999px!important;padding:8px 12px!important}'; document.head.append(st); }
  const found = scan('Home');
  const missing = [];
  for (const p of pages) {
    if (await nav(p)) { found.push(...scan(p)); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(250); } else missing.push(p);
  }
  return { found, missing };
})()
