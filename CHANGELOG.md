# Histórico de versões

Cada versão publicada do núcleo, da mais nova para a mais antiga. Os apps prendem
o núcleo por commit (o «pino»), e mostram no rodapé a versão e o commit que
vieram junto.

## Como a versão é numerada

[Versionamento Semântico](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`.

| Nível | Quando sobe | Exemplo |
|---|---|---|
| MAJOR | Mudança que quebra quem usa: função que some ou muda de forma, estado gravado ou pacote que deixa de abrir | 1.4.2 → 2.0.0 |
| MINOR | Coisa nova, sem quebrar o que existia | 1.4.2 → 1.5.0 |
| PATCH | Correção, ajuste de texto, melhoria interna | 1.4.2 → 1.4.3 |

Antes de publicar, a versão pode levar sufixo de fase: `-alpha` (teste interno,
instável), `-beta` (grupo restrito) e `-rc.N` (candidata a lançamento, nos
testes finais).

Dois números que **não** são a versão, e andam sozinhos:

- **a leitura do `.DEC`** (`LEITURA_ATUAL`, em `historico/historico.ts`) sobe
  quando o leitor passa a extrair algo novo, e é ela que faz o app pedir para
  reimportar um ano. Uma leitura nova é MINOR aqui: ninguém quebra, o ano antigo
  continua abrindo;
- **a versão do pacote** (`PACOTE_VERSAO`, em `ponte/ponte.ts`) é o contrato
  entre os apps. Mudá-la de um jeito que o app antigo não leia é MAJOR.

A versão sobe no mesmo PR que muda o núcleo, com a entrada aqui. O teste
`src/versao.test.ts` confere que as duas batem.

## [Não publicado]

## [1.4.0] — 2026-09-30

O imposto retido na fonte deixa de passar por dinheiro poupado, e a leitura do
`.DEC` sobe para 7.

### Adicionado

- Leitura 7 do `.DEC`: do Registro 21, além do salário e do IR retido, o INSS
  (101–113), o 13º (114–126) e o IR do 13º (148–160), em `DecResult.retencoes`
  e somados por ano em `Declaracao.retencoes`. Ficam fora de `vals` de
  propósito: não sobem a base do IRPFM nem viram renda de quem descontou.
  Posições conferidas num arquivo real da declaração 2024.
- `impostoNaFonte`: IR retido, carnê-leão, INSS e IR do 13º do ano.
- `AnoCapital.impostos` e `AnoCapital.gastoQueFecha` — o gasto que zera o
  embutido quando o patrimônio cresceu menos do que sobrou da renda (piso: com
  ele, o capital rende pelo menos o que distribuiu).
- `AnoAnalisado.decimoTerceiro` e `AnoAnalisado.impostoNaFonte`.
- O 13º entra na composição da renda como trabalho (`composicaoDoAno`).
- Tabela da B3: `AMORTIZACAO PROGRAMADA`, `AMORTIZACAO EXTRAORDINARIA`,
  `AMORT. EXTRAORDINARIA`, `ANTECIPACAO` e `EVENTO GENERICO` como devolução
  do principal de debênture, CRI e CRA (vêm com «Debito» e o PU do evento), e
  `COMPRA/VENDA DEFINITIVA A TERMO` como fluxo.

### Corrigido

- `analiseCapital`: poupado era renda bruta − gasto. O imposto que a fonte
  reteve nunca chegou à conta, e o crescimento que ele «não explicava» era
  cobrado do capital — o rendimento encolhia do tamanho do imposto. Agora é
  renda − imposto na fonte − gasto.
- `analisarConsistencia`: as fontes do ano descontam o imposto na fonte e somam
  o 13º, como a Receita faz na análise da evolução patrimonial. O campo de
  gasto passa a ser custo de vida, doações e imposto pago à parte (ajuste,
  DARF) — o retido a conta tira sozinha.
- `AMORTIZACAO PROGRAMADA` caía no palpite antigo e virava provento; o
  principal devolvido contava como renda.

## [1.3.0] — 2026-09-30

A tabela inteira do Extrato de Movimentação da B3, e o sinal certo para o
dinheiro que o emissor devolve.

### Adicionado

- `leituraNoPatrimonio` (`b3/efeito.ts`): o que cada tipo de «Movimentação» faz
  com o dinheiro do papel — `fluxo` (o lado da linha diz se entrou ou saiu),
  `devolucao`, `provento`, `semDinheiro` ou `custo`, com o porquê em uma frase.
  São 41 tipos, pesquisados no manual da Central Depositária da B3 e em
  exportações reais, mais os estados que a B3 põe no fim do nome («-
  Transferido», «- Excluído», «- Exercido», «- Não Exercido», «- Solicitada»,
  «- Reativado»). `chaveDoTipo` junta as grafias do mesmo tipo («COMPRA /
  VENDA» e «COMPRA/VENDA», «RESGATE ANTECIPADO/»).
- `efeitoDaLinha`: a resposta da pessoa, senão a tabela, senão os palpites
  antigos.

### Corrigido

- Amortização, «Resgate» pago pelo emissor, restituição de capital, leilão de
  fração e resgate creditado em conta vêm como «Credito» — o dinheiro foi
  creditado no bolso — e eram lidos como aporte no papel. Agora
  `dinheiroDaLinha` os conta como dinheiro saindo, qualquer que seja o lado.
- Transferência de custódia, provento «- Transferido», atualização, direitos,
  subscrição, empréstimo e a taxa semestral do Tesouro deixam de ser pergunta:
  nenhum deles move o dinheiro do papel.

## [1.2.0] — 2026-09-30

### Adicionado

- `analiseCapital` devolve `naoRecorrente` — herança e doação recebida
  informadas —, e o `embutido` passa a descontá-lo. Era dinheiro de fora contado
  como rendimento do capital.

## [1.1.0] — 2026-09-29

O extrato da B3 passa a ser do núcleo, e o juro por competência passa a usar as
datas dele.

### Adicionado

- **`/b3`** — o leitor do Extrato de Movimentação da B3 (`lerMovimentacao`,
  `unirMovimentacoes`), o que cada linha significa para a bolsa e para o
  patrimônio (`classificarParaCarteira`, `papelNoPatrimonio`, `dinheiroDaLinha`),
  o fluxo do ano por ativo (`fluxosDeMovimentos`, `casarLista`) e o texto do
  produto (`tickerDoProduto`, `raizTicker`). Estavam no IRPF-calc; vieram sem
  mudar o comportamento, para o networthcontrol ler o mesmo arquivo com o mesmo
  vocabulário.
- A ponte entre o extrato e os bens da declaração: cada posição (o papel numa
  instituição) ligada a um bem — pelo ticker, pela resposta da pessoa, ou com um
  palpite pelo nome na renda fixa, que só vale confirmado e desempata pelo
  dinheiro que anda com o saldo (`ligarPosicoes`) —, e o
  que sai dela: os movimentos de cada bem com data (`movimentosDosBens`), o aporte
  de cada ano (`aportesDoExtrato`) e a custódia pela coluna «Instituição»
  (`custodiaDoExtrato`), já com o nome que a família usa.
- `ativoDaPosicao`: na renda fixa, o papel é o código do título («CDB -
  CDB24AUR0002 - BANCO …» → `CDB24AUR0002`), e não o tipo — senão todos os CDBs da
  mesma corretora seriam uma posição só.
- `nomeDaInstituicao`: a razão social de uma instituição conhecida vira o nome
  curto («XP INVESTIMENTOS CCTVM S/A» → «XP Investimentos»). É o que faz a XP do
  extrato e a XP do `.DEC` serem a mesma linha.
- `rendimentoPorCompetencia` aceita `movimentos`: com as datas do extrato, a
  aplicação rende a partir do dia dela, o lote que a primeira declaração já
  encontra ganha a data em que entrou — e o resgate dele passa a medir a taxa —,
  e a renovação no mesmo ano, que o saldo pelo valor aplicado não mostra, aparece.
  No valor atualizado, o ano com movimento passa a ser medido. Sem `movimentos`, o
  resultado é o mesmo de antes.

### Corrigido

- `casarAtivo` escapa o texto do ativo antes de montar a expressão: um produto
  com `+` («TESOURO IPCA+ 2035») virava outra expressão, e um com parêntese sem
  par derrubava a leitura.

## [1.0.0] — 2026-09-29

Primeira versão numerada. Até aqui o núcleo andava sem número, só pelo commit do
pino; esta reúne o que ele é hoje:

- **o leitor do `.DEC`**, posicional, nos dois leiautes conferidos (sem e com
  grupo), com o CNPJ de cada bem e o código de cada rendimento — leitura 6;
- **o modelo plurianual**: N declarações, a identidade de cada bem entre anos, os
  vínculos, e o que só a pessoa sabe — a origem de cada pagador, onde está cada
  bem e quem deve;
- **o fiscal**: parâmetros por ano, INSS/IRRF, ajuste anual, deduções, a grade de
  dividendos com o Art. 6º-A, e a apuração de renda variável;
- **o patrimônio**: quanto o capital rendeu, as referências (CDI, Selic, IPCA) e o
  juro da renda fixa por competência, calibrado pelo que cada CNPJ pagou;
- **o cofre** (Argon2id + AES-GCM, passkeys, sync), **a ponte** entre os apps
  (pacote do histórico e da base) e os componentes de tela que os três dividem.

### Adicionado

- Este histórico, e a regra de numeração acima.
