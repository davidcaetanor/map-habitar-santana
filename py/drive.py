#!/usr/bin/env python3
"""Acesso a pasta do projeto no Google Drive pela conta de servico.
Rodado direto, lista a pasta e as subpastas para testar a conexao."""
import os, sys
from comum import DRIVE_CREDENCIAIS, DRIVE_PASTA_ID

ESCOPOS = ['https://www.googleapis.com/auth/drive']
TIPO_PASTA = 'application/vnd.google-apps.folder'
CAMPOS = 'nextPageToken, files(id, name, mimeType, size, modifiedTime, md5Checksum)'
BLOCO_DOWNLOAD = 8 * 1024 * 1024


class Drive:
    def __init__(self, credenciais=DRIVE_CREDENCIAIS):
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        if not os.path.isfile(credenciais):
            sys.exit('Chave da conta de servico nao encontrada em: ' + credenciais +
                     '\nColoque o JSON baixado do Google Cloud nesse caminho ou defina HABITAR_CREDENCIAIS.')
        cred = service_account.Credentials.from_service_account_file(credenciais, scopes=ESCOPOS)
        self.email = cred.service_account_email
        self.api = build('drive', 'v3', credentials=cred, cache_discovery=False)

    def itens(self, pasta_id):
        consulta = "'%s' in parents and trashed = false" % pasta_id
        pagina = None
        while True:
            resposta = self.api.files().list(
                q=consulta, fields=CAMPOS, pageSize=1000, pageToken=pagina, orderBy='folder,name',
                supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
            yield from resposta.get('files', [])
            pagina = resposta.get('nextPageToken')
            if not pagina:
                return

    def baixa(self, arquivo_id, destino):
        from googleapiclient.http import MediaIoBaseDownload
        parcial = destino + '.parcial'
        with open(parcial, 'wb') as f:
            pedido = self.api.files().get_media(fileId=arquivo_id, supportsAllDrives=True)
            download = MediaIoBaseDownload(f, pedido, chunksize=BLOCO_DOWNLOAD)
            terminou = False
            while not terminou:
                _, terminou = download.next_chunk()
        os.replace(parcial, destino)

    def pasta(self, pasta_id):
        return self.api.files().get(fileId=pasta_id, fields='id, name', supportsAllDrives=True).execute()


def diagnostico(erro, email):
    texto = str(erro)
    if 'accessNotConfigured' in texto or 'has not been used' in texto:
        return ('A API do Drive nao esta ativada no projeto do Google Cloud desta chave. Abra o link do detalhe, '
                'clique em Ativar e espere alguns minutos.')
    if '404' in texto:
        return 'A pasta nao existe ou nao foi compartilhada com %s como Editor.' % email
    return 'Confira se a pasta foi compartilhada com %s como Editor.' % email


def ehpasta(item):
    return item['mimeType'] == TIPO_PASTA


def imprime_arvore(drive, pasta_id, recuo='  ', profundidade=2):
    for item in drive.itens(pasta_id):
        if ehpasta(item):
            filhos = list(drive.itens(item['id']))
            print('%s%s/  (%d itens)' % (recuo, item['name'], len(filhos)))
            if profundidade > 1:
                imprime_arvore(drive, item['id'], recuo + '  ', profundidade - 1)
        else:
            print('%s%s  %s KB' % (recuo, item['name'], int(item.get('size', 0)) // 1024))


if __name__ == '__main__':
    pasta_id = sys.argv[1] if len(sys.argv) > 1 else DRIVE_PASTA_ID
    if not pasta_id:
        sys.exit('Informe o ID da pasta: python py/drive.py <ID> (ou preencha DRIVE_PASTA_ID em py/comum.py)')
    drive = Drive()
    print('Conta de servico:', drive.email)
    try:
        raiz = drive.pasta(pasta_id)
    except Exception as erro:
        sys.exit('Nao consegui abrir a pasta %s.\n%s\nDetalhe: %s' % (pasta_id, diagnostico(erro, drive.email), erro))
    print('Pasta:', raiz['name'])
    imprime_arvore(drive, pasta_id)
