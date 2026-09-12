// A alíquota mínima do IRPFM, e o imposto bruto que sai dela.
//
// Saiu de `calc/irpfm.ts` — o núcleo de cálculo, que continua no app de
// estimativa e que reexporta estas duas para quem já as importava de lá.
//
// Vieram para cá por causa de UM consumidor de fora: o painel de patrimônio
// mostra, para cada ano importado, quanto o imposto mínimo teria custado sobre a
// renda daquele ano. É a pergunta «o que a Lei 15.270 faria com o meu passado»,
// e ela não é do app de estimativa — mas a resposta tem de ser o MESMO número.
//
// Reescrever a rampa progressiva no outro app era a alternativa, e é a que este
// projeto evita em todo lugar: duas versões da mesma conta divergem em silêncio,
// e aqui divergir significa dois apps mostrando impostos diferentes para o mesmo
// ano. Os parâmetros (base isenta, base de alíquota cheia, alíquota máxima) já
// moram em `params.ts`, então a conta que os lê mora ao lado.

import { parametros, type ParametrosAno } from './params'

const PADRAO = parametros()

/**
 * Alíquota mínima efetiva para uma base.
 *
 * Rampa linear: zero até a base isenta, cresce proporcionalmente até a alíquota
 * máxima na base de alíquota cheia, e ali estaciona.
 */
export function aliqMinima(base: number, par: ParametrosAno = PADRAO): number {
  const { baseIsenta, baseAliqCheia, aliqMax } = par.irpfm
  if (base > baseAliqCheia) return aliqMax
  if (base > baseIsenta) return ((base - baseIsenta) / (baseAliqCheia - baseIsenta)) * aliqMax
  return 0
}

/** IRPFM bruto (antes de deduções) a partir de uma base já somada. */
export function irpfmBrutoFromBase(base: number, par: ParametrosAno = PADRAO): number {
  return base * aliqMinima(base, par)
}
