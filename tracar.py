#!/usr/bin/env python3
"""Gera dados/tracados.json (trajeto de cada rota no eixo das ruas do OpenStreetMap) e
dados/ajustes.json."""
import heapq, json, math, os, time, urllib.error, urllib.parse, urllib.request
from ruas import CONTATO_APP, DADOS

OVERPASS = 'https://overpass-api.de/api/interpreter'
CACHE_OSM = os.path.join(DADOS, 'cache-osm.json')
SAIDA = os.path.join(DADOS, 'tracados.json')
SAIDA_AJUSTES = os.path.join(DADOS, 'ajustes.json')
MARGEM_RUAS_M = 120
MARGEM_EDIF_M = 60
DISTANCIA_MAX_M = 80
FOLGA_EDIF_M = 3.0
SEPARACAO_M = 8.0
RAIO_BUSCA_M = 35.0
DESLOCAMENTO_ALERTA_M = 25


def carrega(caminho, padrao):
    if os.path.isfile(caminho):
        with open(caminho, encoding='utf-8') as f:
            return json.load(f)
    return padrao


def caixa(pts, margem_m):
    lat0 = sum(p[0] for p in pts) / len(pts)
    mlat = margem_m / 111320.0
    mlon = margem_m / (111320.0 * math.cos(math.radians(lat0)))
    return (min(p[0] for p in pts) - mlat, min(p[1] for p in pts) - mlon,
            max(p[0] for p in pts) + mlat, max(p[1] for p in pts) + mlon)


def do_cache(cache, prefixo, bbox):
    for chave, valor in cache.items():
        nome, _, caixa_txt = chave.rpartition('|')
        if nome != prefixo:
            continue
        s, w, n, e = (float(v) for v in caixa_txt.split(','))
        if s <= bbox[0] and w <= bbox[1] and n >= bbox[2] and e >= bbox[3]:
            return valor
    return None


def consulta_overpass(consulta):
    corpo = urllib.parse.urlencode({'data': consulta}).encode()
    for tentativa in range(4):
        req = urllib.request.Request(OVERPASS, data=corpo, headers={'User-Agent': CONTATO_APP})
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                dados = json.loads(resp.read().decode('utf-8'))
            time.sleep(2)
            return dados
        except urllib.error.HTTPError as erro:
            if erro.code not in (429, 502, 503, 504) or tentativa == 3:
                raise
        except urllib.error.URLError:
            if tentativa == 3:
                raise
        espera = 15 * (tentativa + 1)
        print('  Overpass ocupado, nova tentativa em %d s' % espera)
        time.sleep(espera)


def busca_ways(nome, bbox, cache):
    guardado = do_cache(cache, nome, bbox)
    if guardado is not None:
        return guardado
    consulta = '[out:json][timeout:25];way["highway"]["name"~"^%s$",i](%.6f,%.6f,%.6f,%.6f);out geom;' % (
        nome.replace('"', '\\"'), bbox[0], bbox[1], bbox[2], bbox[3])
    dados = consulta_overpass(consulta)
    ways = [{'id': e['id'], 'nodes': e['nodes'], 'geom': [[g['lat'], g['lon']] for g in e['geometry']]}
            for e in dados.get('elements', []) if e.get('type') == 'way' and 'geometry' in e]
    cache['%s|%.4f,%.4f,%.4f,%.4f' % ((nome,) + tuple(bbox))] = ways
    return ways


def busca_edificios(bbox, cache):
    guardado = do_cache(cache, 'edificios', bbox)
    if guardado is not None:
        return guardado
    txt = '%.6f,%.6f,%.6f,%.6f' % tuple(bbox)
    consulta = ('[out:json][timeout:60];(way["building"]["building"!="no"](%s);'
                'relation["building"]["building"!="no"](%s););out geom;') % (txt, txt)
    dados = consulta_overpass(consulta)
    aneis = []
    for e in dados.get('elements', []):
        if e.get('type') == 'way' and 'geometry' in e:
            aneis.append([[g['lat'], g['lon']] for g in e['geometry']])
        elif e.get('type') == 'relation':
            for m in e.get('members', []):
                if m.get('role') == 'outer' and 'geometry' in m:
                    aneis.append([[g['lat'], g['lon']] for g in m['geometry']])
    cache['edificios|%.4f,%.4f,%.4f,%.4f' % tuple(bbox)] = aneis
    return aneis


class Plano:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.ky = 111320.0
        self.kx = 111320.0 * math.cos(math.radians(lat0))

    def xy(self, lat, lon):
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def latlon(self, x, y):
        return self.lat0 + y / self.ky, self.lon0 + x / self.kx


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
            for i in range(math.floor((pol[0] - borda) / self.CELULA), math.floor((pol[2] + borda) / self.CELULA) + 1):
                for j in range(math.floor((pol[1] - borda) / self.CELULA), math.floor((pol[3] + borda) / self.CELULA) + 1):
                    self.grade.setdefault((i, j), []).append(pol)

    def livre(self, x, y, folga=FOLGA_EDIF_M):
        for x0, y0, x1, y1, xy in self.grade.get((math.floor(x / self.CELULA), math.floor(y / self.CELULA)), ()):
            if x < x0 - folga or x > x1 + folga or y < y0 - folga or y > y1 + folga:
                continue
            dentro = False
            menor = math.inf
            for i in range(len(xy) - 1):
                (ax, ay), (bx, by) = xy[i], xy[i + 1]
                if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                    dentro = not dentro
                dx, dy = bx - ax, by - ay
                t = 0.0 if dx == 0 and dy == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
                menor = min(menor, math.hypot(x - ax - t * dx, y - ay - t * dy))
            if dentro or menor < folga:
                return False
        return True


class Rede:
    def __init__(self, ways, lat0):
        self.ky = 111320.0
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.coord, self.adj, self.seg, self.comp, self.ordem = {}, {}, {}, {}, {}
        for w in ways:
            self.ordem[w['id']] = []
            for i in range(len(w['nodes']) - 1):
                a, b = w['nodes'][i], w['nodes'][i + 1]
                chave = (w['id'], i)
                self.coord[a], self.coord[b] = w['geom'][i], w['geom'][i + 1]
                self.seg[chave] = (a, b)
                self.comp[chave] = self.dist(w['geom'][i], w['geom'][i + 1])
                self.adj.setdefault(a, []).append((b, self.comp[chave], chave))
                self.adj.setdefault(b, []).append((a, self.comp[chave], chave))
                self.ordem[w['id']].append(chave)

    def dist(self, p, q):
        return math.hypot((q[1] - p[1]) * self.kx, (q[0] - p[0]) * self.ky)

    def projeta(self, lat, lon):
        melhor = None
        for k, (a, b) in self.seg.items():
            pa, pb = self.coord[a], self.coord[b]
            dx, dy = (pb[1] - pa[1]) * self.kx, (pb[0] - pa[0]) * self.ky
            px, py = (lon - pa[1]) * self.kx, (lat - pa[0]) * self.ky
            t = 0.0 if dx == 0 and dy == 0 else max(0.0, min(1.0, (px * dx + py * dy) / (dx * dx + dy * dy)))
            d = math.hypot(px - t * dx, py - t * dy)
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
                unidos = []
                for t0, t1 in sorted(por_seg[chave]):
                    if unidos and t0 <= unidos[-1][1] + 1e-9:
                        unidos[-1][1] = max(unidos[-1][1], t1)
                    else:
                        unidos.append([t0, t1])
                for t0, t1 in unidos:
                    p0, p1 = self.ponto(chave, t0), self.ponto(chave, t1)
                    if atual and atual[-1] == p0:
                        atual.append(p1)
                    else:
                        atual = [p0, p1]
                        linhas.append(atual)
        return [l for l in linhas if len(l) > 1 and l[0] != l[-1]]


def trata_rota(rota, pontos, cache):
    cod = rota['codigo']
    fotos = [[p['lat'], p['lon']] for p in pontos if p['t'] == cod]
    seq = ([rota['inicio']] if rota.get('inicio') else []) + (fotos or rota.get('tracado') or []) + \
          ([rota['fim']] if rota.get('fim') else [])
    nomes = rota.get('ruas') or sorted({p.get('rua') for p in pontos if p['t'] == cod and p.get('rua')})
    if len(seq) < 2 or not nomes:
        return None, []
    bbox = caixa(seq, MARGEM_RUAS_M)
    vistos = {}
    for nome in nomes:
        try:
            ways = busca_ways(nome, bbox, cache)
        except Exception as erro:
            print('  aviso: nao foi possivel buscar "%s" no Overpass - %s' % (nome, erro))
            continue
        if not ways:
            print('  aviso: "%s" nao encontrada no OpenStreetMap perto de %s' % (nome, cod))
        for w in ways:
            vistos[w['id']] = w
    ways = list(vistos.values())
    if not ways:
        print('  %s: sem ruas do OpenStreetMap, mantido o traçado de rotas.json' % cod)
        return None, []
    rede = Rede(ways, sum(p[0] for p in seq) / len(seq))
    encaixes = []
    for lat, lon in seq:
        s = rede.encaixa(lat, lon)
        if s is None:
            print('  aviso: ponto %.6f,%.6f de %s a mais de %d m das ruas da rota, ignorado no traçado' % (
                lat, lon, cod, DISTANCIA_MAX_M))
        elif not encaixes or encaixes[-1] != s:
            encaixes.append(s)
    cob = []
    for a, b in zip(encaixes, encaixes[1:]):
        parte = rede.cobertura(a, b)
        if parte is None:
            print('  aviso: trecho sem ligacao no mapa entre dois pontos de %s, ignorado' % cod)
        else:
            cob += parte
    linhas = rede.polilinhas(cob)
    print('  %s: %d pontos encaixados, %d trechos de rua' % (cod, len(encaixes), len(linhas)))
    return linhas or None, ways


def posiciona(pontos, ways, cache):
    fotos = [p for p in pontos if 'lat' in p]
    if not fotos or not ways:
        return {}
    try:
        aneis = busca_edificios(caixa([[p['lat'], p['lon']] for p in fotos], MARGEM_EDIF_M), cache)
    except Exception as erro:
        print('  aviso: nao foi possivel buscar edificios no Overpass - %s' % erro)
        return {}
    lat0 = sum(p['lat'] for p in fotos) / len(fotos)
    lon0 = sum(p['lon'] for p in fotos) / len(fotos)
    plano = Plano(lat0, lon0)
    predios = Edificios(aneis, plano)
    rede = Rede(ways, lat0)

    def dist_rua(x, y):
        return rede.mais_proximo(*plano.latlon(x, y))[1]

    colocados, ajustes, desvios = [], {}, []
    for p in fotos:
        x0, y0 = plano.xy(p['lat'], p['lon'])
        bx, by = x0, y0
        if not predios.livre(bx, by):
            alvo, d = rede.mais_proximo(p['lat'], p['lon'])
            tx, ty = plano.xy(*alvo)
            passos = int(d / 0.5) + 1
            for i in range(1, passos + 1):
                s = min(i * 0.5, d) / d if d else 1
                cx, cy = x0 + (tx - x0) * s, y0 + (ty - y0) * s
                if predios.livre(cx, cy, FOLGA_EDIF_M + 0.2):
                    bx, by = cx, cy
                    break
            else:
                bx, by = tx, ty
        limite_rua = max(dist_rua(bx, by), 6.0) + 0.5
        escolhido = None
        r = 0.0
        while r <= RAIO_BUSCA_M and escolhido is None:
            n = 1 if r == 0 else max(8, int(2 * math.pi * r / 0.75))
            anel = []
            for i in range(n):
                a = 2 * math.pi * i / n
                cx, cy = bx + r * math.cos(a), by + r * math.sin(a)
                if any(math.hypot(cx - qx, cy - qy) < SEPARACAO_M for qx, qy in colocados):
                    continue
                if not predios.livre(cx, cy):
                    continue
                dr = dist_rua(cx, cy)
                if dr <= limite_rua:
                    anel.append((dr, cx, cy))
            if anel:
                _, cx, cy = min(anel)
                escolhido = (cx, cy)
            r += 0.5
        if escolhido is None:
            print('  aviso: %s sem espaco livre por perto, mantido no lugar calculado' % p['id'])
            escolhido = (bx, by)
        colocados.append(escolhido)
        desvio = math.hypot(escolhido[0] - x0, escolhido[1] - y0)
        if desvio > 0.1:
            lat, lon = plano.latlon(*escolhido)
            ajustes[p['id']] = [round(lat, 6), round(lon, 6)]
            desvios.append(desvio)
            if desvio > DESLOCAMENTO_ALERTA_M:
                print('  aviso: %s deslocado %.0f m, confira no mapa' % (p['id'], desvio))
    if desvios:
        print('  fotos reposicionadas: %d de %d, desvio medio %.1f m, maximo %.1f m' % (
            len(desvios), len(fotos), sum(desvios) / len(desvios), max(desvios)))
    return ajustes


if __name__ == '__main__':
    pontos = carrega(os.path.join(DADOS, 'pontos.json'), [])
    rotas = carrega(os.path.join(DADOS, 'rotas.json'), [])
    cache = carrega(CACHE_OSM, {})
    saida, todas = {}, {}
    for rota in rotas:
        linhas, ways = trata_rota(rota, pontos, cache)
        for w in ways:
            todas[w['id']] = w
        if linhas:
            saida[rota['codigo']] = linhas
    ajustes = posiciona(pontos, list(todas.values()), cache)
    with open(CACHE_OSM, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, separators=(',', ':'))
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(saida, f, separators=(',', ':'))
    with open(SAIDA_AJUSTES, 'w', encoding='utf-8') as f:
        json.dump(ajustes, f, separators=(',', ':'))
    print('dados/tracados.json: %d rotas encaixadas' % len(saida))
    print('dados/ajustes.json: %d fotos reposicionadas' % len(ajustes))
