const CONFIG = {
  // Link CSV da planilha publicada na web. Le as legendas.
  CSV: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQAC4K6d8S7mPSxVfCe3BWO8DQPtiZbxr42zqihAbK00MpXu_h65r6WLPcWGICATaU35YRhUYIKa9Hi/pub?gid=71030450&single=true&output=csv",
  // URL /exec do Apps Script restrito a contas Google. Abre o formulario de escrita.
  APP: "https://script.google.com/macros/s/AKfycbwIvC9s11R-GYjnFxJB6tGdwjl5EkCzkdVqUfC_6VYcwqnLq9tbjQZKyWt0LGaMBb0f/exec"
};
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const PALETA = ['#26707E','#B05622','#5D6B57','#7A5AA6','#A7322A','#2F6B4F','#8A6D1F','#3B5FA8'];

let PTS = [], ROTAS = {}, MARCOS = [], legendas = new Map(), filtro = {}, soLeg = false, sel = null;

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
function distanciaMetros(a, b) {
  const mLat = 111320, mLon = 111320 * Math.cos(a[0] * Math.PI / 180);
  return Math.hypot((b[1] - a[1]) * mLon, (b[0] - a[0]) * mLat);
}

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

function glifoCampus(g, x, y, escala) {
  const e = v => v * escala;
  g.appendChild(el('path', { d: 'M ' + (x - e(11)) + ' ' + (y + e(10)) + ' L ' + (x - e(11)) + ' ' + (y - e(1)) +
    ' L ' + x + ' ' + (y - e(11)) + ' L ' + (x + e(11)) + ' ' + (y - e(1)) + ' L ' + (x + e(11)) + ' ' + (y + e(10)) + ' Z',
    fill: 'var(--ink)' }));
  g.appendChild(el('rect', { x: x - e(3), y: y + e(2), width: e(6), height: e(8), fill: 'var(--surface)' }));
  g.appendChild(el('path', { d: 'M ' + x + ' ' + (y - e(11)) + ' L ' + x + ' ' + (y - e(19)) +
    ' L ' + (x + e(10)) + ' ' + (y - e(17)) + ' L ' + x + ' ' + (y - e(15)),
    fill: 'var(--accent)', stroke: 'var(--accent)', 'stroke-width': e(1.5), 'stroke-linejoin': 'round' }));
}

function glifoMetro(g, x, y, escala) {
  const e = v => v * escala;
  g.appendChild(el('rect', { x: x - e(10), y: y - e(11), width: e(20), height: e(17), rx: e(4), fill: 'var(--ink)' }));
  g.appendChild(el('rect', { x: x - e(7), y: y - e(8), width: e(5.5), height: e(5), fill: 'var(--surface)' }));
  g.appendChild(el('rect', { x: x + e(1.5), y: y - e(8), width: e(5.5), height: e(5), fill: 'var(--surface)' }));
  g.appendChild(el('rect', { x: x - e(7), y: y - e(1), width: e(14), height: e(2), fill: 'var(--surface)' }));
  g.appendChild(el('path', { d: 'M ' + (x - e(7)) + ' ' + (y + e(6)) + ' L ' + (x - e(11)) + ' ' + (y + e(12)) +
    ' M ' + (x + e(7)) + ' ' + (y + e(6)) + ' L ' + (x + e(11)) + ' ' + (y + e(12)),
    stroke: 'var(--ink)', 'stroke-width': e(2.4), 'stroke-linecap': 'round' }));
}

function desenhaMarco(m) {
  let [x, y] = projLatLon(m.lat, m.lon);
  const limite = 30;
  const fora = x < limite || x > SZ - limite || y < limite || y > SZ - limite;
  const escala = fora ? 0.72 : 1;
  let rotulo = m.curto || m.nome.split(',')[0];
  if (fora) {
    const ancora = MARCOS.find(o => o.tipo === 'campus') || m;
    const d = Math.round(distanciaMetros([ancora.lat, ancora.lon], [m.lat, m.lon]) / 10) * 10;
    if (d) rotulo += ', ' + d + ' m';
    x = Math.max(limite, Math.min(SZ - limite, x));
    y = Math.max(limite, Math.min(SZ - limite, y));
  }
  m._x = x; m._y = y;
  const g = el('g', { class: 'marco' + (sel && sel.id === m.id ? ' sel' : ''), tabindex: 0, role: 'button',
    'aria-label': m.nome + ', ' + m.endereco });
  const t = el('title', {});
  t.textContent = m.nome + ', ' + m.endereco + (fora ? ' (fora da área percorrida)' : '');
  g.appendChild(t);
  g.appendChild(el('circle', { cx: x, cy: y, r: 22 * escala, fill: 'var(--surface)',
    stroke: 'var(--ink)', 'stroke-width': 2.4 * escala,
    'stroke-dasharray': fora ? '5 4' : 'none' }));
  if (m.tipo === 'metro') glifoMetro(g, x, y, escala); else glifoCampus(g, x, y, escala);
  const margem = 160;
  const ancoragem = x < margem ? 'start' : (x > SZ - margem ? 'end' : 'middle');
  const deslocaX = ancoragem === 'start' ? 26 * escala : (ancoragem === 'end' ? -26 * escala : 0);
  const acima = y > SZ - 70;
  const txt = el('text', { x: x + deslocaX, y: acima ? y - 32 * escala : y + 40 * escala,
    'text-anchor': ancoragem, fill: 'var(--ink)',
    'font-size': 19 * escala, 'font-family': 'Archivo, sans-serif', 'font-weight': 600 });
  txt.textContent = rotulo;
  g.appendChild(txt);
  g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); seleciona(m.id); } });
  return g;
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
  MARCOS.forEach(m => g.appendChild(desenhaMarco(m)));
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
  const m = MARCOS.find(o => o.id === id);
  if (m) return selecionaMarco(m);
  const p = PTS.find(q => q.id === id); if (!p) return; sel = p;
  $('boxLegenda').hidden = false;
  $('bEscrever').hidden = false;
  $('bStatus').hidden = false;
  $('bMarcoNota').hidden = true;
  $('bId').textContent = p.id;
  $('bImg').src = 'thumbs/' + p.th;
  $('bImg').alt = 'Registro fotográfico ' + p.id + ' da rota ' + p.t;
  $('dtFile').textContent = 'Arquivo';
  $('dtHora').textContent = 'Horário';
  $('bFile').textContent = p.f;
  $('bHora').textContent = p.h;
  $('bCoord').textContent = p.lat.toFixed(6) + ', ' + p.lon.toFixed(6);
  $('bAlt').textContent = p.alt + ' m';
  mostraRua(p.rua);
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

function selecionaMarco(m) {
  sel = m;
  $('boxLegenda').hidden = true;
  $('bEscrever').hidden = true;
  $('bStatus').hidden = true;
  $('bMarcoNota').hidden = false;
  $('bId').textContent = m.tipo === 'metro' ? 'Metrô' : 'Campus';
  $('bImg').src = m.foto ? 'marcos/' + m.foto : '';
  $('bImg').alt = m.nome;
  $('dtFile').textContent = 'Nome';
  $('dtHora').textContent = 'Endereço';
  $('bFile').textContent = m.nome;
  $('bHora').textContent = m.endereco;
  $('bCoord').textContent = m.lat.toFixed(6) + ', ' + m.lon.toFixed(6);
  const ancora = MARCOS.find(o => o.tipo === 'campus');
  $('bAlt').textContent = (ancora && ancora.id !== m.id)
    ? Math.round(distanciaMetros([ancora.lat, ancora.lon], [m.lat, m.lon])) + ' m do campus'
    : 'referência do território';
  $('bMarcoNota').textContent = 'Ponto de referência do território, não é registro de campo.' +
    (m.creditoFoto ? ' Imagem: ' + m.creditoFoto + '.' : '');
  mostraRua(m.rua);
  desenha();
}

function mostraRua(rua) {
  const tem = !!rua;
  $('dtRua').hidden = !tem;
  $('bRua').hidden = !tem;
  if (tem) $('bRua').textContent = rua;
}

// clique unico no mapa, em vez de um clique por circulo: em agrupamentos densos os
// halos se sobrepoem e o navegador pode escolher o circulo errado por ordem de
// desenho; aqui sempre ganha o ponto/marco cujo centro esta mais perto do clique
function clicaNoMapa(ev) {
  const svg = $('mapa');
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const p = pt.matrixTransform(ctm.inverse());
  let alvo = null, menor = 22;
  MARCOS.forEach(m => {
    if (m._x == null) return;
    const d = Math.hypot(m._x - p.x, m._y - p.y);
    if (d < menor) { menor = d; alvo = m.id; }
  });
  PTS.forEach(q => {
    if (!filtro[q.t] || (soLeg && !legendas.has(q.id))) return;
    const d = Math.hypot(q._x - p.x, q._y - p.y);
    if (d < menor) { menor = d; alvo = q.id; }
  });
  if (alvo) seleciona(alvo);
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

function montaChips() {
  const bar = $('chips'); bar.textContent = '';
  const lb = document.createElement('span'); lb.className = 'eyebrow'; lb.textContent = 'Rotas'; bar.appendChild(lb);
  Object.keys(ROTAS).forEach(c => {
    const b = document.createElement('button');
    b.className = 'chip'; b.setAttribute('aria-pressed', 'true');
    const d = document.createElement('span'); d.className = 'dot'; d.style.background = cor(c);
    b.appendChild(d);
    b.appendChild(document.createTextNode(c.replace('T', 'T-')));
    b.onclick = () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', v); filtro[c] = v; desenha(); };
    bar.appendChild(b);
  });
  const bl = document.createElement('button');
  bl.className = 'chip'; bl.setAttribute('aria-pressed', 'false'); bl.textContent = 'Só com legenda';
  bl.onclick = () => { const v = bl.getAttribute('aria-pressed') !== 'true'; bl.setAttribute('aria-pressed', v); soLeg = v; desenha(); };
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
  desenha(); if (sel && !MARCOS.some(m => m.id === sel.id)) seleciona(sel.id);
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

const CB = '?cb=' + Date.now();
Promise.all([
  fetch('dados/pontos.json' + CB, { cache: 'no-store' }).then(r => r.json()),
  fetch('dados/rotas.json' + CB, { cache: 'no-store' }).then(r => r.json()),
  fetch('dados/marcos.json' + CB, { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => [])
]).then(([pontos, rotas, marcos]) => {
  PTS = pontos;
  MARCOS = marcos || [];
  rotas.forEach((r, i) => { ROTAS[r.codigo] = Object.assign({ cor: PALETA[i % PALETA.length] }, r); filtro[r.codigo] = true; });
  PTS.forEach(p => { if (!ROTAS[p.t]) { ROTAS[p.t] = { codigo: p.t, nome: p.t, cor: PALETA[Object.keys(ROTAS).length % PALETA.length], achados: [] }; filtro[p.t] = true; } });
  $('nFotos').textContent = PTS.length;
  $('nRotas').textContent = Object.keys(ROTAS).length;
  const datas = [...new Set(PTS.map(p => p.d))].sort();
  if (datas.length) $('sub').textContent = 'Reconhecimento de território no entorno do campus Santana · ' + (datas.length === 1 ? datas[0] : datas[0] + ' a ' + datas[datas.length - 1]);
  preparaProjecao(); montaChips(); montaAchados();
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
  sincroniza();
  setInterval(sincroniza, 120000);
}).catch(e => {
  const s = $('setup'); s.hidden = false;
  s.innerHTML = '<b>Não consegui carregar os dados.</b> Abrindo o arquivo direto do disco o navegador bloqueia a leitura de <code>dados/pontos.json</code>. Suba num servidor (<code>python -m http.server</code>) ou publique no GitHub Pages. Detalhe: ' + e.message;
});

const ICONE_SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const ICONE_LUA = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.35 15.35A9 9 0 018.65 3.65a9 9 0 1011.7 11.7z"/></svg>';

function temaAtual() {
  const forcado = document.documentElement.getAttribute('data-theme');
  if (forcado) return forcado;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function atualizaBotaoTema() {
  const escuro = temaAtual() === 'dark';
  const b = $('bTema');
  b.setAttribute('aria-pressed', String(escuro));
  b.innerHTML = escuro ? ICONE_SOL : ICONE_LUA;
  const rotulo = escuro ? 'Mudar para modo claro' : 'Mudar para modo escuro';
  b.setAttribute('aria-label', rotulo); b.title = rotulo;
}
$('bTema').onclick = () => {
  const novo = temaAtual() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', novo);
  try { localStorage.setItem('tema', novo); } catch (e) {}
  atualizaBotaoTema();
};
atualizaBotaoTema();

$('mapa').addEventListener('click', clicaNoMapa);
$('bSync').onclick = () => sincroniza();
$('bPrev').onclick = () => vizinho(-1);
$('bNext').onclick = () => vizinho(1);
document.addEventListener('keydown', e => {
  if (e.target.matches('textarea,select,input')) return;
  if (e.key === 'ArrowRight') vizinho(1);
  if (e.key === 'ArrowLeft') vizinho(-1);
});
