#!/usr/bin/env python3
"""Busca e cache do nome da rua por coordenada (Nominatim/OpenStreetMap)."""
import json, os, time, urllib.parse, urllib.request

RAIZ = os.path.dirname(os.path.abspath(__file__))
DADOS = os.path.join(RAIZ, 'dados')
CACHE_RUAS = os.path.join(DADOS, 'cache-ruas.json')
NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'
CONTATO_APP = 'habitar-santana-usjt (projeto academico, uso pontual)'


def carrega_cache_ruas():
    if os.path.isfile(CACHE_RUAS):
        with open(CACHE_RUAS, encoding='utf-8') as f:
            return json.load(f)
    return {}


def salva_cache_ruas(cache):
    os.makedirs(DADOS, exist_ok=True)
    with open(CACHE_RUAS, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=1, sort_keys=True)


def busca_rua(lat, lon, cache):
    """Nome da rua pela coordenada, via geocodificacao reversa do OpenStreetMap.
    Guarda em cache por coordenada arredondada para nao repetir pedidos e respeitar
    o limite de 1 pedido por segundo do servico publico do Nominatim."""
    chave = '%.4f,%.4f' % (lat, lon)
    if chave in cache:
        return cache[chave]
    params = urllib.parse.urlencode({
        'format': 'jsonv2', 'lat': lat, 'lon': lon, 'zoom': 17, 'addressdetails': 1,
    })
    req = urllib.request.Request(NOMINATIM + '?' + params, headers={'User-Agent': CONTATO_APP})
    rua = ''
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            info = json.loads(resp.read().decode('utf-8'))
        end = info.get('address', {})
        rua = end.get('road') or end.get('pedestrian') or end.get('footway') or ''
    except Exception as erro:
        print('  aviso: nao consegui buscar a rua de', chave, '-', erro)
    cache[chave] = rua
    time.sleep(1)
    return rua
