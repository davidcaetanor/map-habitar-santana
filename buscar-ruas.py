#!/usr/bin/env python3
"""Preenche o campo 'rua' em dados/pontos.json e dados/marcos.json que ja existem,
sem precisar das fotos originais nem do Pillow."""
from comum import dado, grava_json, le_json
from ruas import CacheRuas

ARQUIVOS = (('pontos.json', 'pontos', True), ('marcos.json', 'marcos', False))


def preenche(nome, compacto, ruas):
    caminho = dado(nome)
    itens = le_json(caminho)
    alterados = 0
    for item in itens:
        if item.get('rua'):
            continue
        rua = ruas.rua(item['lat'], item['lon'])
        if rua:
            item['rua'] = rua
            alterados += 1
    grava_json(caminho, itens, compacto)
    return alterados, len(itens)


if __name__ == '__main__':
    ruas = CacheRuas()
    for nome, tipo, compacto in ARQUIVOS:
        alterados, total = preenche(nome, compacto, ruas)
        print('%s: %d de %d %s ganharam nome de rua' % (nome, alterados, total, tipo))
    ruas.salva()
