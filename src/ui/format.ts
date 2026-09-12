export const fmt = (v: number): string =>
  v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  })

export const fmtPct = (v: number): string =>
  (v * 100).toFixed(2).replace('.', ',') + '%'
