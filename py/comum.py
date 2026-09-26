"""Caminhos e leitura/gravacao dos arquivos de dados, compartilhados pelos scripts do repo."""
import json, os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DADOS = os.path.join(RAIZ, 'dados')
CONTATO_APP = 'habitar-santana-usjt (projeto academico, uso pontual)'


def dado(nome):
    return os.path.join(DADOS, nome)


def le_json(caminho, padrao=None):
    if padrao is not None and not os.path.isfile(caminho):
        return padrao
    with open(caminho, encoding='utf-8') as f:
        return json.load(f)


def grava_json(caminho, conteudo, compacto=True, **opcoes):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    formato = {'separators': (',', ':')} if compacto else {'indent': 1}
    with open(caminho, 'w', encoding='utf-8') as f:
        json.dump(conteudo, f, ensure_ascii=False, **formato, **opcoes)
