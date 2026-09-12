# Plano — Separar renda de trabalho de renda de capital

> Estado: **fases 1 e 2 feitas**; 3 a 6 em aberto. Escrito antes do trabalho
> começar e deixado como estava, com o resultado anotado no fim de cada fase,
> inclusive onde divergir do previsto — é a parte do documento que ensina alguma
> coisa.
>
> ⟨confirmar⟩ nº 1 está **respondido**: lucro da própria PJ é trabalho. Isso é a
> resposta DESTA pessoa e vira a sugestão e a migração do booleano; continua não
> sendo regra no app, porque a próxima pessoa pode ser sócia sem trabalhar lá.
>
> Vale para os quatro repositórios. Mora aqui porque a primeira fase é do
> **modelo**, e porque três apps leem a mesma classificação: uma segunda cópia
> dela divergiria em silêncio, e divergir aqui é dizer a alguém que vive de renda
> quando ele vive de plantão.
>
> ⚠️ Nada aqui é aconselhamento tributário. O que está marcado **⟨confirmar⟩**
> depende de decisão da pessoa ou de contador e não deve virar número afirmado.

## O problema, em uma frase

Os apps somam o que a PJ distribui com o que a carteira rende, chamam a soma de
«renda», e projetam o futuro dela com **uma taxa só** — sendo que as duas metades
crescem por motivos que não têm nada a ver um com o outro: uma cresce porque a
pessoa trabalha mais, a outra porque o patrimônio ficou maior.

## O que está misturado hoje

Cinco achados. Os quatro primeiros são de conta; o quinto é de leitura.

### RT-01 · A classificação é um botão só, e é binária sobre todos os dividendos

`patrimonio/renda.ts:71` troca a origem de `divBR` inteiro conforme um booleano:

```ts
origem: f.chave === 'divBR' && opts.dividendosSaoTrabalho ? 'trabalho' : f.origem
```

Quem tem PJ **e** carteira de ações — que é exatamente o público deste app — erra
nos dois sentidos possíveis, e não há terceira opção. Pior: o padrão é ligado
(`networthcontrol/src/App.tsx:71`), então o dividendo de ITSA4 e do ETF entra como
«trabalho» para todo mundo até alguém desmarcar — e aí o lucro da própria clínica
vira «capital» junto.

O erro não é o booleano ter sido mal escolhido. É a origem estar presa à **fonte
fiscal** quando ela é propriedade do **pagador**:

| Fonte fiscal | pode ser trabalho | pode ser capital |
|---|---|---|
| `salario` (pró-labore) | ✅ sempre | — |
| `divBR` (lucros e dividendos) | ✅ a minha PJ | ✅ ação, ETF, participação minoritária |
| `outros` (JCP, carnê-leão) | ✅ serviço prestado | ✅ JCP |
| `exterior` | ✅ trabalho remoto | ✅ carteira lá fora |
| `aluguel`, `cdb`, `isentos`, `divFII`, `bolsa` | — | ✅ |

Três linhas da tabela são ambíguas, e a ambiguidade só se resolve sabendo **quem
pagou**. Nenhuma regra sobre a fonte fiscal resolve, porque a informação não está
na fonte fiscal.

### RT-02 · O pagador está no arquivo, e é jogado fora no import

O leitor do `.DEC` extrai CNPJ e nome da fonte pagadora em cada lançamento
(`dec/decParser.ts:309` — Registro 84/88, e o mesmo nos 21/22/24). Aí
`somaPorAlvo` (`historico/historico.ts:346`) agrega por `alvo` e **descarta o
pagador**: o que sobra em `Declaracao.vals` é `{ divBR: 480000 }`, sem dizer que
R$ 360 mil vieram da minha PJ e R$ 120 mil da B3.

Quer dizer: o dado que responderia a pergunta é lido, usado uma vez e perdido. O
mesmo vale do lado da B3, onde ele **não** se perde: o IRPF-calc já guarda
`proventosB3` por ano e pagador, e `b3Emissor` já é «a resposta da pessoa sobre
quem é o pagador deste produto», guardada uma vez.

### RT-03 · A renda cresce por uma taxa só

Dois lugares, a mesma conta:

- `networthcontrol/src/analise/rendaGasto.ts:87` — `taxaRenda` sai do histórico da
  renda **total** e multiplica a renda total, ano após ano.
- `networthcontrol/src/analise/dashboard.ts:739` — `base = base * (1 + taxaBase)`,
  onde `base` é a base do IRPFM: pró-labore mais dividendos mais aplicações mais
  aluguel mais bolsa, tudo junto, extrapolado por uma taxa média de três anos.

É a taxa de uma mistura aplicada às duas metades. Os dois erros que ela produz são
simétricos e os dois acontecem na vida real:

- carteira compondo rápido → a taxa da mistura sobe, e o app projeta pró-labore
  crescendo 12% ao ano para sempre;
- salto de pró-labore (contrato novo, sócio novo) → a taxa da mistura sobe, e o
  app projeta a carteira acompanhando um salto que foi da carreira.

E o número que sai disso é o mais consequente da família: **em que ano eu cruzo os
R$ 600 mil**.

Falta ainda a parte que nenhuma taxa histórica resolve: renda de capital **não é
uma série que se extrapola**. Ela é uma função do patrimônio — carteira maior
distribui mais, na mesma proporção. Projetá-la como série independente ignora que
o app já está projetando o patrimônio logo ao lado, com outra premissa.

### RT-04 · A projeção conta a renda de capital duas vezes — o mais grave

`poupancaAnual` (`analise/poupanca.ts:86`) é `renda − gasto`, e `renda` é
`rendimentosDeclarados`, que soma **tudo**, inclusive dividendo, juro de CDB e
aluguel (`historico/consistencia.ts:223`).

`projetar` (`analise/dashboard.ts:737-738`) faz:

```ts
const rendimento = pat * juros
pat = pat + rendimento + poupancaAno
```

`pat * juros` é o retorno **total** do capital. `poupancaAno` inclui a parte desse
retorno que foi distribuída e reinvestida. Ela entra duas vezes.

Não é hipótese: o painel oferece um botão «usar meu retorno médio»
(`telas/Dashboard.tsx:1149`) que joga em `juros` justamente o retorno medido por
`analiseCapital`, que é `embutido + renda de capital` sobre o patrimônio médio —
ou seja, o retorno que **já inclui** o que foi distribuído. Um clique e a dupla
contagem é certa.

Ordem de grandeza, com números redondos: pró-labore 400k, custo de vida 300k,
carteira de 2,2 M rendendo 9,5% ao ano dos quais 80k caem como dividendo e são
reinvestidos.

| | Poupança usada | Patrimônio em 5 anos |
|---|---|---|
| Hoje | (400k + 80k) − 300k = **180k** | 4,55 M |
| Correto | 400k − 300k = **100k** | 4,07 M |

**Meio milhão de patrimônio que não existe, em cinco anos** — e ele aparece
justamente no gráfico que a pessoa usa para decidir quando parar de trabalhar.

A correção é exatamente a separação deste plano: poupança é **dinheiro que entra
de fora da carteira**, e dinheiro de fora da carteira é renda de trabalho menos
gasto. A renda de capital já está dentro de `pat * juros`. A fórmula corrigida
também acerta o caso oposto, que hoje ela erra: quem já vive de dividendos tem
trabalho − gasto **negativo**, e a projeção passa a mostrar a carteira sendo
consumida, em vez de crescer.

### RT-05 · Visualmente as duas rendas não se distinguem

`GraficoOrigem` (`networthcontrol/src/telas/RendaCapital.tsx`) empilha por fonte
com um respiro de 3px onde o grupo muda, e dá a cada fonte uma cor de
`VIZ.serie` (`ui/theme.ts:37`): azul, laranja, verde, âmbar, rosa, verde-escuro.
São seis cores sem parentesco entre si. Quem olha a barra vê seis faixas
coloridas e tem de ler a legenda, fonte por fonte, para saber onde está a divisa
— que é a única coisa que o gráfico existe para mostrar.

O respiro de 3px foi a tentativa certa com a ferramenta errada: a hierarquia é de
**cor**, não de espaço.

---

## O modelo: a origem é do pagador

Uma decisão, e tudo abaixo decorre dela.

```ts
export type Origem = 'trabalho' | 'capital' | 'indefinido'   // (inalterado)

/** Quem pagou, e o que a pessoa respondeu sobre ele. */
export interface Pagador {
  /** Identidade estável: CNPJ quando há, senão o nome normalizado. */
  id: string
  nome: string
  cnpj?: string
}

/** A resposta da pessoa: `id do pagador → origem`. Um lugar só, os três apps. */
export type OrigemPorPagador = Record<string, Origem>
```

Mesma forma de `classeOverrides` e `b3Emissor`: **o arquivo traz o texto, a pessoa
responde uma vez, a resposta fica guardada e vale para todos os anos**. É o padrão
que a família já usa em quatro lugares, e é o que faz o ano seguinte perguntar só
o que é novo.

O que o app pode **sugerir** sem inventar (sugestão, nunca afirmação):

| Indício | Sugestão | Por quê |
|---|---|---|
| CNPJ também aparece pagando `salario` | trabalho | pró-labore e lucro da mesma empresa |
| Pagador também está em `proventosB3` | capital | veio da corretora, é papel listado |
| Fonte de `divFII`, `cdb`, `isentos`, `bolsa`, `aluguel` | capital | não há leitura de trabalho |
| Uma PJ só, e ela concentra os dividendos | trabalho | o caso comum de quem usa o app |
| Nada disso | **indefinido** | e fica cinza, sem entrar em proporção nenhuma |

`indefinido` não é estado de erro, é resposta legítima, e ele **não pode vazar**
para dentro de média nenhuma. É a mesma disciplina que `semGasto` e `presumido` já
têm no resto do núcleo: o número que não se pode afirmar sai marcado, não sai
chutado.

---

## Ordem de ataque

| # | Fase | Onde | Por que nessa posição |
|---|---|---|---|
| 1 | ✅ Vocabulário: origem por pagador | IRPF-CORE | nada anda sem o tipo; sozinha já substitui o booleano |
| 2 | ✅ Guardar o pagador no import | IRPF-CORE + IRPF-calc | é o dado; sem ele a fase 1 vive de palpite |
| 3 | A tela de responder | IRPF-calc | é onde mora a correção manual, por decisão de fronteira |
| 4 | **Projeção em duas pernas** | IRPF-CORE + networthcontrol | corrige RT-04, que é número errado com cara de certo |
| 5 | Leitura e cor | networthcontrol | o que a pessoa pediu ver; depende das quatro |
| 6 | Base do IRPFM por fonte | IRPFM-2027 | mesma correção, no número mais consequente |

A fase 4 é a que justifica o lote. As outras cinco melhoram a leitura; a 4 conserta
um patrimônio projetado meio milhão acima do que a premissa diz.

---

## Fase 1 — Vocabulário: origem por pagador — ✅ FEITO

**Muda** `IRPF-CORE/src/patrimonio/renda.ts`.

```ts
export function composicaoRenda(
  vals: Record<string, number>,
  opts: {
    /** Renda por pagador dentro de cada fonte (fase 2). Ausente = só `vals`. */
    porPagador?: RendaPorPagador[]
    origens?: OrigemPorPagador
    /** @deprecated fallback do estado gravado antes da fase 3. */
    dividendosSaoTrabalho?: boolean
  } = {},
): ComposicaoRenda
```

`ComposicaoRenda` ganha `porOrigem: { trabalho: FonteRenda[]; capital: FonteRenda[]; indefinido: FonteRenda[] }`
— hoje a tela refaz esse agrupamento sozinha, com a regra de ordenação duplicada
em `ordemNaPilha`.

**Compatibilidade.** Sem `origens`, o booleano continua valendo, exatamente como
hoje. Estado gravado abre igual e o painel não muda de número. É o que permite as
fases 1 e 2 entrarem sem tela nenhuma.

**Testes.** Os de `capital.test.ts` continuam passando sem edição — é o critério
de que a fase 1 não mudou comportamento. Novos: pagador classificado como trabalho
sai da fração de capital mesmo com a fonte sendo `divBR`; pagador indefinido não
entra em `trabalho` nem em `capital` e aparece em `indefinido`; dois pagadores na
mesma fonte com origens opostas dividem o valor certo.

### O que saiu

Saiu como previsto, com duas coisas a mais que o desenho pediu quando virou código:

- **`FonteRenda.id`.** Uma ficha que se divide em duas origens vira duas fatias,
  e `chave` deixou de ser identidade — duas fatias com a mesma chave dariam chave
  de React repetida e legenda dobrada. `id` é `chave` no caso comum e
  `chave·origem` quando divide, então quem já lia `chave` não muda.
- **`ComposicaoRenda.porOrigem`.** A tela reagrupava por origem sozinha, com a
  regra de empilhamento duplicada dentro dela. Agora o agrupamento sai pronto.

O critério de que a fase não mudou comportamento: os 445 testes que já existiam
passaram **sem uma edição**, e os 95 do networthcontrol e os 212 do IRPFM-2027
também, com o núcleo novo instalado e nenhuma linha de código mudada nos dois.

## Fase 2 — Guardar o pagador no import — ✅ FEITO

**Muda** `historico/historico.ts` e `dec/decParser.ts` (só o que já lê).

```ts
export interface RendaPorPagador {
  alvo: string          // a chave de fiscal/fontes.ts
  pagador: Pagador
  valor: number
}

export interface Declaracao {
  // …
  /** Renda por pagador dentro de cada fonte. Ausente = leitura anterior à 4. */
  porPagador?: RendaPorPagador[]
}
```

`somaPorAlvo` continua existindo e continua alimentando `vals` — `vals` é o que o
resto do mundo lê, e trocá-lo seria refazer meia família por um campo novo.
`porPagador` entra ao lado, derivado dos mesmos lançamentos.

`LEITURA_ATUAL` sobe de **3 para 4**. O mecanismo de reimportação já existe e já
funciona: `consistencia.ts:424` marca `leituraAntiga` sozinho, e o IRPF-calc já
mostra o convite para reimportar o ano (`auditar/Consistencia.tsx:68`). Falta só
levar a marca para a tela de histórico, que é onde quem importa está olhando. Até
a reimportação, o ano cai no fallback do booleano — nada quebra, e o que falta
fala.

**Privacidade.** O CNPJ passa a ficar no cofre cifrado. Não é classe nova de dado:
`PosicaoAno.bruta` já guarda a **linha inteira** do `.DEC` no mesmo lugar. O
anonimizador opera sobre o texto do arquivo antes de sair, não sobre o histórico,
então continua cobrindo o caminho de compartilhar. Sem mudança aqui — mas fica
dito, porque «guardou CNPJ» é a pergunta que alguém vai fazer.

**Testes.** Um `.DEC` de exemplo com duas fontes pagando `divBR` produz duas
linhas em `porPagador`, cuja soma bate com `vals.divBR` **exatamente** — a
igualdade é invariante, e é ela que impede o detalhamento de divergir do total.

### O que saiu

**A igualdade acima estava errada, e o Registro 22 é quem mostrou.** Ele traz
exterior e carnê-leão sem fonte pagadora nenhuma — campo de CNPJ zerado, nome em
branco. Havia duas saídas:

- inventar um pagador «não identificado». Recusada: daria à pessoa uma linha para
  responder sobre algo que ela não tem como reconhecer, e uma resposta sobre ela
  erraria várias fichas de uma vez (todo registro sem fonte tem o mesmo CNPJ
  zerado, então todos viriam colados no mesmo pagador);
- deixar o lançamento fora do detalhamento, inteiro em `vals`.

Ficou a segunda, e a invariante virou **`soma dos pagadores ≤ vals[ficha]`**.
Quem lê atribui a diferença ao padrão da ficha, o que também cobre de graça o
outro caso em que `porPagador` está vazio: o ano importado por leitura anterior à
4. Os dois caem no mesmo caminho, e é por isso que a fase não mudou número nenhum.

**`sugerirOrigens` veio para cá, e não para a fase 3.** Sugerir a origem a partir
do que o próprio arquivo mostra é modelo, não pergunta — a fronteira que o resto
da família já usa. A fase 3 fica sendo só uma tela.

Dos indícios da tabela acima, **um foi recusado na implementação**: «uma PJ só, e
ela concentra os dividendos → trabalho». É o mais fraco dos quatro e erra
exatamente quem tem uma posição grande e concentrada em bolsa. Os outros três
ficaram. Quem não cai em nenhum — a PJ que distribui lucro sem pagar pró-labore,
que é caso comum — fica `indefinido`, e essa é a resposta certa: só quem tem o
contrato social sabe.

**O que não estava previsto e teve de entrar:** subir `LEITURA_ATUAL` quebrou o
aviso de «reimporte este ano», que tinha a lista do que falta escrita na tela.
Todo ano lido pela versão 3 passaria a ser mandado procurar os rendimentos
isentos que ele já tem — motivo errado, que é pior do que nenhum. `GANHOS_DA_LEITURA`
e `oQueFaltaNaLeitura` passam a dizer o que cada versão trouxe, com a
consequência junto, e as duas telas do IRPF-calc montam o texto de lá. A marca
também passou a aparecer na linha de cada ano do histórico: descobrir três telas
adiante que o ano precisa ser relido é descobrir tarde.

## Fase 3 — A tela de responder

**Muda** `IRPF-calc/src/importar/Historico.tsx`, e o estado ganha
`origemPagador?: OrigemPorPagador`.

Fica no IRPF-calc por decisão de fronteira já registrada: corrigir o histórico é
daqui, e repetir a tela no networthcontrol seria repetir a manutenção dela.

A tela é uma lista, ordenada por valor, com a sugestão já marcada e o motivo dela
ao lado — «também paga o seu pró-labore», «veio da corretora». Três botões por
linha: trabalho, capital, ainda não sei. Quem tem uma PJ e uma corretora responde
duas vezes, uma vez na vida.

O pacote de histórico (`ponte/ponte.ts`, `PacoteHistorico`) ganha
`origemPagador?: OrigemPorPagador`, junto com os outros campos de trabalho manual
— é o motivo de o pacote existir, e sem ele o networthcontrol perguntaria tudo de
novo. Campo novo e opcional: `PACOTE_VERSAO` **não** sobe.

O booleano `dividendosSaoTrabalho` sai da tela do networthcontrol e vira migração
silenciosa: ligado = todo pagador de `divBR` sugerido como trabalho.

## Fase 4 — Projeção em duas pernas

A fase que conserta RT-04 e RT-03. Toda em `networthcontrol/src/analise/`, com o
modelo em `IRPF-CORE/src/patrimonio/`.

**4a — Poupança passa a ser dinheiro de fora da carteira.**

```
poupança = renda de trabalho − gasto          (era: renda total − gasto)
```

`poupancaAnual` recebe a composição e usa `comp.trabalho`. Efeito colateral bom: a
poupança passa a poder ser negativa por motivo verdadeiro (quem vive de
dividendos), e a projeção mostra a carteira sendo consumida em vez de crescer.

Ano com renda `indefinido` **não escolhe um lado**: o ano sai marcado, a projeção
vira faixa entre «indefinido é trabalho» e «indefinido é capital», e a tela diz
qual pagador fecha a faixa. Ficar com a estimativa mais bonita seria o oposto do
que o resto do núcleo faz.

A regra dos 30% para ano sem custo de vida (`POUPANCA_SEM_GASTO`) passa a incidir
sobre a renda de **trabalho** — 30% da renda total, para quem tem carteira grande,
sempre foi alto demais.

**4b — A renda de capital vira função do patrimônio.**

```
yield distribuído = renda de capital do ano ÷ patrimônio médio do ano
renda de capital(t) = patrimônio(t−1) × yield distribuído
renda de trabalho(t) = renda de trabalho(t−1) × (1 + taxa do trabalho)
patrimônio(t) = patrimônio(t−1) × (1 + juros) + renda de trabalho(t) − gasto(t)
```

O yield distribuído é **medido**, não digitado: sai do histórico, é estável na
mesma carteira, e é a peça que faz as duas projeções — a do patrimônio e a da
renda — pararem de se contradizer. Hoje elas são calculadas em módulos separados,
com premissas diferentes, e nada obriga a renda projetada a caber no patrimônio
projetado. ⟨confirmar⟩ se o yield deve ser média simples dos anos medidos ou o do
último ano; começar pela média dos mesmos anos que `retornoMedio` já aceita.

`taxa do trabalho` sai da série de trabalho sozinha, pelas mesmas três leituras
(média, mediana, CAGR) e a mesma janela de três anos. A faixa de `projetar` passa a
ser a faixa do **trabalho** — o capital tem a dele, que é a premissa de juros.

**Testes.** O que prova RT-04: histórico onde toda a renda é de capital e o gasto
é zero deve projetar patrimônio **idêntico** a `pat × (1 + juros)^n`, sem um real
de poupança somado. Hoje falha. É o teste que não deixa a regressão voltar.

## Fase 5 — Leitura e cor

**Cor.** Duas famílias, não seis avulsas: trabalho em uma faixa quente, capital em
uma fria, e cada fonte é um degrau de luminosidade dentro da sua. A divisa passa a
ser visível sem legenda — que é a coisa que o gráfico existe para mostrar. O
`indefinido` continua no cinza. Sai o respiro de 3px, que era a hierarquia certa
na ferramenta errada. `VIZ.serie` ganha `VIZ.trabalho[]` e `VIZ.capital[]` ao lado,
sem mexer no que outros gráficos já usam.

**Leituras novas**, que só existem depois da separação:

| Leitura | A conta | A pergunta que responde |
|---|---|---|
| Cobertura passiva | renda de capital ÷ gasto | quanto do meu custo de vida a carteira já paga |
| Ano da virada | primeiro ano projetado com cobertura ≥ 1 | quando o trabalho vira opcional |
| As duas taxas, lado a lado | taxa do trabalho vs. yield × crescimento | qual das duas metades está me carregando |
| Dependência | renda de trabalho ÷ renda total | o que cai se eu parar amanhã |

A cobertura passiva é a que muda a conversa: «45% da renda vem do capital» é uma
proporção que sobe quando o pró-labore cai, inclusive por motivo ruim. «A carteira
paga 62% do meu custo de vida» não tem esse defeito, porque o denominador não se
mexe quando a outra metade encolhe.

**Renda × gasto** (`RendaGasto.tsx`): a linha da renda vira duas áreas empilhadas,
com a projeção seguindo as duas regras da fase 4b. Onde há `indefinido`, a área é
hachurada — não uma terceira cor sólida, que leria como uma terceira renda.

## Fase 6 — Base do IRPFM por fonte

**Muda** `IRPFM-2027`. A base deixa de ser extrapolada em bloco e passa a ser a
soma das fontes projetadas, cada uma pela sua regra: pró-labore pela taxa do
trabalho, dividendos e aplicações pelo patrimônio projetado × yield, aluguel pela
inflação ⟨confirmar⟩, bolsa sem projeção automática (é evento, não série).

Muda o ano do cruzamento dos R$ 600 mil, que é a resposta que o app existe para
dar, e muda em geral **para mais tarde** — porque a taxa da mistura hoje empurra o
pró-labore para cima junto com a carteira.

Dois encaixes que já estão prontos e hoje não conversam:

- a grade de dividendos (`fiscal/dividendos.ts`) já é **por PJ pagadora**. As
  colunas dela são a mesma lista de pagadores da fase 3, digitada de novo em outro
  app. Ligar as duas tira uma digitação e acaba com a chance de as duas listas
  discordarem;
- o comparador de holding é, do começo ao fim, sobre renda de trabalho vestida de
  dividendo. Com a classificação por pagador ele para de perguntar `nPJ` — ele
  sabe quais são.

---

## Compatibilidade

| Quem | O que acontece |
|---|---|
| Estado gravado dos três apps | abre igual; campos novos são todos opcionais |
| Histórico lido pela versão 3 | abre, cai no fallback do booleano, aparece marcado com o convite de reimportar |
| Pacote de histórico antigo | abre; sem `origemPagador`, as sugestões da fase 3 rodam do zero |
| `PACOTE_VERSAO` | **não sobe** — só campo novo e opcional |
| `SCHEMA_VERSION` dos apps | **não sobe** pelo mesmo motivo |
| `LEITURA_ATUAL` | 3 → 4, que é precisamente o mecanismo que existe para isto |

O número que **vai** mudar na tela de quem já usa é o patrimônio projetado, para
baixo. Tem de mudar: é RT-04. A tela deve dizer, uma vez, por que mudou — número
que cai meio milhão sem explicação lê-se como bug.

## O que não vai ser feito, e por quê

- **Adivinhar a origem por regra fixa** («CNPJ com 4 dígitos iniciais tal é
  holding»). O `.DEC` não prova sociedade, e um mapa hardcoded vira bug silencioso
  na proporção que a tela afirma. Sugestão com motivo à vista, sempre; afirmação,
  nunca.
- **Um terceiro grupo «renda mista»**. Duas origens já são o quanto se consegue
  responder; a terceira seria um lugar para não decidir, e ela encheria.
- **Separar trabalho em CLT e pró-labore.** Os dois crescem pela carreira e
  projetam igual. Se um dia a diferença importar, ela já cabe: o pagador está
  guardado.
- **Reclassificar dentro do networthcontrol.** Corrigir histórico é do IRPF-calc.
  A segunda tela é a que fica para trás.

## ⟨confirmar⟩

1. **Lucro da própria PJ é trabalho ou capital?** Não tem resposta única — depende
   de a pessoa trabalhar na empresa ou só ser sócia dela. Por isso é pergunta, e
   por isso a resposta é por pagador. O app não escolhe.
2. **Yield distribuído: média dos anos medidos ou o do último ano?** Começar pela
   média dos mesmos anos que `retornoMedio` já aceita.
3. **Aluguel projeta por inflação ou pelo patrimônio?** É renda de capital, mas o
   imóvel não é remarcado a mercado na declaração, então o yield sai errado.
   Provavelmente inflação, com a premissa à vista.
4. **JCP entra como capital sempre?** Hoje cai em `outros`, que é `indefinido`.
   Quando vem da própria PJ, é a mesma pergunta 1.
