// Setup dos testes unitários (vitest.config.ts). O primeiro compile() de um
// Test.createTestingModule em cada arquivo chama preloadLazyPackages() do
// @nestjs/testing, que importa o @nestjs/platform-express (uns 144 módulos
// CommonJS: express, multer, body-parser...) dentro do corpo do teste, onde
// vale o testTimeout. Com a suíte em paralelo e o cache de disco frio, isso
// estourava os 5 s. Importar aqui tira esse carregamento do período
// cronometrado: o setup roda antes dos testes, e o compile() o encontra em cache.
//
// Cuidados:
// - Módulo importado aqui não pode ser alvo de vi.mock nos unitários: ele já
//   está em cache quando o spec roda, e o mock seria ignorado em silêncio. Se
//   um spec precisar mockar o @nestjs/platform-express, tire-o deste arquivo.
// - O ganho depende de o pacote ser externalizado (carregado pelo Node, o
//   mesmo cache do import() do @nestjs/testing). Não o inclua em
//   server.deps.inline: o preload viraria custo sem ganho.
import '@nestjs/platform-express';
