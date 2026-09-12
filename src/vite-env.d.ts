// `import.meta.glob` é do Vite, e os testes que varrem as fontes do núcleo o
// usam (é o que mantém a porta única de armazenamento sendo única). Fica fora do
// build: um pacote publicado não deve arrastar os tipos do Vite para quem o
// instala — ver o `exclude` de `tsconfig.build.json`.
/// <reference types="vite/client" />
