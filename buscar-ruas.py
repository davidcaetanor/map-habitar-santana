#!/usr/bin/env python3
"""Preenche o campo 'rua' em dados/pontos.json e dados/marcos.json que ja existem,
sem precisar das fotos originais. """
import json, os
from gerar import DADOS, busca_rua, carrega_cache_ruas, salva_cache_ruas


def preenche(caminho, pega_coord, compacto, cache):
    dados = json.load(open(caminho, encoding='utf-8'))
    alterados = 0
    for item in dados:
        if item.get('rua'):
            continue
        lat, lon = pega_coord(item)
        rua = busca_rua(lat, lon, cache)
        if rua:
            item['rua'] = rua
            alterados += 1
    if compacto:
        json.dump(dados, open(caminho, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    else:
        json.dump(dados, open(caminho, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return alterados, len(dados)


if __name__ == '__main__':
    cache = carrega_cache_ruas()
    n1, t1 = preenche(os.path.join(DADOS, 'pontos.json'), lambda p: (p['lat'], p['lon']), True, cache)
    print('pontos.json: %d de %d pontos ganharam nome de rua' % (n1, t1))
    n2, t2 = preenche(os.path.join(DADOS, 'marcos.json'), lambda m: (m['lat'], m['lon']), False, cache)
    print('marcos.json: %d de %d marcos ganharam nome de rua' % (n2, t2))
    salva_cache_ruas(cache)
