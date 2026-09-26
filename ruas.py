#!/usr/bin/env python3
"""Nome da rua por coordenada (Nominatim/OpenStreetMap), com cache em dados/cache-ruas.json."""
import json, time, urllib.parse, urllib.request
from comum import CONTATO_APP, dado, grava_json, le_json

NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'
INTERVALO_S = 1


class CacheRuas:
    """O servico publico do Nominatim aceita 1 pedido por segundo, por isso o cache
    por coordenada arredondada e a pausa depois de cada consulta."""
    CAMINHO = dado('cache-ruas.json')

    def __init__(self):
        self.ruas = le_json(self.CAMINHO, {})

    def rua(self, lat, lon):
        chave = '%.4f,%.4f' % (lat, lon)
        if chave not in self.ruas:
            self.ruas[chave] = self._consulta(lat, lon, chave)
            time.sleep(INTERVALO_S)
        return self.ruas[chave]

    def salva(self):
        grava_json(self.CAMINHO, self.ruas, compacto=False, sort_keys=True)

    @staticmethod
    def _consulta(lat, lon, chave):
        params = urllib.parse.urlencode({
            'format': 'jsonv2', 'lat': lat, 'lon': lon, 'zoom': 17, 'addressdetails': 1,
        })
        req = urllib.request.Request(NOMINATIM + '?' + params, headers={'User-Agent': CONTATO_APP})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                endereco = json.loads(resp.read().decode('utf-8')).get('address', {})
        except Exception as erro:
            print('  aviso: rua não localizada de ', chave, '-', erro)
            return ''
        return endereco.get('road') or endereco.get('pedestrian') or endereco.get('footway') or ''
