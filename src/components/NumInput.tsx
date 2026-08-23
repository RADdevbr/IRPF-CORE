import { C } from '../theme'

// Campo monetário em BRL com máscara por centavos (dígitos → valor/100).
export function NumInput({
  value,
  onChange,
  placeholder = '0,00',
  readOnly = false,
  height = 38,
  compact = false,
  rotulo,
}: {
  value: number
  onChange: (v: number) => void
  placeholder?: string
  readOnly?: boolean
  height?: number
  compact?: boolean
  /** Nome do campo para leitor de tela — o R$ ao lado não é rótulo de nada. */
  rotulo?: string
}) {
  const display =
    value > 0
      ? value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : ''
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: readOnly ? C.bg0 : C.bg3,
        border: `0.5px solid ${C.border}`,
        borderRadius: 6,
        padding: compact ? '0 6px' : '0 12px',
        height,
      }}
    >
      {!compact && <span style={{ fontSize: 13, color: C.textMut, marginRight: 6 }}>R$</span>}
      <input
        type="text"
        inputMode="numeric"
        aria-label={rotulo}
        placeholder={placeholder}
        value={display}
        readOnly={readOnly}
        onChange={(e) => {
          if (readOnly) return
          const d = e.target.value.replace(/\D/g, '')
          onChange(d ? parseFloat(d) / 100 : 0)
        }}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontSize: compact ? 13 : 15,
          color: readOnly ? C.textMut : C.text,
          fontFamily: 'monospace',
          textAlign: compact ? 'right' : 'left',
          cursor: readOnly ? 'default' : 'text',
        }}
      />
    </div>
  )
}
