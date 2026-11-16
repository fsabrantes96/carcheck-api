// Setup dos testes unitários (vitest.config.ts). O primeiro compile() de um
// Test.createTestingModule em cada arquivo chama preloadLazyPackages() do
// @nestjs/testing, que importa o @nestjs/platform-express (uns 144 módulos
// CommonJS: express, multer, body-parser...) dentro do corpo do teste, onde
// vale o testTimeout. Com a suíte em paralelo e o cache de disco frio, isso
// estourava os 5 s. Importar aqui tira esse carregamento do período
// cronometrado: o setup roda antes dos testes, e o compile() o encontra em cache.
import '@nestjs/platform-express';
