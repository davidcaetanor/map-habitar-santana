const CONFIG = {
  // Link CSV da planilha publicada na web. Le as legendas.
  CSV: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQAC4K6d8S7mPSxVfCe3BWO8DQPtiZbxr42zqihAbK00MpXu_h65r6WLPcWGICATaU35YRhUYIKa9Hi/pub?gid=71030450&single=true&output=csv",
  // URL /exec do Apps Script restrito a contas Google. Abre o formulario de escrita.
  APP: "https://script.google.com/macros/s/AKfycbwIvC9s11R-GYjnFxJB6tGdwjl5EkCzkdVqUfC_6VYcwqnLq9tbjQZKyWt0LGaMBb0f/exec",
  // Link da planilha, usado pelo botao "Abrir a planilha do grupo".
  PLANILHA: "https://docs.google.com/spreadsheets/d/1vxRpqyhKK3WvguPPpOrMi6nMN6FbiiIEY5SUm2ktBYQ/edit"
};
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const PALETA = ['#26707E','#B05622','#5D6B57','#7A5AA6','#A7322A','#2F6B4F','#8A6D1F','#3B5FA8'];

let PTS = [], ROTAS = {}, legendas = new Map(), filtro = {}, soLeg = false, sel = null;

function el(n, at) { const e = document.createElementNS(NS, n); for (const a in at) e.setAttribute(a, at[a]); return e; }
function cor(codigo) { return (ROTAS[codigo] && ROTAS[codigo].cor) || '#888'; }

function parseCSV(txt) {
  const linhas = []; let campo = '', linha = [], aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function normaliza(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

let proj, projLatLon, metrosPorUnidade;
const PAD = 70, SZ = 1000;
function coordenadasDoMapa() {
  const c = PTS.map(p => [p.lat, p.lon]);
  Object.keys(ROTAS).forEach(k => (ROTAS[k].tracado || []).forEach(t => c.push(t)));
  return c;
}

function preparaProjecao() {
  const todas = coordenadasDoMapa();
  const lat0 = todas.reduce((a, c) => a + c[0], 0) / todas.length;
  const k = Math.cos(lat0 * Math.PI / 180);
  const xs = todas.map(c => c[1] * k), ys = todas.map(c => -c[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1e-5;
  const esc = (SZ - 2 * PAD) / span;
  const offX = PAD + ((span - (maxX - minX)) * esc) / 2;
  const offY = PAD + ((span - (maxY - minY)) * esc) / 2;
  proj = p => [offX + (p.lon * k - minX) * esc, offY + (-p.lat - minY) * esc];
  projLatLon = (lat, lon) => proj({ lat, lon });
  metrosPorUnidade = (span * 111320) / (SZ - 2 * PAD);
  const postos = [];
  PTS.forEach(p => {
    const base = proj(p); let x = base[0], y = base[1], i = 0;
    // espiral afasta fotos tiradas no mesmo lugar, que ficariam sobrepostas
    while (postos.some(q => Math.hypot(q[0] - x, q[1] - y) < 17) && i < 40) {
      const a = i * 2.399, r = 13 + 2.2 * i;
      x = base[0] + Math.cos(a) * r; y = base[1] + Math.sin(a) * r; i++;
    }
    postos.push([x, y]); p._x = x; p._y = y; p._rx = base[0]; p._ry = base[1];
  });
  const lon0 = todas.reduce((a, c) => a + c[1], 0) / todas.length;
  $('coordBox').textContent = lat0.toFixed(4) + ', ' + lon0.toFixed(4);
}

function desenha() {
  const svg = $('mapa'); svg.textContent = '';
  const g = el('g', {});
  for (let i = 1; i < 5; i++) {
    const v = PAD + i * (SZ - 2 * PAD) / 5;
    g.appendChild(el('line', { x1: PAD, x2: SZ - PAD, y1: v, y2: v, stroke: 'var(--line)', 'stroke-width': 1, opacity: .55 }));
    g.appendChild(el('line', { y1: PAD, y2: SZ - PAD, x1: v, x2: v, stroke: 'var(--line)', 'stroke-width': 1, opacity: .55 }));
  }
  Object.keys(ROTAS).forEach(c => {
    if (!filtro[c]) return;
    const ps = PTS.filter(p => p.t === c);
    if (ps.length < 2) return;
    g.appendChild(el('polyline', {
      points: ps.map(p => p._rx + ',' + p._ry).join(' '), fill: 'none',
      stroke: cor(c), 'stroke-width': 3.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: .34
    }));
  });
  Object.keys(ROTAS).forEach(c => {
    if (!filtro[c] || !ROTAS[c].tracado) return;
    const pontos = ROTAS[c].tracado.map(t => projLatLon(t[0], t[1]));
    g.appendChild(el('polyline', {
      points: pontos.map(q => q[0] + ',' + q[1]).join(' '), fill: 'none',
      stroke: cor(c), 'stroke-width': 3.4, 'stroke-linecap': 'round',
      'stroke-dasharray': '14 11', opacity: .5
    }));
  });
  PTS.forEach(p => {
    if (!filtro[p.t]) return;
    if (soLeg && !legendas.has(p.id)) return;
    const tem = legendas.has(p.id);
    const grp = el('g', { class: 'pt' + (sel && sel.id === p.id ? ' sel' : ''), tabindex: 0, role: 'button',
      'aria-label': p.id + ' ' + p.h + (tem ? ' com legenda' : ' sem legenda') });
    grp.appendChild(el('circle', { class: 'halo', cx: p._x, cy: p._y, r: 16 }));
    grp.appendChild(el('circle', { class: 'mk', cx: p._x, cy: p._y, r: 8,
      fill: tem ? cor(p.t) : 'var(--surface)', stroke: cor(p.t), 'stroke-width': 2.2 }));
    if (sel && sel.id === p.id) {
      const tx = el('text', { x: p._x, y: p._y - 20, 'text-anchor': 'middle', fill: 'var(--ink)',
        'font-size': 21, 'font-family': 'IBM Plex Mono, monospace', 'font-weight': 500 });
      tx.textContent = p.id; grp.appendChild(tx);
    }
    grp.addEventListener('click', () => seleciona(p.id));
    grp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seleciona(p.id); } });
    g.appendChild(grp);
  });
  const larg = 50 / metrosPorUnidade, y = SZ - 32, x = PAD;
  g.appendChild(el('line', { x1: x, x2: x + larg, y1: y, y2: y, stroke: 'var(--line-strong)', 'stroke-width': 3 }));
  g.appendChild(el('line', { x1: x, x2: x, y1: y - 6, y2: y + 6, stroke: 'var(--line-strong)', 'stroke-width': 3 }));
  g.appendChild(el('line', { x1: x + larg, x2: x + larg, y1: y - 6, y2: y + 6, stroke: 'var(--line-strong)', 'stroke-width': 3 }));
  const t = el('text', { x: x, y: y - 13, fill: 'var(--muted)', 'font-size': 20, 'font-family': 'IBM Plex Mono, monospace' });
  t.textContent = '50 m'; g.appendChild(t);
  const nx = SZ - PAD + 6, ny = PAD + 4;
  g.appendChild(el('path', { d: 'M ' + nx + ' ' + (ny + 34) + ' L ' + nx + ' ' + ny, stroke: 'var(--line-strong)', 'stroke-width': 3 }));
  g.appendChild(el('path', { d: 'M ' + (nx - 7) + ' ' + (ny + 10) + ' L ' + nx + ' ' + ny + ' L ' + (nx + 7) + ' ' + (ny + 10) + ' Z', fill: 'var(--line-strong)' }));
  const n = el('text', { x: nx, y: ny + 52, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 20, 'font-family': 'Archivo, sans-serif', 'font-weight': 600 });
  n.textContent = 'N'; g.appendChild(n);
  svg.appendChild(g);
}

function seleciona(id) {
  const p = PTS.find(q => q.id === id); if (!p) return; sel = p;
  $('bId').textContent = p.id;
  $('bImg').src = 'thumbs/' + p.th;
  $('bImg').alt = 'Registro fotográfico ' + p.id + ' da rota ' + p.t;
  $('bFile').textContent = p.f;
  $('bHora').textContent = p.h;
  $('bCoord').textContent = p.lat.toFixed(6) + ', ' + p.lon.toFixed(6);
  $('bAlt').textContent = p.alt + ' m';
  const L = legendas.get(p.id);
  $('bCat').textContent = (L && L.cat) ? L.cat : 'Sem categoria';
  if (L && L.txt) $('bTxt').textContent = L.txt;
  else { $('bTxt').textContent = ''; $('bTxt').appendChild(vazio()); }
  $('bAut').textContent = (L && L.autor) ? 'por ' + L.autor : '';
  if (CONFIG.APP) {
    $('bEscrever').href = CONFIG.APP + (CONFIG.APP.indexOf('?') < 0 ? '?' : '&') + 'ponto=' + encodeURIComponent(p.id);
    $('bEscrever').textContent = (L && L.txt) ? 'Editar legenda' : 'Escrever legenda';
  }
  desenha();
}

function vazio() {
  const s = document.createElement('span');
  s.className = 'vazio';
  s.textContent = CONFIG.APP ? 'Sem legenda ainda.' : 'Sem legenda. Escreva na planilha do grupo.';
  return s;
}

function vizinho(d) {
  const vis = PTS.filter(p => filtro[p.t] && (!soLeg || legendas.has(p.id)));
  if (!vis.length) return;
  const i = vis.findIndex(p => sel && p.id === sel.id);
  seleciona(vis[(i + d + vis.length) % vis.length].id);
}

function renderTabela() {
  const tb = $('tb'); tb.textContent = '';
  PTS.filter(p => filtro[p.t] && (!soLeg || legendas.has(p.id))).forEach(p => {
    const L = legendas.get(p.id) || {};
    const tr = document.createElement('tr');
    tr.onclick = () => seleciona(p.id);
    const c = (t, cl) => { const td = document.createElement('td'); if (cl) td.className = cl; td.textContent = t; return td; };
    tr.appendChild(c(p.id, 'id mono'));
    const td2 = document.createElement('td');
    const sp = document.createElement('span'); sp.className = 'pill'; sp.textContent = p.t;
    sp.style.color = cor(p.t); sp.style.borderColor = cor(p.t); td2.appendChild(sp); tr.appendChild(td2);
    tr.appendChild(c(p.h, 'mono'));
    tr.appendChild(c(p.lat.toFixed(5) + ', ' + p.lon.toFixed(5), 'mono'));
    tr.appendChild(c(L.cat || '-'));
    tr.appendChild(c(L.txt || '-'));
    tb.appendChild(tr);
  });
}

function montaChips() {
  const bar = $('chips'); bar.textContent = '';
  Object.keys(ROTAS).forEach(c => {
    const n = PTS.filter(p => p.t === c).length;
    const b = document.createElement('button');
    b.className = 'chip'; b.setAttribute('aria-pressed', 'true');
    const d = document.createElement('span'); d.className = 'dot'; d.style.background = cor(c);
    b.appendChild(d);
    b.appendChild(document.createTextNode(ROTAS[c].nome || c));
    if (n) b.appendChild(document.createTextNode(' · ' + n));
    else if (ROTAS[c].tracado) b.appendChild(document.createTextNode(' · traçado'));
    b.onclick = () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', v); filtro[c] = v; desenha(); renderTabela(); };
    bar.appendChild(b);
  });
  const bl = document.createElement('button');
  bl.className = 'chip'; bl.setAttribute('aria-pressed', 'false'); bl.textContent = 'Só com legenda';
  bl.onclick = () => { const v = bl.getAttribute('aria-pressed') !== 'true'; bl.setAttribute('aria-pressed', v); soLeg = v; desenha(); renderTabela(); };
  bar.appendChild(bl);
}

function montaAchados() {
  const box = $('ach'); box.textContent = '';
  Object.keys(ROTAS).forEach(c => {
    const r = ROTAS[c];
    if (!r.achados || !r.achados.length) return;
    const d = document.createElement('div'); d.className = 'ach';
    const rail = document.createElement('span'); rail.className = 'rail'; rail.style.background = cor(c); d.appendChild(rail);
    const h = document.createElement('h3'); h.textContent = r.nome || c; d.appendChild(h);
    const n = PTS.filter(p => p.t === c).length;
    const cnt = document.createElement('div'); cnt.className = 'cnt';
    cnt.textContent = n ? n + (n === 1 ? ' foto' : ' fotos') : 'sem registro fotográfico';
    d.appendChild(cnt);
    const ul = document.createElement('ul');
    r.achados.forEach(a => {
      const li = document.createElement('li');
      const b = document.createElement('b'); b.textContent = a[0]; li.appendChild(b);
      li.appendChild(document.createTextNode(a[1])); ul.appendChild(li);
    });
    d.appendChild(ul); box.appendChild(d);
  });
}

function aplica(lista) {
  legendas.clear();
  lista.forEach(l => {
    const id = String(l.ponto || '').trim();
    if (!id) return;
    const cat = String(l.cat || '').trim(), txt = String(l.txt || '').trim();
    if (cat || txt) legendas.set(id, { cat, txt, autor: String(l.autor || '').trim() });
  });
  $('nLeg').textContent = legendas.size;
  $('led').className = 'led on';
  $('syncTxt').textContent = 'legendas lidas às ' + new Date().toLocaleTimeString('pt-BR');
  desenha(); renderTabela(); if (sel) seleciona(sel.id);
}

function sincroniza() {
  if (!CONFIG.CSV) {
    $('led').className = 'led'; $('syncTxt').textContent = 'planilha não configurada';
    return Promise.resolve();
  }
  $('syncTxt').textContent = 'sincronizando…';
  const url = CONFIG.CSV + (CONFIG.CSV.indexOf('?') < 0 ? '?' : '&') + 'cb=' + Date.now();
  return fetch(url, { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(txt => {
      const linhas = parseCSV(txt);
      if (!linhas.length) throw new Error('planilha vazia');
      const cab = linhas[0].map(normaliza);
      const iP = cab.indexOf('ponto'), iC = cab.indexOf('categoria'),
            iL = cab.indexOf('legenda'), iA = cab.indexOf('autor');
      if (iP < 0) throw new Error('coluna ponto ausente');
      aplica(linhas.slice(1).map(l => ({
        ponto: l[iP], cat: iC >= 0 ? l[iC] : '', txt: iL >= 0 ? l[iL] : '', autor: iA >= 0 ? l[iA] : ''
      })));
    })
    .catch(e => {
      $('led').className = 'led off';
      $('syncTxt').textContent = 'não consegui ler as legendas (' + e.message + ')';
    });
}

function baixaCSV() {
  const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
  const cab = ['ponto', 'rota', 'arquivo', 'hora', 'lat', 'lon', 'categoria', 'legenda', 'autor'];
  const linhas = PTS.map(p => {
    const L = legendas.get(p.id) || {};
    return [p.id, p.t, p.f, p.h, p.lat, p.lon, L.cat || '', L.txt || '', L.autor || ''];
  });
  const csv = String.fromCharCode(65279) + [cab.join(';')].concat(linhas.map(r => r.map(esc).join(';'))).join(String.fromCharCode(13, 10));
  const b = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = 'pontos-habitar-santana.csv';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 400);
}

Promise.all([
  fetch('dados/pontos.json').then(r => r.json()),
  fetch('dados/rotas.json').then(r => r.json())
]).then(([pontos, rotas]) => {
  PTS = pontos;
  rotas.forEach((r, i) => { ROTAS[r.codigo] = Object.assign({ cor: PALETA[i % PALETA.length] }, r); filtro[r.codigo] = true; });
  PTS.forEach(p => { if (!ROTAS[p.t]) { ROTAS[p.t] = { codigo: p.t, nome: p.t, cor: PALETA[Object.keys(ROTAS).length % PALETA.length], achados: [] }; filtro[p.t] = true; } });
  $('nFotos').textContent = PTS.length;
  $('nRotas').textContent = Object.keys(ROTAS).length;
  const datas = [...new Set(PTS.map(p => p.d))].sort();
  if (datas.length) $('sub').textContent = 'Reconhecimento de território no entorno do campus Santana · ' + (datas.length === 1 ? datas[0] : datas[0] + ' a ' + datas[datas.length - 1]);
  preparaProjecao(); montaChips(); montaAchados(); renderTabela();
  if (PTS.length) seleciona(PTS[0].id); else desenha();
  if (!CONFIG.CSV) {
    const s = $('setup'); s.hidden = false;
    s.textContent = 'Falta ligar a planilha. Preencha CONFIG.CSV e CONFIG.APP no início do app.js.';
  }
  if (!CONFIG.APP) {
    $('bEscrever').removeAttribute('href');
    $('bEscrever').textContent = 'Escrita não configurada';
    $('bEscrever').style.opacity = .5;
  }
  if (CONFIG.PLANILHA) $('bSheet').href = CONFIG.PLANILHA;
  else { $('bSheet').textContent = 'Planilha não configurada'; $('bSheet').style.opacity = .5; $('bSheet').removeAttribute('href'); }
  sincroniza();
  setInterval(sincroniza, 120000);
}).catch(e => {
  const s = $('setup'); s.hidden = false;
  s.innerHTML = '<b>Não consegui carregar os dados.</b> Abrindo o arquivo direto do disco o navegador bloqueia a leitura de <code>dados/pontos.json</code>. Suba num servidor (<code>python -m http.server</code>) ou publique no GitHub Pages. Detalhe: ' + e.message;
});

$('bSync').onclick = () => sincroniza();
$('bPrev').onclick = () => vizinho(-1);
$('bNext').onclick = () => vizinho(1);
$('exCsv').onclick = baixaCSV;
$('cTab').onclick = () => { const b = $('cTab'); const v = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', v); $('tabela').hidden = !v; b.textContent = v ? 'Ocultar tabela' : 'Ver como tabela'; };
document.addEventListener('keydown', e => {
  if (e.target.matches('textarea,select,input')) return;
  if (e.key === 'ArrowRight') vizinho(1);
  if (e.key === 'ArrowLeft') vizinho(-1);
});
