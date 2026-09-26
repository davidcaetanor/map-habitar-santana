#!/usr/bin/env python3
"""Le o EXIF das fotos e gera as miniaturas e os arquivos de dados do mapa."""
import os, re, sys
from PIL import Image, ImageOps
from PIL.ExifTags import GPSTAGS
from comum import RAIZ, dado, grava_json, le_json
from ruas import CacheRuas

FOTOS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, 'fotos')
THUMBS = os.path.join(RAIZ, 'thumbs')
CAMINHO_ROTAS = dado('rotas.json')
LADO = 760
QUALIDADE = 70
EXTENSOES = ('.jpg', '.jpeg')
EXIF_GPS = 0x8825
EXIF_DATA_HORA = 306
LIMITE_LISTA_SEM_GPS = 10


def graus(valor, ref):
    d, m, s = [float(x) for x in valor]
    v = d + m / 60 + s / 3600
    return -v if ref in ('S', 'W') else v


def codigo_da_pasta(nome):
    """'Trajeto T-2', 'Trajeto T2' e 'T2' viram 'T2'. Sem numero, devolve None."""
    m = re.search(r'\bT\s*-?\s*(\d+)\b', nome, re.I)
    return ('T' + m.group(1)) if m else None


def pastas_de_rotas(raiz):
    for pasta in sorted(os.listdir(raiz)):
        caminho = os.path.join(raiz, pasta)
        cod = codigo_da_pasta(pasta)
        if not os.path.isdir(caminho) or not cod:
            continue
        imgs = os.path.join(caminho, 'imgs')
        yield cod, pasta, imgs if os.path.isdir(imgs) else caminho


def gera_miniatura(im, destino):
    caminho = os.path.join(THUMBS, destino)
    if os.path.exists(caminho):
        return
    mini = ImageOps.exif_transpose(im)
    mini.thumbnail((LADO, LADO))
    mini.convert('RGB').save(caminho, 'JPEG', quality=QUALIDADE, optimize=True)


def le_foto(cod, pasta_imgs, nome, ruas):
    im = Image.open(os.path.join(pasta_imgs, nome))
    exif = im.getexif()
    gps = {GPSTAGS.get(k, k): v for k, v in (exif.get_ifd(EXIF_GPS) or {}).items()}
    if 'GPSLatitude' not in gps:
        return None
    lat = graus(gps['GPSLatitude'], gps.get('GPSLatitudeRef', 'S'))
    lon = graus(gps['GPSLongitude'], gps.get('GPSLongitudeRef', 'W'))
    quando = exif.get(EXIF_DATA_HORA) or ''
    destino = cod + '_' + nome
    gera_miniatura(im, destino)
    registro = {
        't': cod, 'f': nome, 'th': destino,
        'd': quando[:10].replace(':', '/'), 'h': quando[11:],
        'lat': round(lat, 6), 'lon': round(lon, 6),
        'alt': round(float(gps.get('GPSAltitude', 0) or 0), 1),
        '_ord': quando,
    }
    rua = ruas.rua(lat, lon)
    if rua:
        registro['rua'] = rua
    return registro


def pontos_da_rota(cod, pasta, pasta_imgs, ruas, sem_gps):
    registros = []
    for nome in sorted(f for f in os.listdir(pasta_imgs) if f.lower().endswith(EXTENSOES)):
        try:
            registro = le_foto(cod, pasta_imgs, nome, ruas)
        except Exception as erro:
            sem_gps.append('%s/%s (%s)' % (pasta, nome, erro))
            continue
        if registro is None:
            sem_gps.append(pasta + '/' + nome)
        else:
            registros.append(registro)
    registros.sort(key=lambda r: r['_ord'])
    for i, registro in enumerate(registros, 1):
        registro.pop('_ord')
        registro['id'] = '%s-%02d' % (cod, i)
    return registros


def rota_nova(cod, pasta):
    return {'codigo': cod, 'nome': cod.replace('T', 'T-') + ' · ' + pasta,
            'achados': [['Anotações', 'Preencher com as observações de campo desta rota.']]}


def mescla_rotas(vistas):
    antigas = {r['codigo']: r for r in le_json(CAMINHO_ROTAS, [])}
    codigos = [cod for cod, _ in vistas]
    rotas = [antigas.get(cod) or rota_nova(cod, pasta) for cod, pasta in vistas]
    return rotas + [r for cod, r in antigas.items() if cod not in codigos]


def grava_modelo_legendas(pontos):
    with open(dado('legendas-modelo.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        fh.write('ponto,categoria,legenda,autor\n')
        for p in pontos:
            fh.write(p['id'] + ',,,\n')


def relatorio(pontos, rotas, vistas, sem_gps):
    print('%d pontos em %d rotas' % (len(pontos), len(rotas)))
    for cod, _ in vistas:
        print('  %-5s %d fotos' % (cod, len([p for p in pontos if p['t'] == cod])))
    if sem_gps:
        print('sem coordenada GPS (%d):' % len(sem_gps))
        for s in sem_gps[:LIMITE_LISTA_SEM_GPS]:
            print('  ' + s)
    print('\nAtualizados: dados/pontos.json, dados/rotas.json, dados/legendas-modelo.csv e thumbs/')


def main():
    if not os.path.isdir(FOTOS):
        sys.exit('Pasta de fotos nao encontrada: ' + FOTOS)
    os.makedirs(THUMBS, exist_ok=True)
    ruas = CacheRuas()
    pontos, vistas, sem_gps = [], [], []
    for cod, pasta, pasta_imgs in pastas_de_rotas(FOTOS):
        vistas.append((cod, pasta))
        pontos.extend(pontos_da_rota(cod, pasta, pasta_imgs, ruas, sem_gps))
    pontos.sort(key=lambda p: p['id'])
    rotas = mescla_rotas(vistas)
    grava_json(dado('pontos.json'), pontos)
    grava_json(CAMINHO_ROTAS, rotas, compacto=False)
    ruas.salva()
    grava_modelo_legendas(pontos)
    relatorio(pontos, rotas, vistas, sem_gps)


if __name__ == '__main__':
    main()
