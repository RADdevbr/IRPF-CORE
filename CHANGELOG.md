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
