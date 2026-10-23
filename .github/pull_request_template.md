   ## O que mudou
   - Adiciona POST /auth/login com LoginDto e LoginResponseDto
   - Adiciona JwtAuthGuard e decorator @CurrentUser
   - Adiciona GET /auth/me protegida

   ## Como testar
   1. Subir a API e abrir /docs
   2. Fazer login, copiar o accessToken e clicar em Authorize
   3. Chamar GET /auth/me

   ## Checklist
   - [x] Testei o caminho feliz
   - [x] Testei senha errada, e-mail inexistente e token inválido
   - [ ] Atualizei o roadmap do README