const CONFIG = {
  // Link CSV da planilha publicada na web. Le as legendas.
  CSV: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQAC4K6d8S7mPSxVfCe3BWO8DQPtiZbxr42zqihAbK00MpXu_h65r6WLPcWGICATaU35YRhUYIKa9Hi/pub?gid=71030450&single=true&output=csv",
  // URL /exec do Apps Script restrito a contas Google. Abre o formulario de escrita.
  APP: "https://script.google.com/macros/s/AKfycbwIvC9s11R-GYjnFxJB6tGdwjl5EkCzkdVqUfC_6VYcwqnLq9tbjQZKyWt0LGaMBb0f/exec"
};
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const PALETA = ['#26707E','#B05622','#5D6B57','#7A5AA6','#A7322A','#2F6B4F','#8A6D1F','#3B5FA8'];

let PTS = [], ROTAS = {}, MARCOS = [], TRACADOS = {}, AJUSTES = {}, legendas = new Map(), filtro = {}, soLeg = false, sel = null;

function el(n, at) { const e = document.createElementNS(NS, n); for (const a in at) e.setAttribute(a, at[a]); return e; }
function raioPonto() {
  const metrosPorPixel = 156543.03 * Math.cos(mapa.getCenter().lat * Math.PI / 180) / Math.pow(2, mapa.getZoom());
  return Math.max(3, Math.min(8, 3.5 / metrosPorPixel - 1.4));
}
function posicao(p) { return AJUSTES[p.id] || [p.lat, p.lon]; }
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

let mapa, camada;
function distanciaMetros(a, b) {
  const mLat = 111320, mLon = 111320 * Math.cos(a[0] * Math.PI / 180);
  return Math.hypot((b[1] - a[1]) * mLon, (b[0] - a[0]) * mLat);
}

function coordenadasDoMapa() {
  const c = PTS.map(posicao);
  Object.keys(ROTAS).forEach(k => (ROTAS[k].tracado || []).forEach(t => c.push(t)));
  return c;
}

function limitesDoMapa() {
  const c = coordenadasDoMapa();
  const campus = MARCOS.find(m => m.tipo === 'campus');
  if (campus) c.push([campus.lat, campus.lon]);
  return L.latLngBounds(c);
}

function alvoProximo(pt) {
  let alvo = null, menor = 26;
  MARCOS.forEach(m => {
    const d = pt.distanceTo(mapa.latLngToContainerPoint([m.lat, m.lon]));
    if (d < menor) { menor = d; alvo = m.id; }
  });
  PTS.forEach(p => {
    if (!filtro[p.t] || (soLeg && !legendas.has(p.id))) return;
    const d = pt.distanceTo(mapa.latLngToContainerPoint(posicao(p)));
    if (d < Math.min(menor, 20)) { menor = d; alvo = p.id; }
  });
  return alvo;
}

function preparaMapa() {
  mapa = L.map('mapa', { keyboard: false, scrollWheelZoom: false, minZoom: 13, maxZoom: 19, zoomSnap: 0.5 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
  }).addTo(mapa);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapa);
  camada = L.layerGroup().addTo(mapa);
  mapa.fitBounds(limitesDoMapa(), { padding: [40, 40] });
  mapa.on('click', ev => {
    mapa.scrollWheelZoom.enable();
    const alvo = alvoProximo(ev.containerPoint);
    if (alvo) seleciona(alvo);
  });
  mapa.on('zoomend', desenha);
  mapa.on('mouseout', () => mapa.scrollWheelZoom.disable());
  mapa.on('mousemove', ev => { mapa.getContainer().style.cursor = alvoProximo(ev.containerPoint) ? 'pointer' : ''; });
  const todas = coordenadasDoMapa();
  const lat0 = todas.reduce((a, c) => a + c[0], 0) / todas.length;
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

function iconeMarco(m) {
  const s = 56, c = s / 2;
  const svg = el('svg', { viewBox: '0 0 ' + s + ' ' + s, width: s, height: s });
  svg.style.overflow = 'visible';
  const g = el('g', {});
  g.appendChild(el('circle', { cx: c, cy: c, r: 22, fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 2.4 }));
  if (m.tipo === 'metro') glifoMetro(g, c, c, 1); else glifoCampus(g, c, c, 1);
  svg.appendChild(g);
  return L.divIcon({
    html: svg, iconSize: [s, s], iconAnchor: [c, c],
    className: 'marco' + (sel && sel.id === m.id ? ' sel' : '')
  });
}

function desenha() {
  if (!mapa) return;
  camada.clearLayers();
  Object.keys(ROTAS).forEach(c => {
    if (!filtro[c]) return;
    const ps = PTS.filter(p => p.t === c);
    const ruas = TRACADOS[c];
    if (ruas && ruas.length) {
      L.polyline(ruas, {
        color: cor(c), weight: 5, opacity: .8, lineJoin: 'round', lineCap: 'round',
        dashArray: ps.length > 1 ? null : '10 9', interactive: false
      }).addTo(camada);
      return;
    }
    if (ps.length > 1) {
      L.polyline(ps.map(posicao), {
        color: cor(c), weight: 4, opacity: .55, lineJoin: 'round', lineCap: 'round', interactive: false
      }).addTo(camada);
    }
    if (ROTAS[c].tracado) {
      L.polyline(ROTAS[c].tracado, {
        color: cor(c), weight: 4, opacity: .7, dashArray: '10 9', lineCap: 'round', interactive: false
      }).addTo(camada);
    }
  });
  MARCOS.forEach(m => {
    const marcador = L.marker([m.lat, m.lon], { icon: iconeMarco(m), interactive: false, keyboard: false, title: m.nome });
    marcador.bindTooltip(m.curto || m.nome.split(',')[0], {
      permanent: true, direction: 'bottom', offset: [0, 22], className: 'rotulo-marco'
    });
    marcador.addTo(camada);
  });
  const raio = raioPonto(), borda = raio < 6 ? 1.4 : 2.2;
  const visiveis = PTS.filter(p => filtro[p.t] && !(soLeg && !legendas.has(p.id)));
  const ativo = visiveis.find(p => sel && sel.id === p.id);
  visiveis.filter(p => p !== ativo).forEach(p => {
    L.circleMarker(posicao(p), {
      radius: raio, color: cor(p.t), weight: borda, opacity: 1,
      fillColor: legendas.has(p.id) ? cor(p.t) : 'var(--surface)', fillOpacity: 1, interactive: false
    }).addTo(camada);
  });
  if (ativo) {
    L.circleMarker(posicao(ativo), {
      radius: raio * 2, stroke: false, fillColor: 'var(--accent)', fillOpacity: .28, interactive: false
    }).addTo(camada);
    L.circleMarker(posicao(ativo), {
      radius: raio, color: 'var(--ink)', weight: borda + 0.2, opacity: 1,
      fillColor: legendas.has(ativo.id) ? cor(ativo.t) : 'var(--surface)', fillOpacity: 1, interactive: false
    }).bindTooltip(ativo.id, { permanent: true, direction: 'top', offset: [0, -raio - 2], className: 'rotulo-id' })
      .addTo(camada);
  }
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
  const alvo = vis[(i + d + vis.length) % vis.length];
  seleciona(alvo.id);
  if (!mapa.getBounds().pad(-0.12).contains(posicao(alvo))) mapa.panTo(posicao(alvo));
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
  fetch('dados/marcos.json' + CB, { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []),
  fetch('dados/tracados.json' + CB, { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
  fetch('dados/ajustes.json' + CB, { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({}))
]).then(([pontos, rotas, marcos, tracados, ajustes]) => {
  PTS = pontos;
  TRACADOS = tracados || {};
  AJUSTES = ajustes || {};
  MARCOS = marcos || [];
  rotas.forEach((r, i) => { ROTAS[r.codigo] = Object.assign({ cor: PALETA[i % PALETA.length] }, r); filtro[r.codigo] = true; });
  PTS.forEach(p => { if (!ROTAS[p.t]) { ROTAS[p.t] = { codigo: p.t, nome: p.t, cor: PALETA[Object.keys(ROTAS).length % PALETA.length], achados: [] }; filtro[p.t] = true; } });
  $('nFotos').textContent = PTS.length;
  $('nRotas').textContent = Object.keys(ROTAS).length;
  const datas = [...new Set(PTS.map(p => p.d))].sort();
  if (datas.length) $('sub').textContent = 'Reconhecimento de território no entorno do campus Santana · ' + (datas.length === 1 ? datas[0] : datas[0] + ' a ' + datas[datas.length - 1]);
  preparaMapa(); montaChips(); montaAchados();
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

$('bSync').onclick = () => sincroniza();
$('bPrev').onclick = () => vizinho(-1);
$('bNext').onclick = () => vizinho(1);
document.addEventListener('keydown', e => {
  if (e.target.matches('textarea,select,input')) return;
  if (e.key === 'ArrowRight') vizinho(1);
  if (e.key === 'ArrowLeft') vizinho(-1);
});
