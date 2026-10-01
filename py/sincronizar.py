#!/usr/bin/env python3
"""Baixa do Drive as fotos de cada rota (pastas T1, T2, T5...) para fotos/, confere a distancia
de cada foto ate a rota e regenera os dados do mapa com gerar.py e tracar.py."""
import argparse, collections, hashlib, math, os, shutil, sys
from comum import DRIVE_PASTA_ID, dado, le_json
import gerar, tracar

PASTA_FOTOS = gerar.FOTOS
PASTA_FORA_DO_DRIVE = os.path.join(PASTA_FOTOS, '_fora_do_drive')
DISTANCIA_ALERTA_M = 80
BLOCO_MD5 = 1024 * 1024


def eh_foto(nome):
    return nome.lower().endswith(gerar.EXTENSOES)


def md5(caminho):
    soma = hashlib.md5()
    with open(caminho, 'rb') as f:
        for bloco in iter(lambda: f.read(BLOCO_MD5), b''):
            soma.update(bloco)
    return soma.hexdigest()


def fotos_locais(cod):
    pasta = os.path.join(PASTA_FOTOS, cod)
    return sorted(f for f in os.listdir(pasta) if eh_foto(f)) if os.path.isdir(pasta) else []


class FonteDrive:
    def __init__(self, pasta_id):
        from drive import Drive, ehpasta
        self.drive, self.ehpasta, self.pasta_id = Drive(), ehpasta, pasta_id

    def rotas(self):
        rotas = {}
        for item in self.drive.itens(self.pasta_id):
            cod = gerar.codigo_da_pasta(item['name'])
            if self.ehpasta(item) and cod:
                rotas[cod] = [a for a in self.drive.itens(item['id']) if not self.ehpasta(a)]
        return rotas

    def baixa(self, arquivo, destino):
        self.drive.baixa(arquivo['id'], destino)


class Sincronizacao:
    def __init__(self, fonte, espelhar):
        self.fonte, self.espelhar = fonte, espelhar

    def executa(self):
        rotas = self.fonte.rotas()
        if not rotas:
            sys.exit('Nenhuma pasta de rota (T1, T2...) encontrada no Drive. Confira o DRIVE_PASTA_ID.')
        print('Drive -> fotos/')
        for cod in sorted(rotas):
            self._rota(cod, rotas[cod])
        return rotas

    def _rota(self, cod, arquivos):
        pasta = os.path.join(PASTA_FOTOS, cod)
        os.makedirs(pasta, exist_ok=True)
        fotos = [a for a in arquivos if eh_foto(a['name'])]
        ignorados = [a['name'] for a in arquivos if not eh_foto(a['name'])]
        repetidos = [n for n, q in collections.Counter(a['name'] for a in fotos).items() if q > 1]
        baixados = 0
        for arquivo in fotos:
            destino = os.path.join(pasta, arquivo['name'])
            if os.path.isfile(destino) and md5(destino) == arquivo.get('md5Checksum'):
                continue
            self.fonte.baixa(arquivo, destino)
            baixados += 1
        fora = sorted(set(fotos_locais(cod)) - {a['name'] for a in fotos})
        print('  %-4s %d fotos no Drive, %d baixadas agora' % (cod, len(fotos), baixados))
        if ignorados:
            print('       ignorados (nao sao .jpg): ' + ', '.join(ignorados))
        if repetidos:
            print('       aviso: nomes repetidos no Drive, so um de cada fica: ' + ', '.join(repetidos))
        if fora:
            self._fora_do_drive(cod, fora)

    def _fora_do_drive(self, cod, nomes):
        if not self.espelhar:
            print('       aviso: %d fotos locais nao estao mais no Drive (use --espelhar para tira-las): %s'
                  % (len(nomes), ', '.join(nomes)))
            return
        destino = os.path.join(PASTA_FORA_DO_DRIVE, cod)
        os.makedirs(destino, exist_ok=True)
        for nome in nomes:
            shutil.move(os.path.join(PASTA_FOTOS, cod, nome), os.path.join(destino, nome))
        print('       %d fotos que sairam do Drive movidas para fotos/_fora_do_drive/%s' % (len(nomes), cod))


def rotas_que_sumiriam():
    publicados = collections.Counter(p['t'] for p in le_json(dado('pontos.json'), []))
    return sorted(cod for cod in publicados if not fotos_locais(cod))


def distancia_ate_linhas(ponto, linhas):
    plano = tracar.Plano(ponto[0])
    return min(tracar.projecao(*plano.delta(a, ponto), *plano.delta(a, b))[1]
               for linha in linhas for a, b in zip(linha, linha[1:]))


def confere_distancias():
    tracados = le_json(dado('tracados.json'), {})
    rotas = {r['codigo']: r for r in le_json(dado('rotas.json'), [])}
    longe = []
    for p in le_json(dado('pontos.json'), []):
        linhas = tracados.get(p['t']) or ([rotas[p['t']]['tracado']] if rotas.get(p['t'], {}).get('tracado') else [])
        if not linhas:
            continue
        d = distancia_ate_linhas([p['lat'], p['lon']], linhas)
        if d > DISTANCIA_ALERTA_M:
            longe.append((p['id'], p['f'], d))
    if not longe:
        print('Todas as fotos estao a menos de %d m da rota.' % DISTANCIA_ALERTA_M)
        return
    print('Confira, fotos a mais de %d m da propria rota (pasta errada?):' % DISTANCIA_ALERTA_M)
    for id_ponto, nome, d in longe:
        print('  %s  %s  %.0f m' % (id_ponto, nome, d))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pasta', default=DRIVE_PASTA_ID, help='ID da pasta "fotos" no Drive')
    parser.add_argument('--so-baixar', action='store_true', help='so baixa, sem regenerar os dados')
    parser.add_argument('--espelhar', action='store_true', help='tira de fotos/ o que nao esta mais no Drive')
    parser.add_argument('--permitir-remocao', action='store_true',
                        help='deixa regenerar mesmo se uma rota publicada ficar sem fotos')
    args = parser.parse_args()
    if not args.pasta:
        sys.exit('Informe --pasta <ID> ou preencha DRIVE_PASTA_ID em py/comum.py')
    Sincronizacao(FonteDrive(args.pasta), args.espelhar).executa()
    if args.so_baixar:
        return
    vazias = rotas_que_sumiriam()
    if vazias and not args.permitir_remocao:
        sys.exit('\nParei antes de regenerar: %s tem pontos no mapa mas nenhuma foto em fotos/. '
                 'Suba as originais para essas pastas no Drive (sem renomear) ou rode com --permitir-remocao.'
                 % ', '.join(vazias))
    print()
    gerar.main(PASTA_FOTOS)
    print()
    tracar.main()
    print()
    confere_distancias()


if __name__ == '__main__':
    main()
