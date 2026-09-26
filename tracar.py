#!/usr/bin/env python3
"""Gera dados/tracados.json (trajeto de cada rota no eixo das ruas do OpenStreetMap) e
dados/ajustes.json."""
import heapq, json, math, time, urllib.error, urllib.parse, urllib.request
from comum import CONTATO_APP, dado, grava_json, le_json

SAIDA = dado('tracados.json')
SAIDA_AJUSTES = dado('ajustes.json')
METROS_POR_GRAU = 111320.0
MARGEM_RUAS_M = 120
MARGEM_EDIF_M = 60
DISTANCIA_MAX_M = 80
FOLGA_EDIF_M = 3.0
SEPARACAO_M = 8.0
RAIO_BUSCA_M = 35.0
PASSO_M = 0.5
ESPACO_CANDIDATOS_M = 0.75
MIN_CANDIDATOS = 8
FAIXA_MIN_RUA_M = 6.0
DESVIO_MIN_M = 0.1
DESLOCAMENTO_ALERTA_M = 25


def media(valores):
    return sum(valores) / len(valores)


def caixa(pts, margem_m):
    mlat = margem_m / METROS_POR_GRAU
    mlon = margem_m / (METROS_POR_GRAU * math.cos(math.radians(media([p[0] for p in pts]))))
    return (min(p[0] for p in pts) - mlat, min(p[1] for p in pts) - mlon,
            max(p[0] for p in pts) + mlat, max(p[1] for p in pts) + mlon)


def projecao(px, py, dx, dy):
    t = 0.0 if dx == 0 and dy == 0 else max(0.0, min(1.0, (px * dx + py * dy) / (dx * dx + dy * dy)))
    return t, math.hypot(px - t * dx, py - t * dy)


def geometria(elemento):
    return [[g['lat'], g['lon']] for g in elemento['geometry']]


class Overpass:
    URL = 'https://overpass-api.de/api/interpreter'
    CAMINHO_CACHE = dado('cache-osm.json')
    TENTATIVAS = 4
    CODIGOS_OCUPADO = (429, 502, 503, 504)

    def __init__(self):
        self.cache = le_json(self.CAMINHO_CACHE, {})

    def salva(self):
        grava_json(self.CAMINHO_CACHE, self.cache)

    def ruas(self, nome, bbox):
        consulta = '[out:json][timeout:25];way["highway"]["name"~"^%s$",i](%.6f,%.6f,%.6f,%.6f);out geom;' % (
            (nome.replace('"', '\\"'),) + tuple(bbox))
        return self._busca(nome, bbox, consulta, lambda dados: [
            {'id': e['id'], 'nodes': e['nodes'], 'geom': geometria(e)}
            for e in dados.get('elements', []) if e.get('type') == 'way' and 'geometry' in e])

    def edificios(self, bbox):
        txt = '%.6f,%.6f,%.6f,%.6f' % tuple(bbox)
        consulta = ('[out:json][timeout:60];(way["building"]["building"!="no"](%s);'
                    'relation["building"]["building"!="no"](%s););out geom;') % (txt, txt)
        return self._busca('edificios', bbox, consulta, self._aneis)

    @staticmethod
    def _aneis(dados):
        aneis = []
        for e in dados.get('elements', []):
            if e.get('type') == 'way' and 'geometry' in e:
                aneis.append(geometria(e))
            elif e.get('type') == 'relation':
                aneis += [geometria(m) for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
        return aneis

    def _busca(self, prefixo, bbox, consulta, extrai):
        guardado = self._guardado(prefixo, bbox)
        if guardado is not None:
            return guardado
        valor = extrai(self._consulta(consulta))
        self.cache['%s|%.4f,%.4f,%.4f,%.4f' % ((prefixo,) + tuple(bbox))] = valor
        return valor

    def _guardado(self, prefixo, bbox):
        for chave, valor in self.cache.items():
            nome, _, caixa_txt = chave.rpartition('|')
            if nome != prefixo:
                continue
            s, w, n, e = (float(v) for v in caixa_txt.split(','))
            if s <= bbox[0] and w <= bbox[1] and n >= bbox[2] and e >= bbox[3]:
                return valor
        return None

    def _consulta(self, consulta):
        corpo = urllib.parse.urlencode({'data': consulta}).encode()
        for tentativa in range(self.TENTATIVAS):
            ultima = tentativa == self.TENTATIVAS - 1
            req = urllib.request.Request(self.URL, data=corpo, headers={'User-Agent': CONTATO_APP})
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    dados = json.loads(resp.read().decode('utf-8'))
                time.sleep(2)
                return dados
            except urllib.error.HTTPError as erro:
                if erro.code not in self.CODIGOS_OCUPADO or ultima:
                    raise
            except urllib.error.URLError:
                if ultima:
                    raise
            espera = 15 * (tentativa + 1)
            print('  Overpass ocupado, nova tentativa em %d s' % espera)
            time.sleep(espera)


class Plano:
    def __init__(self, lat0, lon0=0.0):
        self.lat0, self.lon0 = lat0, lon0
        self.ky = METROS_POR_GRAU
        self.kx = METROS_POR_GRAU * math.cos(math.radians(lat0))

    def xy(self, lat, lon):
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def latlon(self, x, y):
        return self.lat0 + y / self.ky, self.lon0 + x / self.kx

    def delta(self, p, q):
        return (q[1] - p[1]) * self.kx, (q[0] - p[0]) * self.ky

    def dist(self, p, q):
        return math.hypot(*self.delta(p, q))


class Edificios:
    CELULA = 20.0

    def __init__(self, aneis, plano):
        self.grade = {}
        borda = FOLGA_EDIF_M + 1
        for anel in aneis:
            if len(anel) < 4:
                continue
            xy = [plano.xy(lat, lon) for lat, lon in anel]
            xs, ys = [p[0] for p in xy], [p[1] for p in xy]
            pol = (min(xs), min(ys), max(xs), max(ys), xy)
            for i in self._celulas(pol[0] - borda, pol[2] + borda):
                for j in self._celulas(pol[1] - borda, pol[3] + borda):
                    self.grade.setdefault((i, j), []).append(pol)

    def _celulas(self, inicio, fim):
        return range(math.floor(inicio / self.CELULA), math.floor(fim / self.CELULA) + 1)

    def livre(self, x, y, folga=FOLGA_EDIF_M):
        for x0, y0, x1, y1, xy in self.grade.get((math.floor(x / self.CELULA), math.floor(y / self.CELULA)), ()):
            if x < x0 - folga or x > x1 + folga or y < y0 - folga or y > y1 + folga:
                continue
            dentro = False
            menor = math.inf
            for (ax, ay), (bx, by) in zip(xy, xy[1:]):
                if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                    dentro = not dentro
                menor = min(menor, projecao(x - ax, y - ay, bx - ax, by - ay)[1])
            if dentro or menor < folga:
                return False
        return True


class Rede:
    def __init__(self, ways, plano):
        self.plano = plano
        self.coord, self.adj, self.seg, self.comp, self.ordem = {}, {}, {}, {}, {}
        for w in ways:
            self.ordem[w['id']] = []
            for i, (a, b) in enumerate(zip(w['nodes'], w['nodes'][1:])):
                chave = (w['id'], i)
                self.coord[a], self.coord[b] = w['geom'][i], w['geom'][i + 1]
                self.seg[chave] = (a, b)
                self.comp[chave] = plano.dist(w['geom'][i], w['geom'][i + 1])
                self.adj.setdefault(a, []).append((b, self.comp[chave], chave))
                self.adj.setdefault(b, []).append((a, self.comp[chave], chave))
                self.ordem[w['id']].append(chave)

    def projeta(self, lat, lon):
        melhor = None
        for k, (a, b) in self.seg.items():
            pa, pb = self.coord[a], self.coord[b]
            t, d = projecao(*self.plano.delta(pa, (lat, lon)), *self.plano.delta(pa, pb))
            if melhor is None or d < melhor[0]:
                melhor = (d, k, t)
        return melhor

    def encaixa(self, lat, lon):
        melhor = self.projeta(lat, lon)
        if melhor is None or melhor[0] > DISTANCIA_MAX_M:
            return None
        return melhor[1], melhor[2]

    def mais_proximo(self, lat, lon):
        d, k, t = self.projeta(lat, lon)
        return self.ponto(k, t, arredonda=False), d

    def cobertura(self, s1, s2):
        (k1, t1), (k2, t2) = s1, s2
        if k1 == k2:
            return [(k1, min(t1, t2), max(t1, t2))]
        a1, b1 = self.seg[k1]
        a2, b2 = self.seg[k2]
        custo = {a1: t1 * self.comp[k1], b1: (1 - t1) * self.comp[k1]}
        origem = {a1: a1, b1: b1}
        anterior = {}
        fila = [(c, n) for n, c in custo.items()]
        heapq.heapify(fila)
        while fila:
            c, n = heapq.heappop(fila)
            if c > custo.get(n, math.inf):
                continue
            for viz, d, chave in self.adj.get(n, []):
                nc = c + d
                if nc < custo.get(viz, math.inf):
                    custo[viz], anterior[viz], origem[viz] = nc, (n, chave), origem[n]
                    heapq.heappush(fila, (nc, viz))
        finais = {a2: t2 * self.comp[k2], b2: (1 - t2) * self.comp[k2]}
        alcancaveis = [n for n in finais if n in custo]
        if not alcancaveis:
            return None
        fim = min(alcancaveis, key=lambda n: custo[n] + finais[n])
        cob = [(k2, 0.0, t2) if fim == a2 else (k2, t2, 1.0)]
        cob.append((k1, 0.0, t1) if origem[fim] == a1 else (k1, t1, 1.0))
        n = fim
        while n in anterior:
            n, chave = anterior[n]
            cob.append((chave, 0.0, 1.0))
        return cob

    def ponto(self, chave, t, arredonda=True):
        a, b = self.seg[chave]
        pa, pb = self.coord[a], self.coord[b]
        p = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]
        return [round(p[0], 6), round(p[1], 6)] if arredonda else p

    @staticmethod
    def _une(intervalos):
        unidos = []
        for t0, t1 in sorted(intervalos):
            if unidos and t0 <= unidos[-1][1] + 1e-9:
                unidos[-1][1] = max(unidos[-1][1], t1)
            else:
                unidos.append([t0, t1])
        return unidos

    def polilinhas(self, cob):
        por_seg = {}
        for chave, t0, t1 in cob:
            por_seg.setdefault(chave, []).append((t0, t1))
        linhas = []
        for ids in self.ordem.values():
            atual = None
            for chave in ids:
                if chave not in por_seg:
                    atual = None
                    continue
                for t0, t1 in self._une(por_seg[chave]):
                    p0, p1 = self.ponto(chave, t0), self.ponto(chave, t1)
                    if atual and atual[-1] == p0:
                        atual.append(p1)
                    else:
                        atual = [p0, p1]
                        linhas.append(atual)
        return [l for l in linhas if len(l) > 1 and l[0] != l[-1]]


def sequencia_da_rota(rota, fotos):
    inicio = [rota['inicio']] if rota.get('inicio') else []
    fim = [rota['fim']] if rota.get('fim') else []
    return inicio + (fotos or rota.get('tracado') or []) + fim


def ways_das_ruas(nomes, bbox, overpass, cod):
    vistos = {}
    for nome in nomes:
        try:
            ways = overpass.ruas(nome, bbox)
        except Exception as erro:
            print('  aviso: nao foi possivel buscar "%s" no Overpass - %s' % (nome, erro))
            continue
        if not ways:
            print('  aviso: "%s" nao encontrada no OpenStreetMap perto de %s' % (nome, cod))
        for w in ways:
            vistos[w['id']] = w
    return list(vistos.values())


def encaixes_da_sequencia(rede, seq, cod):
    encaixes = []
    for lat, lon in seq:
        s = rede.encaixa(lat, lon)
        if s is None:
            print('  aviso: ponto %.6f,%.6f de %s a mais de %d m das ruas da rota, ignorado no traçado' % (
                lat, lon, cod, DISTANCIA_MAX_M))
        elif not encaixes or encaixes[-1] != s:
            encaixes.append(s)
    return encaixes


def cobertura_dos_encaixes(rede, encaixes, cod):
    cob = []
    for a, b in zip(encaixes, encaixes[1:]):
        parte = rede.cobertura(a, b)
        if parte is None:
            print('  aviso: trecho sem ligacao no mapa entre dois pontos de %s, ignorado' % cod)
        else:
            cob += parte
    return cob


def tracado_da_rota(rota, pontos, overpass):
    cod = rota['codigo']
    da_rota = [p for p in pontos if p['t'] == cod]
    seq = sequencia_da_rota(rota, [[p['lat'], p['lon']] for p in da_rota])
    nomes = rota.get('ruas') or sorted({p.get('rua') for p in da_rota if p.get('rua')})
    if len(seq) < 2 or not nomes:
        return None, []
    ways = ways_das_ruas(nomes, caixa(seq, MARGEM_RUAS_M), overpass, cod)
    if not ways:
        print('  %s: sem ruas do OpenStreetMap, mantido o traçado de rotas.json' % cod)
        return None, []
    rede = Rede(ways, Plano(media([p[0] for p in seq])))
    encaixes = encaixes_da_sequencia(rede, seq, cod)
    linhas = rede.polilinhas(cobertura_dos_encaixes(rede, encaixes, cod))
    print('  %s: %d pontos encaixados, %d trechos de rua' % (cod, len(encaixes), len(linhas)))
    return linhas or None, ways


class Posicionador:
    def __init__(self, plano, predios, rede):
        self.plano, self.predios, self.rede = plano, predios, rede
        self.colocados = []

    def dist_rua(self, x, y):
        return self.rede.mais_proximo(*self.plano.latlon(x, y))[1]

    def fora_de_edificio(self, lat, lon, x0, y0):
        if self.predios.livre(x0, y0):
            return x0, y0
        alvo, d = self.rede.mais_proximo(lat, lon)
        tx, ty = self.plano.xy(*alvo)
        for i in range(1, int(d / PASSO_M) + 2):
            s = min(i * PASSO_M, d) / d if d else 1
            cx, cy = x0 + (tx - x0) * s, y0 + (ty - y0) * s
            if self.predios.livre(cx, cy, FOLGA_EDIF_M + 0.2):
                return cx, cy
        return tx, ty

    def candidatos(self, bx, by, r):
        n = 1 if r == 0 else max(MIN_CANDIDATOS, int(2 * math.pi * r / ESPACO_CANDIDATOS_M))
        for i in range(n):
            a = 2 * math.pi * i / n
            yield bx + r * math.cos(a), by + r * math.sin(a)

    def aceitavel(self, cx, cy):
        return (all(math.hypot(cx - qx, cy - qy) >= SEPARACAO_M for qx, qy in self.colocados)
                and self.predios.livre(cx, cy))

    def vaga_proxima(self, bx, by):
        limite_rua = max(self.dist_rua(bx, by), FAIXA_MIN_RUA_M) + 0.5
        r = 0.0
        while r <= RAIO_BUSCA_M:
            anel = []
            for cx, cy in self.candidatos(bx, by, r):
                if not self.aceitavel(cx, cy):
                    continue
                dr = self.dist_rua(cx, cy)
                if dr <= limite_rua:
                    anel.append((dr, cx, cy))
            if anel:
                return min(anel)[1:]
            r += PASSO_M
        return None

    def posiciona(self, p):
        x0, y0 = self.plano.xy(p['lat'], p['lon'])
        base = self.fora_de_edificio(p['lat'], p['lon'], x0, y0)
        escolhido = self.vaga_proxima(*base)
        if escolhido is None:
            print('  aviso: %s sem espaco livre por perto, mantido no lugar calculado' % p['id'])
            escolhido = base
        self.colocados.append(escolhido)
        return escolhido, math.hypot(escolhido[0] - x0, escolhido[1] - y0)


def ajustes_de_exibicao(pontos, ways, overpass):
    fotos = [p for p in pontos if 'lat' in p]
    if not fotos or not ways:
        return {}
    try:
        aneis = overpass.edificios(caixa([[p['lat'], p['lon']] for p in fotos], MARGEM_EDIF_M))
    except Exception as erro:
        print('  aviso: nao foi possivel buscar edificios no Overpass - %s' % erro)
        return {}
    plano = Plano(media([p['lat'] for p in fotos]), media([p['lon'] for p in fotos]))
    posicionador = Posicionador(plano, Edificios(aneis, plano), Rede(ways, plano))
    ajustes, desvios = {}, []
    for p in fotos:
        escolhido, desvio = posicionador.posiciona(p)
        if desvio <= DESVIO_MIN_M:
            continue
        lat, lon = plano.latlon(*escolhido)
        ajustes[p['id']] = [round(lat, 6), round(lon, 6)]
        desvios.append(desvio)
        if desvio > DESLOCAMENTO_ALERTA_M:
            print('  aviso: %s deslocado %.0f m, confira no mapa' % (p['id'], desvio))
    if desvios:
        print('  fotos reposicionadas: %d de %d, desvio medio %.1f m, maximo %.1f m' % (
            len(desvios), len(fotos), media(desvios), max(desvios)))
    return ajustes


def main():
    pontos = le_json(dado('pontos.json'), [])
    rotas = le_json(dado('rotas.json'), [])
    overpass = Overpass()
    tracados, todas = {}, {}
    for rota in rotas:
        linhas, ways = tracado_da_rota(rota, pontos, overpass)
        todas.update((w['id'], w) for w in ways)
        if linhas:
            tracados[rota['codigo']] = linhas
    ajustes = ajustes_de_exibicao(pontos, list(todas.values()), overpass)
    overpass.salva()
    grava_json(SAIDA, tracados)
    grava_json(SAIDA_AJUSTES, ajustes)
    print('dados/tracados.json: %d rotas encaixadas' % len(tracados))
    print('dados/ajustes.json: %d fotos reposicionadas' % len(ajustes))


if __name__ == '__main__':
    main()
