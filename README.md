# @raddevbr/irpf-core

O que os três apps da família precisam e nenhum deles é dono.

| App | Repositório | A pergunta que ele responde |
|---|---|---|
| Estimativa do IRPFM | [IRPFM-2027](https://github.com/RADdevbr/IRPFM-2027) | Com o que já recebi, cruzo os R$ 600 mil? Quanto vou pagar? Vale abrir holding? |
| IRPF-calc | [IRPF-calc](https://github.com/RADdevbr/IRPF-calc) | Faltou declarar alguma coisa nos anos passados? E o que já dá para preencher no ano que vem? |
| networthcontrol | [networthcontrol](https://github.com/RADdevbr/networthcontrol) | Quanto o patrimônio cresceu, por quê, e onde ele chega? |

Antes disto era um app só, e o problema não era o tamanho: era que três trabalhos
diferentes dividiam uma tela, um estado e um tipo. Quem estava num deles rolava
por cima dos outros dois, e qualquer app que quisesse guardar duas coisas herdava
as declarações das outras.

O que sobrou junto é o que **não** dá para separar sem duplicar: se o leitor do
`.DEC` existisse em dois repositórios, uma correção de leiaute chegaria a um e não
ao outro — e o modo de falha de uma correção que chega pela metade é um número
errado com cara de certo.

## O que tem aqui

| Subpath | O que é |
|---|---|
| `@raddevbr/irpf-core` | `configurarApp()` — quem é o app, e sob que prefixo ele grava |
| `/ui` | Cores, formatação de número, `NumInput`, `ComDica`, `ErroFatal`, e os invariantes de forma dos gráficos |
| `/app` | A porta única de armazenamento (é ela que faz o modo visita valer) e a persistência genérica |
| `/cofre` | Argon2id + AES-GCM, passkeys, sync, e as telas de destravar |
| `/cofre/conta` | Tudo o que fala com o Supabase — **importe sob demanda** (ver abaixo) |
| `/dec` | Leitor posicional do `.DEC` e o anonimizador |
| `/xlsx` | Leitor de `.xlsx` sem dependência nenhuma, e o construtor que os testes usam |
| `/historico` | O modelo plurianual: N declarações, patrimônio por classe, a identidade de cada bem entre anos, e o que só a pessoa sabe |
| `/fiscal` | Parâmetros por ano com vigência e fonte, INSS/IRRF, ajuste anual, deduções legais, fontes de renda, e a grade de dividendos com o Art. 6º-A |
| `/bolsa` | Apuração de renda variável: preço médio, isenção mensal, compensação de prejuízo |
| `/patrimonio` | Quanto o capital rendeu, e as referências (CDI, Selic, IPCA) para comparar |
| `/pwa` | Registro do service worker |
| `/ponte` | O contrato entre os apps: o pacote de histórico e o de base do ano seguinte |

A regra de fronteira, quando surgir a dúvida: **o núcleo guarda o modelo; a
pergunta é do app que a faz.** «Quanto o patrimônio cresceu» é pergunta, e mora no
networthcontrol. «O que é uma declaração de IRPF» é modelo, e mora aqui.

## Instalando

```sh
npm install github:RADdevbr/IRPF-CORE#v0.1.0
```

Por ora a dependência é resolvida por **tag do git**, não pelo registro do npm.
O repositório é público e o `prepare` compila no `npm install`, então funciona no
CI e na Vercel sem nenhum token — que é a razão de ser assim enquanto o pacote não
está publicado. Fixe a tag: `#main` faria um build reproduzir o de ontem por
acidente.

Quando for para o registro (`.github/workflows/publicar.yml` já faz isso ao criar
uma release, bastando o segredo `NPM_TOKEN`), a linha vira
`npm install @raddevbr/irpf-core@^0.1.0` e nada mais muda: o nome do pacote e os
subpaths são os mesmos.

## Usando

Uma chamada, antes de renderizar:

```ts
// main.tsx
import { configurarApp } from '@raddevbr/irpf-core'

configurarApp({
  nome: 'IRPFM 2027',
  prefixo: 'irpfm2027:',        // família de chaves NESTE aparelho
  docEstado: 'state',           // nome do documento NA CONTA
  rpId: import.meta.env.VITE_RP_ID,
  supabase: import.meta.env.VITE_SUPABASE_URL
    ? { url: import.meta.env.VITE_SUPABASE_URL, chave: import.meta.env.VITE_SUPABASE_ANON_KEY }
    : undefined,
})
```

Sem isso, tudo que grava lança erro em vez de escolher um padrão. É de propósito:
um padrão silencioso faria dois apps mal configurados dividirem o mesmo estado, e
esse bug não aparece — só sobrescreve.

As variáveis de ambiente são lidas **pelo app**, não aqui dentro. O Vite substitui
`import.meta.env` no build de quem escreve a leitura; uma leitura feita dentro de
um pacote já compilado chega vazia, e o sintoma seria a tela de conta
simplesmente não aparecer.

### O estado é de cada app

`criarPersistencia` não conhece formato nenhum: o app declara o seu e a função que
valida o que vem de fora.

```ts
export const P = criarPersistencia<MeuEstado>({ versao: 3, migrar })
P.saveState(estado)
```

### A conta entra sob demanda

`/cofre/conta` importa o SDK do Supabase (~200 kB). Ele está fora de `/cofre` de
propósito — importe com `import()` dinâmico, senão o code-splitting some e quem
nunca abre a tela de conta paga por ela:

```ts
const ContaSync = lazy(() => import('@raddevbr/irpf-core/cofre/conta').then((m) => ({ default: m.ContaSync })))
```

## Como o dado vai de um app para o outro

Quem lê os arquivos é o IRPF-calc — o `.DEC` de cada ano, os extratos da B3. Quem
precisa do resultado são os outros dois. Enquanto era um app só, isso era o mesmo
objeto em memória; agora é um **pacote**, um JSON explícito que sai de um app e
entra no outro (`/ponte`).

Ele é contrato, não estado: leva só o que o outro lado precisa, e leva junto o
trabalho manual — a classe corrigida à mão, o aporte informado, a ligação entre
anos do bem que o banco renomeou. Sem esses campos, o outro app pediria o trabalho
de novo. Com o estado inteiro, os apps voltariam a depender do formato um do outro,
que é o acoplamento que a separação desfez.

## Três apps numa conta só

O desenho que sustenta isso, e a armadilha que ele evita:

- **Os embrulhos da chave (`vault_wraps`) são um conjunto por CONTA.** Um login,
  um desbloqueio, e a passkey cadastrada num app serve nos três.
- **Os documentos cifrados (`vaults`) são um por APP** — `doc_id` distinto. O
  estado de um não alcança o do outro.
- **As chaves no navegador são uma família por app** — o `prefixo`. «Apagar deste
  aparelho» num app não leva os outros.

A armadilha: se cada app sorteasse a própria chave, os embrulhos dela subiriam
para a mesma conta, e o outro app destravaria com um método legítimo que devolve a
chave errada — o embrulho abre, o conteúdo não decifra. A pessoa veria «sua chave
está certa, mas o conteúdo não corresponde» sem ter feito nada.

Duas coisas fecham isso: cada embrulho declara a impressão da chave que abre
(`dekId`, um SHA-256 truncado — não é segredo, e a DEK são 32 bytes sorteados), e
`unirWraps` recusa juntar conjuntos comprovadamente diferentes em vez de gravar a
mistura. O segundo app da conta não cria chave: ele **adota** a que já existe
(`adotarChaveDaConta`), depois de a pessoa destravar com um método dela.

O `supabase/schema.sql` é idempotente e traz a coluna nova (`vault_wraps.dek_id`);
rodá-lo de novo num projeto que já existe é seguro.

## Desenvolvendo

```sh
npm install
npm test          # 445 testes
npm run build     # tsc → dist/, com .d.ts
```

Node 22.22 ou mais novo — é o que o jsdom dos testes de tela exige.

Os testes rodam em `node` por padrão; quem precisa de DOM pede no próprio arquivo
com `// @vitest-environment jsdom`. O leitor de `.xlsx` usa `Blob.stream()`, que o
`Blob` do jsdom não tem.

## Licença

MIT — veja `LICENSE`.
