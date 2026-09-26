const CONFIG = {
  CSV: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQAC4K6d8S7mPSxVfCe3BWO8DQPtiZbxr42zqihAbK00MpXu_h65r6WLPcWGICATaU35YRhUYIKa9Hi/pub?gid=71030450&single=true&output=csv",
  APP: "https://script.google.com/macros/s/AKfycbwIvC9s11R-GYjnFxJB6tGdwjl5EkCzkdVqUfC_6VYcwqnLq9tbjQZKyWt0LGaMBb0f/exec"
};
const NS = 'http://www.w3.org/2000/svg';
const PALETA = ['#26707E','#B05622','#5D6B57','#7A5AA6','#A7322A','#2F6B4F','#8A6D1F','#3B5FA8'];
const TRACEJADO = '10 9';
const INTERVALO_SYNC_MS = 120000;
const ALCANCE_CLIQUE_PX = 26;
const ALCANCE_CLIQUE_PONTO_PX = 20;
const TEXTO_SUB = 'Reconhecimento de território no entorno do campus Santana';

let PTS = [], ROTAS = {}, MARCOS = [], TRACADOS = {}, AJUSTES = {}, legendas = new Map(), filtro = {}, soLeg = false, sel = null;
let mapa, camada;

const $ = id => document.getElementById(id);

function elSvg(nome, atributos) {
  const e = document.createElementNS(NS, nome);
  for (const a in atributos) e.setAttribute(a, atributos[a]);
  return e;
}

function elemento(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}

function comParametro(url, chave, valor) {
  return url + (url.indexOf('?') < 0 ? '?' : '&') + chave + '=' + valor;
}

function media(valores) {
  return valores.reduce((a, v) => a + v, 0) / valores.length;
}

function distanciaMetros(a, b) {
  const mLat = 111320, mLon = 111320 * Math.cos(a[0] * Math.PI / 180);
  return Math.hypot((b[1] - a[1]) * mLon, (b[0] - a[0]) * mLat);
}

function normaliza(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

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

function posicao(p) { return AJUSTES[p.id] || [p.lat, p.lon]; }
function cor(codigo) { return (ROTAS[codigo] && ROTAS[codigo].cor) || '#888'; }
function temLegenda(p) { return legendas.has(p.id); }
function visivel(p) { return filtro[p.t] && (!soLeg || temLegenda(p)); }
function ehMarco(item) { return MARCOS.some(m => m.id === item.id); }
function campus() { return MARCOS.find(m => m.tipo === 'campus'); }

function registraRota(rota) {
  ROTAS[rota.codigo] = Object.assign({ cor: PALETA[Object.keys(ROTAS).length % PALETA.length] }, rota);
  filtro[rota.codigo] = true;
}

function raioPonto() {
  const metrosPorPixel = 156543.03 * Math.cos(mapa.getCenter().lat * Math.PI / 180) / Math.pow(2, mapa.getZoom());
  return Math.max(3, Math.min(8, 3.5 / metrosPorPixel - 1.4));
}

function coordenadasDoMapa() {
  const c = PTS.map(posicao);
  Object.keys(ROTAS).forEach(k => (ROTAS[k].tracado || []).forEach(t => c.push(t)));
  return c;
}

function limitesDoMapa() {
  const c = coordenadasDoMapa();
  const ancora = campus();
  if (ancora) c.push([ancora.lat, ancora.lon]);
  return L.latLngBounds(c);
}

function alvoProximo(pt) {
  const distancia = latlon => pt.distanceTo(mapa.latLngToContainerPoint(latlon));
  let alvo = null, menor = ALCANCE_CLIQUE_PX;
  MARCOS.forEach(m => {
    const d = distancia([m.lat, m.lon]);
    if (d < menor) { menor = d; alvo = m.id; }
  });
  PTS.filter(visivel).forEach(p => {
    const d = distancia(posicao(p));
    if (d < Math.min(menor, ALCANCE_CLIQUE_PONTO_PX)) { menor = d; alvo = p.id; }
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
  $('coordBox').textContent = media(todas.map(c => c[0])).toFixed(4) + ', ' + media(todas.map(c => c[1])).toFixed(4);
}

function glifoCampus(g, x, y) {
  g.appendChild(elSvg('path', {
    d: 'M ' + (x - 11) + ' ' + (y + 10) + ' L ' + (x - 11) + ' ' + (y - 1) + ' L ' + x + ' ' + (y - 11) +
      ' L ' + (x + 11) + ' ' + (y - 1) + ' L ' + (x + 11) + ' ' + (y + 10) + ' Z',
    fill: 'var(--ink)' }));
  g.appendChild(elSvg('rect', { x: x - 3, y: y + 2, width: 6, height: 8, fill: 'var(--surface)' }));
  g.appendChild(elSvg('path', {
    d: 'M ' + x + ' ' + (y - 11) + ' L ' + x + ' ' + (y - 19) + ' L ' + (x + 10) + ' ' + (y - 17) + ' L ' + x + ' ' + (y - 15),
    fill: 'var(--accent)', stroke: 'var(--accent)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
}

function glifoMetro(g, x, y) {
  g.appendChild(elSvg('rect', { x: x - 10, y: y - 11, width: 20, height: 17, rx: 4, fill: 'var(--ink)' }));
  [[x - 7, y - 8, 5.5, 5], [x + 1.5, y - 8, 5.5, 5], [x - 7, y - 1, 14, 2]].forEach(([rx, ry, w, h]) =>
    g.appendChild(elSvg('rect', { x: rx, y: ry, width: w, height: h, fill: 'var(--surface)' })));
  g.appendChild(elSvg('path', {
    d: 'M ' + (x - 7) + ' ' + (y + 6) + ' L ' + (x - 11) + ' ' + (y + 12) +
      ' M ' + (x + 7) + ' ' + (y + 6) + ' L ' + (x + 11) + ' ' + (y + 12),
    stroke: 'var(--ink)', 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
}

function iconeMarco(m) {
  const lado = 56, c = lado / 2;
  const svg = elSvg('svg', { viewBox: '0 0 ' + lado + ' ' + lado, width: lado, height: lado });
  svg.style.overflow = 'visible';
  const g = elSvg('g', {});
  g.appendChild(elSvg('circle', { cx: c, cy: c, r: 22, fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 2.4 }));
  (m.tipo === 'metro' ? glifoMetro : glifoCampus)(g, c, c);
  svg.appendChild(g);
  return L.divIcon({
    html: svg, iconSize: [lado, lado], iconAnchor: [c, c],
    className: 'marco' + (sel && sel.id === m.id ? ' sel' : '')
  });
}

function linha(coordenadas, codigo, peso, opacidade, tracejada) {
  L.polyline(coordenadas, {
    color: cor(codigo), weight: peso, opacity: opacidade, lineJoin: 'round', lineCap: 'round',
    dashArray: tracejada ? TRACEJADO : null, interactive: false
  }).addTo(camada);
}

function desenhaRotas() {
  Object.keys(ROTAS).filter(c => filtro[c]).forEach(c => {
    const fotos = PTS.filter(p => p.t === c);
    const ruas = TRACADOS[c];
    if (ruas && ruas.length) return linha(ruas, c, 5, .8, fotos.length < 2);
    if (fotos.length > 1) linha(fotos.map(posicao), c, 4, .55, false);
    if (ROTAS[c].tracado) linha(ROTAS[c].tracado, c, 4, .7, true);
  });
}

function desenhaMarcos() {
  MARCOS.forEach(m => {
    L.marker([m.lat, m.lon], { icon: iconeMarco(m), interactive: false, keyboard: false, title: m.nome })
      .bindTooltip(m.curto || m.nome.split(',')[0], {
        permanent: true, direction: 'bottom', offset: [0, 22], className: 'rotulo-marco'
      })
      .addTo(camada);
  });
}

function circuloPonto(p, raio, borda, ativo) {
  return L.circleMarker(posicao(p), {
    radius: raio, color: ativo ? 'var(--ink)' : cor(p.t), weight: ativo ? borda + 0.2 : borda, opacity: 1,
    fillColor: temLegenda(p) ? cor(p.t) : 'var(--surface)', fillOpacity: 1, interactive: false
  });
}

function desenhaPontos() {
  const raio = raioPonto(), borda = raio < 6 ? 1.4 : 2.2;
  const visiveis = PTS.filter(visivel);
  const ativo = visiveis.find(p => sel && sel.id === p.id);
  visiveis.filter(p => p !== ativo).forEach(p => circuloPonto(p, raio, borda, false).addTo(camada));
  if (!ativo) return;
  L.circleMarker(posicao(ativo), {
    radius: raio * 2, stroke: false, fillColor: 'var(--accent)', fillOpacity: .28, interactive: false
  }).addTo(camada);
  circuloPonto(ativo, raio, borda, true)
    .bindTooltip(ativo.id, { permanent: true, direction: 'top', offset: [0, -raio - 2], className: 'rotulo-id' })
    .addTo(camada);
}

function desenha() {
  if (!mapa) return;
  camada.clearLayers();
  desenhaRotas();
  desenhaMarcos();
  desenhaPontos();
}

class Painel {
  mostraFoto(p) {
    const leg = legendas.get(p.id);
    this._modo(true);
    this._preenche({
      selo: p.id, imagem: 'thumbs/' + p.th, alt: 'Registro fotográfico ' + p.id + ' da rota ' + p.t,
      rotulos: ['Arquivo', 'Horário'], valores: [p.f, p.h], item: p, altitude: p.alt + ' m'
    });
    $('bCat').textContent = (leg && leg.cat) ? leg.cat : 'Sem categoria';
    $('bTxt').textContent = '';
    if (leg && leg.txt) $('bTxt').textContent = leg.txt;
    else $('bTxt').appendChild(this._semLegenda());
    $('bAut').textContent = (leg && leg.autor) ? 'por ' + leg.autor : '';
    if (CONFIG.APP) {
      $('bEscrever').href = comParametro(CONFIG.APP, 'ponto', encodeURIComponent(p.id));
      $('bEscrever').textContent = (leg && leg.txt) ? 'Editar legenda' : 'Escrever legenda';
    }
  }

  mostraMarco(m) {
    const ancora = campus();
    this._modo(false);
    this._preenche({
      selo: m.tipo === 'metro' ? 'Metrô' : 'Campus', imagem: m.foto ? 'marcos/' + m.foto : '', alt: m.nome,
      rotulos: ['Nome', 'Endereço'], valores: [m.nome, m.endereco], item: m,
      altitude: (ancora && ancora.id !== m.id)
        ? Math.round(distanciaMetros([ancora.lat, ancora.lon], [m.lat, m.lon])) + ' m do campus'
        : 'referência do território'
    });
    $('bMarcoNota').textContent = 'Ponto de referência do território, não é registro de campo.' +
      (m.creditoFoto ? ' Imagem: ' + m.creditoFoto + '.' : '');
  }

  desativaEscrita() {
    $('bEscrever').removeAttribute('href');
    $('bEscrever').textContent = 'Escrita não configurada';
    $('bEscrever').style.opacity = .5;
  }

  _modo(ehFoto) {
    ['boxLegenda', 'bEscrever', 'bStatus'].forEach(id => { $(id).hidden = !ehFoto; });
    $('bMarcoNota').hidden = ehFoto;
  }

  _preenche({ selo, imagem, alt, rotulos, valores, item, altitude }) {
    $('bId').textContent = selo;
    $('bImg').src = imagem;
    $('bImg').alt = alt;
    $('dtFile').textContent = rotulos[0];
    $('dtHora').textContent = rotulos[1];
    $('bFile').textContent = valores[0];
    $('bHora').textContent = valores[1];
    $('bCoord').textContent = item.lat.toFixed(6) + ', ' + item.lon.toFixed(6);
    $('bAlt').textContent = altitude;
    const temRua = !!item.rua;
    $('dtRua').hidden = !temRua;
    $('bRua').hidden = !temRua;
    if (temRua) $('bRua').textContent = item.rua;
  }

  _semLegenda() {
    return elemento('span', 'vazio', CONFIG.APP ? 'Sem legenda ainda.' : 'Sem legenda. Escreva na planilha do grupo.');
  }
}

const painel = new Painel();

function seleciona(id) {
  const item = MARCOS.find(m => m.id === id) || PTS.find(p => p.id === id);
  if (!item) return;
  sel = item;
  if (ehMarco(item)) painel.mostraMarco(item); else painel.mostraFoto(item);
  desenha();
}

function vizinho(passo) {
  const vis = PTS.filter(visivel);
  if (!vis.length) return;
  const i = vis.findIndex(p => sel && p.id === sel.id);
  const alvo = vis[(i + passo + vis.length) % vis.length];
  seleciona(alvo.id);
  if (!mapa.getBounds().pad(-0.12).contains(posicao(alvo))) mapa.panTo(posicao(alvo));
}

function criaChip(pressionado, aoAlternar, ...conteudo) {
  const b = elemento('button', 'chip');
  b.setAttribute('aria-pressed', String(pressionado));
  conteudo.forEach(c => b.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  b.onclick = () => {
    const ativo = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', ativo);
    aoAlternar(ativo);
    desenha();
  };
  return b;
}

function montaChips() {
  const barra = $('chips'); barra.textContent = '';
  barra.appendChild(elemento('span', 'eyebrow', 'Rotas'));
  Object.keys(ROTAS).forEach(c => {
    const ponto = elemento('span', 'dot');
    ponto.style.background = cor(c);
    barra.appendChild(criaChip(true, ativo => { filtro[c] = ativo; }, ponto, c.replace('T', 'T-')));
  });
  barra.appendChild(criaChip(false, ativo => { soLeg = ativo; }, 'Só com legenda'));
}

function montaAchados() {
  const box = $('ach'); box.textContent = '';
  Object.keys(ROTAS).forEach(c => {
    const r = ROTAS[c];
    if (!r.achados || !r.achados.length) return;
    const n = PTS.filter(p => p.t === c).length;
    const cartao = elemento('div', 'ach');
    const trilho = elemento('span', 'rail');
    trilho.style.background = cor(c);
    const lista = elemento('ul');
    r.achados.forEach(([titulo, texto]) => {
      const li = elemento('li');
      li.append(elemento('b', null, titulo), texto);
      lista.appendChild(li);
    });
    cartao.append(trilho, elemento('h3', null, r.nome || c),
      elemento('div', 'cnt', n ? n + (n === 1 ? ' foto' : ' fotos') : 'sem registro fotográfico'), lista);
    box.appendChild(cartao);
  });
}

function mostraSync(estado, texto) {
  if (estado != null) $('led').className = 'led' + (estado ? ' ' + estado : '');
  $('syncTxt').textContent = texto;
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
  mostraSync('on', 'legendas lidas às ' + new Date().toLocaleTimeString('pt-BR'));
  desenha();
  if (sel && !ehMarco(sel)) seleciona(sel.id);
}

function legendasDoCSV(txt) {
  const linhas = parseCSV(txt);
  if (!linhas.length) throw new Error('planilha vazia');
  const cabecalho = linhas[0].map(normaliza);
  const coluna = nome => cabecalho.indexOf(nome);
  const [iP, iC, iL, iA] = ['ponto', 'categoria', 'legenda', 'autor'].map(coluna);
  if (iP < 0) throw new Error('coluna ponto ausente');
  const valor = (l, i) => i >= 0 ? l[i] : '';
  return linhas.slice(1).map(l => ({ ponto: l[iP], cat: valor(l, iC), txt: valor(l, iL), autor: valor(l, iA) }));
}

function sincroniza() {
  if (!CONFIG.CSV) {
    mostraSync('', 'planilha não configurada');
    return Promise.resolve();
  }
  mostraSync(null, 'sincronizando…');
  return fetch(comParametro(CONFIG.CSV, 'cb', Date.now()), { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(txt => aplica(legendasDoCSV(txt)))
    .catch(e => mostraSync('off', 'não consegui ler as legendas (' + e.message + ')'));
}

const CB = '?cb=' + Date.now();
function carregaJson(nome, padrao) {
  const pedido = fetch('dados/' + nome + CB, { cache: 'no-store' });
  if (padrao === undefined) return pedido.then(r => r.json());
  return pedido.then(r => r.ok ? r.json() : padrao).catch(() => padrao);
}

function mostraAviso(html) {
  const s = $('setup');
  s.hidden = false;
  s.innerHTML = html;
}

function periodo(datas) {
  return datas.length === 1 ? datas[0] : datas[0] + ' a ' + datas[datas.length - 1];
}

function inicia([pontos, rotas, marcos, tracados, ajustes]) {
  PTS = pontos;
  TRACADOS = tracados || {};
  AJUSTES = ajustes || {};
  MARCOS = marcos || [];
  rotas.forEach(registraRota);
  PTS.forEach(p => { if (!ROTAS[p.t]) registraRota({ codigo: p.t, nome: p.t, achados: [] }); });
  $('nFotos').textContent = PTS.length;
  $('nRotas').textContent = Object.keys(ROTAS).length;
  const datas = [...new Set(PTS.map(p => p.d))].sort();
  if (datas.length) $('sub').textContent = TEXTO_SUB + ' · ' + periodo(datas);
  preparaMapa(); montaChips(); montaAchados();
  if (PTS.length) seleciona(PTS[0].id); else desenha();
  if (!CONFIG.CSV) mostraAviso('Falta ligar a planilha. Preencha CONFIG.CSV e CONFIG.APP no início do app.js.');
  if (!CONFIG.APP) painel.desativaEscrita();
  sincroniza();
  setInterval(sincroniza, INTERVALO_SYNC_MS);
}

Promise.all([
  carregaJson('pontos.json'),
  carregaJson('rotas.json'),
  carregaJson('marcos.json', []),
  carregaJson('tracados.json', {}),
  carregaJson('ajustes.json', {})
]).then(inicia).catch(e => mostraAviso(
  '<b>Não consegui carregar os dados.</b> Abrindo o arquivo direto do disco o navegador bloqueia a leitura de <code>dados/pontos.json</code>. Suba num servidor (<code>python -m http.server</code>) ou publique no GitHub Pages. Detalhe: ' + e.message));

class Tema {
  static ICONE_SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  static ICONE_LUA = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.35 15.35A9 9 0 018.65 3.65a9 9 0 1011.7 11.7z"/></svg>';

  constructor(botao) {
    this.botao = botao;
    this.raiz = document.documentElement;
    this.barras = [...document.querySelectorAll('meta[name="theme-color"]')];
    this.coresBarra = {};
    this.barras.forEach(m => { this.coresBarra[this._temaDaMidia(m)] = m.content; });
    botao.onclick = () => this.alterna();
    this.atualiza();
  }

  forcado() { return this.raiz.getAttribute('data-theme'); }

  atual() {
    return this.forcado() || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  alterna() {
    const novo = this.atual() === 'dark' ? 'light' : 'dark';
    this.raiz.setAttribute('data-theme', novo);
    try { localStorage.setItem('tema', novo); } catch (e) {}
    this.atualiza();
  }

  atualiza() {
    const escuro = this.atual() === 'dark';
    const rotulo = escuro ? 'Mudar para modo claro' : 'Mudar para modo escuro';
    this.botao.setAttribute('aria-pressed', String(escuro));
    this.botao.innerHTML = escuro ? Tema.ICONE_SOL : Tema.ICONE_LUA;
    this.botao.setAttribute('aria-label', rotulo);
    this.botao.title = rotulo;
    const forcado = this.forcado();
    this.barras.forEach(m => { m.content = this.coresBarra[forcado || this._temaDaMidia(m)]; });
  }

  _temaDaMidia(meta) { return meta.media.indexOf('dark') >= 0 ? 'dark' : 'light'; }
}

new Tema($('bTema'));

$('bSync').onclick = () => sincroniza();
$('bPrev').onclick = () => vizinho(-1);
$('bNext').onclick = () => vizinho(1);
document.addEventListener('keydown', e => {
  if (e.target.matches('textarea,select,input')) return;
  if (e.key === 'ArrowRight') vizinho(1);
  if (e.key === 'ArrowLeft') vizinho(-1);
});
