import argparse
import html
import re
from pathlib import Path
from urllib.parse import urlencode

import segno

PASTA = Path(__file__).resolve().parent
BASE_PADRAO = "https://davidcaetanor.github.io/map-habitar-santana/pesquisa/"
ORIGENS_PADRAO = [
    "usjt",
    "t1-voluntarios",
    "t2-moreira-de-barros",
    "t5-amaral-gama",
    "metro-santana",
    "whatsapp",
]
COLETORES_PADRAO = ["david", "beatriz", "tamara", "caua", "melissa", "gabrielle"]
CODIGO_VALIDO = re.compile(r"^[a-z0-9_-]{1,40}$")
CORRECAO_QR = "q"
BORDA_QR = 4

MODELO_CARTAZES = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Cartazes da pesquisa</title>
<style>
  @page { size: A5 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #d9d9d9; font: 16px/1.4 system-ui, "Segoe UI", Roboto, sans-serif; color: #111; }
  .cartaz {
    width: 148mm;
    height: 210mm;
    margin: 8mm auto;
    padding: 12mm 12mm 9mm;
    background: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    page-break-after: always;
    break-after: page;
  }
  .selo { font-size: 3.4mm; letter-spacing: 0.4mm; text-transform: uppercase; color: #444; margin: 0 0 3mm; }
  h1 { font-size: 8.5mm; line-height: 1.1; margin: 0 0 3mm; }
  .chamada { font-size: 4.1mm; margin: 0 0 4mm; max-width: 122mm; }
  .qr { width: 62mm; height: 62mm; flex: none; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .instrucao { font-size: 4.1mm; font-weight: 600; margin: 3mm 0 1mm; }
  .endereco { font-size: 3.2mm; color: #444; margin: 0 0 4mm; word-break: break-all; }
  .servico { width: 100%; flex: none; border: 0.9mm solid #111; border-radius: 3mm; padding: 3mm 4mm; margin-top: auto; }
  .servico small { display: block; font-size: 4.4mm; font-weight: 600; }
  .servico strong { display: block; font-size: 11mm; line-height: 1.1; }
  .servico span { display: block; font-size: 3.4mm; margin-top: 1mm; }
  .rodape { font-size: 2.9mm; color: #555; margin: 3mm 0 0; flex: none; }
  .cartaz:last-child { page-break-after: auto; break-after: auto; }
  @media print {
    body { background: #fff; }
    .cartaz { margin: 0; }
  }
</style>
</head>
<body>
__CARTAZES__
</body>
</html>
"""

MODELO_CARTAZ = """<section class="cartaz">
  <p class="selo">Projeto de extensão USJT</p>
  <h1>Como é viver em Santana?</h1>
  <p class="chamada">Conte como estão a segurança, a acessibilidade e a sustentabilidade no bairro e na sua moradia. Leva 3 minutos e é anônimo.</p>
  <div class="qr">__QR__</div>
  <p class="instrucao">Aponte a câmera do celular para o QR code</p>
  <p class="endereco">__ENDERECO__</p>
  <div class="servico">
    <small>Problema no bairro?</small>
    <strong>Ligue 156</strong>
    <span>Prefeitura de São Paulo: buraco, calçada, iluminação, lixo, árvore. Também no aplicativo SP156.</span>
  </div>
  <p class="rodape">INTEGRA-HABITAR: Moradia Segura, Acessível e Sustentável. Ponto: __ORIGEM__</p>
</section>"""


def montar_link(base, origem=None, coletor=None):
    params = {}
    if origem:
        params["o"] = origem
    if coletor:
        params["c"] = coletor
    return base + ("?" + urlencode(params) if params else "")


def validar_codigos(codigos, rotulo):
    for codigo in codigos:
        if not CODIGO_VALIDO.match(codigo):
            raise SystemExit(
                rotulo + " invalido: '" + codigo + "'. Use so letras minusculas sem acento, numeros, hifen e sublinhado."
            )


def qr_de(link):
    return segno.make(link, error=CORRECAO_QR)


def salvar_qr(link, nome, pasta_qr):
    qr = qr_de(link)
    qr.save(str(pasta_qr / (nome + ".svg")), scale=10, border=BORDA_QR)
    qr.save(str(pasta_qr / (nome + ".png")), scale=20, border=BORDA_QR)


def entradas(base, origens, coletores):
    for origem in origens:
        yield "cartaz " + origem, "cartaz-" + origem, montar_link(base, origem=origem)
    for coletor in coletores:
        yield "entrevista " + coletor, "entrevista-" + coletor, montar_link(base, origem="entrevista", coletor=coletor)


def montar_cartaz(base, origem):
    link = montar_link(base, origem=origem)
    svg = qr_de(link).svg_inline(scale=1, border=BORDA_QR, dark="#000000", light="#ffffff", omitsize=True)
    endereco = base.replace("https://", "").rstrip("/")
    return (
        MODELO_CARTAZ.replace("__QR__", svg)
        .replace("__ENDERECO__", html.escape(endereco))
        .replace("__ORIGEM__", html.escape(origem))
    )


def main():
    parser = argparse.ArgumentParser(description="Gera QR codes, cartazes A5 e a lista de links da pesquisa.")
    parser.add_argument("--base", default=BASE_PADRAO)
    parser.add_argument("--origens", nargs="*", default=ORIGENS_PADRAO)
    parser.add_argument("--coletores", nargs="*", default=COLETORES_PADRAO)
    args = parser.parse_args()

    base = args.base if args.base.endswith("/") else args.base + "/"
    validar_codigos(args.origens, "origem")
    validar_codigos(args.coletores, "coletor")

    pasta_qr = PASTA / "qr"
    pasta_qr.mkdir(exist_ok=True)
    linhas = []
    for rotulo, nome, link in entradas(base, args.origens, args.coletores):
        salvar_qr(link, nome, pasta_qr)
        linhas.append(rotulo + "\t" + link)

    cartazes = "\n".join(montar_cartaz(base, origem) for origem in args.origens)
    (PASTA / "cartazes.html").write_text(MODELO_CARTAZES.replace("__CARTAZES__", cartazes), encoding="utf-8")
    (PASTA / "links.txt").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    print("origens:", len(args.origens), "| coletores:", len(args.coletores), "| saida:", PASTA)


if __name__ == "__main__":
    main()
