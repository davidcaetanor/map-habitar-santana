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


class Numeracao:
    """As legendas da planilha sao ligadas ao id do ponto, entao uma foto ja publicada
    mantem o id para sempre e so as fotos novas recebem o proximo numero livre da rota.
    O ultimo numero usado fica gravado em rotas.json para que o id de uma foto removida
    nunca seja reaproveitado por outra."""

    def __init__(self, pontos_atuais, rotas_atuais):
        self.ids = {(p['t'], p['f']): p['id'] for p in pontos_atuais}
        self.ultimo = {r['codigo']: r.get('ultimoNumero', 0) for r in rotas_atuais}
        for p in pontos_atuais:
            self.ultimo[p['t']] = max(self.ultimo.get(p['t'], 0), self._numero(p['id']))
        self.novos = {}

    @staticmethod
    def _numero(id_ponto):
        try:
            return int(id_ponto.rsplit('-', 1)[1])
        except (IndexError, ValueError):
            return 0

    def atribui(self, cod, registro):
        existente = self.ids.get((cod, registro['f']))
        if existente:
            registro['id'] = existente
            return
        self.ultimo[cod] = self.ultimo.get(cod, 0) + 1
        self.novos[cod] = self.novos.get(cod, 0) + 1
        registro['id'] = '%s-%02d' % (cod, self.ultimo[cod])


def pontos_da_rota(cod, pasta, pasta_imgs, ruas, numeracao, sem_gps):
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
    for registro in registros:
        registro.pop('_ord')
        numeracao.atribui(cod, registro)
    return registros


def rota_nova(cod, pasta):
    return {'codigo': cod, 'nome': cod.replace('T', 'T-') + ' · ' + pasta,
            'achados': [['Anotações', 'Preencher com as observações de campo desta rota.']]}


def mescla_rotas(antigas, vistas, ultimo):
    antigas = {r['codigo']: r for r in antigas}
    codigos = [cod for cod, _ in vistas]
    rotas = [antigas.get(cod) or rota_nova(cod, pasta) for cod, pasta in vistas]
    rotas += [r for cod, r in antigas.items() if cod not in codigos]
    for rota in rotas:
        if ultimo.get(rota['codigo']):
            rota['ultimoNumero'] = ultimo[rota['codigo']]
    return rotas


def grava_modelo_legendas(pontos):
    with open(dado('legendas-modelo.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        fh.write('ponto,categoria,legenda,autor\n')
        for p in pontos:
            fh.write(p['id'] + ',,,\n')


def relatorio(pontos, rotas, vistas, novos, sem_gps):
    print('%d pontos em %d rotas' % (len(pontos), len(rotas)))
    for cod, _ in vistas:
        total = len([p for p in pontos if p['t'] == cod])
        n = novos.get(cod, 0)
        print('  %-5s %d fotos' % (cod, total) + (' (%d %s)' % (n, 'nova' if n == 1 else 'novas') if n else ''))
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
    rotas_atuais = le_json(CAMINHO_ROTAS, [])
    numeracao = Numeracao(le_json(dado('pontos.json'), []), rotas_atuais)
    pontos, vistas, sem_gps = [], [], []
    for cod, pasta, pasta_imgs in pastas_de_rotas(FOTOS):
        vistas.append((cod, pasta))
        pontos.extend(pontos_da_rota(cod, pasta, pasta_imgs, ruas, numeracao, sem_gps))
    pontos.sort(key=lambda p: p['t'])
    rotas = mescla_rotas(rotas_atuais, vistas, numeracao.ultimo)
    grava_json(dado('pontos.json'), pontos)
    grava_json(CAMINHO_ROTAS, rotas, compacto=False)
    ruas.salva()
    grava_modelo_legendas(pontos)
    relatorio(pontos, rotas, vistas, numeracao.novos, sem_gps)


if __name__ == '__main__':
    main()
