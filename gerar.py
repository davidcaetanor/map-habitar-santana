#!/usr/bin/env python3
"""Le o EXIF das fotos e gera as miniaturas e os arquivos de dados do mapa."""
import json, os, re, sys
from PIL import Image, ImageOps
from PIL.ExifTags import GPSTAGS

RAIZ = os.path.dirname(os.path.abspath(__file__))
FOTOS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, 'fotos')
THUMBS = os.path.join(RAIZ, 'thumbs')
DADOS = os.path.join(RAIZ, 'dados')
LADO = 760
QUALIDADE = 70


def graus(valor, ref):
    d, m, s = [float(x) for x in valor]
    v = d + m / 60 + s / 3600
    return -v if ref in ('S', 'W') else v


def codigo_da_pasta(nome):
    """'Trajeto T-2', 'Trajeto T2' e 'T2' viram 'T2'. Sem numero, devolve None."""
    m = re.search(r'\bT\s*-?\s*(\d+)\b', nome, re.I)
    return ('T' + m.group(1)) if m else None


def main():
    if not os.path.isdir(FOTOS):
        sys.exit('Pasta de fotos nao encontrada: ' + FOTOS)
    os.makedirs(THUMBS, exist_ok=True)
    os.makedirs(DADOS, exist_ok=True)

    pontos, rotas_vistas, sem_gps = [], [], []

    for pasta in sorted(os.listdir(FOTOS)):
        caminho = os.path.join(FOTOS, pasta)
        if not os.path.isdir(caminho):
            continue
        cod = codigo_da_pasta(pasta)
        if not cod:
            continue
        if os.path.isdir(os.path.join(caminho, 'imgs')):
            caminho = os.path.join(caminho, 'imgs')
        arquivos = sorted(f for f in os.listdir(caminho) if f.lower().endswith(('.jpg', '.jpeg')))
        rotas_vistas.append((cod, pasta))
        registros = []
        for nome in arquivos:
            origem = os.path.join(caminho, nome)
            try:
                im = Image.open(origem)
                ex = im.getexif()
                gps = ex.get_ifd(0x8825) or {}
                g = {GPSTAGS.get(k, k): v for k, v in gps.items()}
                if 'GPSLatitude' not in g:
                    sem_gps.append(pasta + '/' + nome)
                    continue
                lat = graus(g['GPSLatitude'], g.get('GPSLatitudeRef', 'S'))
                lon = graus(g['GPSLongitude'], g.get('GPSLongitudeRef', 'W'))
                quando = ex.get(306) or ''
                destino = cod + '_' + nome
                if not os.path.exists(os.path.join(THUMBS, destino)):
                    mini = ImageOps.exif_transpose(im)
                    mini.thumbnail((LADO, LADO))
                    mini.convert('RGB').save(os.path.join(THUMBS, destino), 'JPEG',
                                             quality=QUALIDADE, optimize=True)
                registros.append({
                    't': cod, 'f': nome, 'th': destino,
                    'd': quando[:10].replace(':', '/'), 'h': quando[11:],
                    'lat': round(lat, 6), 'lon': round(lon, 6),
                    'alt': round(float(g.get('GPSAltitude', 0) or 0), 1),
                    '_ord': quando,
                })
            except Exception as erro:
                sem_gps.append(pasta + '/' + nome + ' (' + str(erro) + ')')

        registros.sort(key=lambda r: r['_ord'])
        for i, r in enumerate(registros, 1):
            r.pop('_ord')
            r['id'] = '%s-%02d' % (cod, i)
        pontos.extend(registros)

    pontos.sort(key=lambda p: p['id'])

    caminho_rotas = os.path.join(DADOS, 'rotas.json')
    antigas = {}
    if os.path.exists(caminho_rotas):
        for r in json.load(open(caminho_rotas, encoding='utf-8')):
            antigas[r['codigo']] = r
    rotas = []
    for cod, pasta in rotas_vistas:
        if cod in antigas:
            rotas.append(antigas[cod])
        else:
            rotas.append({'codigo': cod, 'nome': cod.replace('T', 'T-') + ' · ' + pasta,
                          'achados': [['Anotações', 'Preencher com as observações de campo desta rota.']]})
    for cod, r in antigas.items():
        if cod not in [c for c, _ in rotas_vistas]:
            rotas.append(r)

    json.dump(pontos, open(os.path.join(DADOS, 'pontos.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    json.dump(rotas, open(caminho_rotas, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    with open(os.path.join(DADOS, 'legendas-modelo.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        fh.write('ponto,categoria,legenda,autor\n')
        for p in pontos:
            fh.write(p['id'] + ',,,\n')

    print('%d pontos em %d rotas' % (len(pontos), len(rotas)))
    for cod, _ in rotas_vistas:
        print('  %-5s %d fotos' % (cod, len([p for p in pontos if p['t'] == cod])))
    if sem_gps:
        print('sem coordenada GPS (%d):' % len(sem_gps))
        for s in sem_gps[:10]:
            print('  ' + s)
    print('\nAtualizados: dados/pontos.json, dados/rotas.json, dados/legendas-modelo.csv e thumbs/')


if __name__ == '__main__':
    main()
