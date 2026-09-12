/**
 * Registro do service worker e o aviso de versão nova.
 *
 * O ponto delicado aqui é o que NÃO fazer: trocar a versão sozinho. O que está
 * em cache é conta de imposto, e uma pessoa decidindo com o número da versão
 * anterior enquanto a página se atualiza por baixo é pior do que ficar offline.
 * Então a versão nova baixa, espera, e a tela avisa — quem recarrega é quem
 * está usando.
 */

/**
 * @param aoAtualizar chamado quando há versão nova esperando; recebe a função
 *   que a aplica (troca o worker e recarrega a página).
 * @param registrar `false` desliga o registro. Em dev o SW só atrapalharia:
 *   serviria o bundle velho enquanto se edita. A checagem era
 *   `import.meta.env.DEV` aqui dentro; num pacote compilado essa leitura não vale
 *   — quem sabe se está em dev é o app, então quem responde é ele.
 */
export function registrarSw(aoAtualizar: (aplicar: () => void) => void, registrar = true): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (!registrar) return

  let pedimosTroca = false

  navigator.serviceWorker
    .register(new URL('sw.js', document.baseURI).href)
    .then((reg) => {
      const avisar = (esperando: ServiceWorker | null) => {
        // `controller` nulo = primeira visita: o worker que acabou de instalar
        // não é atualização de nada, e avisar seria mentira.
        if (!esperando || !navigator.serviceWorker.controller) return
        aoAtualizar(() => {
          pedimosTroca = true
          esperando.postMessage('assumir')
        })
      }

      avisar(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const novo = reg.installing
        novo?.addEventListener('statechange', () => {
          if (novo.state === 'installed') avisar(reg.waiting ?? novo)
        })
      })
    })
    .catch(() => {
      /* sem SW o app funciona igual, só não abre offline */
    })

  let recarregando = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Só recarrega se FOMOS NÓS que pedimos a troca. Na primeira visita o worker
    // recém-instalado assume o controle sozinho (`clients.claim`), e recarregar
    // ali seria um refresh gratuito — no meio de alguém digitando um valor.
    if (!pedimosTroca || recarregando) return
    recarregando = true
    location.reload()
  })
}
