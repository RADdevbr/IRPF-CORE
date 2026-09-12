// Todo teste roda com um app declarado.
//
// O núcleo recusa gravar sem `configurarApp()` — de propósito: um prefixo padrão
// silencioso faria dois apps mal configurados dividirem o mesmo estado. O preço
// é que os testes precisam declarar um app, e é isto.
import { configurarApp } from './src/app/config'

configurarApp({ prefixo: 'teste:', docEstado: 'teste:state', nome: 'Núcleo (teste)' })
