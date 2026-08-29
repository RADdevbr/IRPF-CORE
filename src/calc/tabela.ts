// Aritmética das tabelas: INSS, IRRF progressivo e a redução do Art. 3º-A.
//
// Mora fora de `irpfm.ts` por uma razão de dependência, não de organização: a
// declaração de ajuste anual (`declaracao.ts`) precisa das mesmas três contas, e
// ela é usada de dentro do cálculo do IRPFM. Com tudo em `irpfm.ts` os dois
// módulos se importariam em círculo; a alternativa — reescrever a tabela lá —
// é a que este projeto evita em todo lugar, porque duas versões da mesma conta
// divergem em silêncio.
//
// `irpfm.ts` reexporta as três, então quem já importava de lá continua igual.

import { parametros, type ParametrosAno } from './params'

const PADRAO = parametros()

// INSS acumulado por faixas até a base b.
export function calcINSS(b: number, par: ParametrosAno = PADRAO): number {
  let t = 0
  let a = 0
  for (const f of par.inss.faixas) {
    if (b <= a) break
    t += (Math.min(f.ate, b) - a) * f.aliq
    a = f.ate
    if (b <= f.ate) break
  }
  return t
}

// IRRF bruto (antes de reduções) e alíquota nominal para a base b.
export function calcIRRF(b: number, par: ParametrosAno = PADRAO): { bruto: number; aliq: number } {
  for (const f of par.irrf.faixas) {
    if (b <= f.ate) return { bruto: Math.max(0, b * f.aliq - f.ded), aliq: f.aliq }
  }
  return { bruto: 0, aliq: 0 }
}

/**
 * Redução do IR mensal — Art. 3º-A da Lei 9.250/1995 (Lei 15.270/2025).
 *
 * até 5.000 → imposto zero; 5.000,01–7.350 → 978,62 − 0,133145 × rendimento.
 *
 * A variável é o RENDIMENTO TRIBUTÁVEL DO MÊS, não a base de cálculo. A
 * diferença não é sutil: a base já saiu descontada de INSS e dependentes, e é
 * sempre menor que o rendimento — usá-la fazia o benefício vazar para cima e
 * alcançar salário bruto de até ~R$ 8.290, quando a lei para em R$ 7.350. Quem
 * ganha 7.500 recebia 93,40/mês de redução que a lei não dá.
 */
export function aplicaReducao(rendimento: number, br: number, par: ParametrosAno = PADRAO): number {
  const r = par.reducao
  if (rendimento <= r.isencaoAte) return 0
  if (rendimento <= r.reducaoAte) {
    return Math.max(0, br - Math.max(0, r.constante - r.coeficiente * rendimento))
  }
  return br
}
