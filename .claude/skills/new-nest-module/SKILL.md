---
name: new-nest-module
description: Use ao criar um módulo de feature novo em src/<feature>/ (ex.: appointments, reports). Estrutura de arquivos, DTOs (inclusive aninhados), service, controller com Swagger e guards, registro no AppModule e checklist das convenções do projeto (ESM com .js, Response DTOs, paginação, ownership).
---

# Novo módulo NestJS

Antes de começar, leia o `CLAUDE.md` (padrão de módulo, ESM, auth, ownership, Testing) e o `docs/audit.md` (riscos que o módulo novo pode tocar). O módulo de referência é o indicado no `CLAUDE.md`.

## Estrutura

```
src/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts
├── <feature>.service.ts
├── <feature>.service.spec.ts
└── dto/
    ├── create-<entidade>.dto.ts
    ├── update-<entidade>.dto.ts
    ├── list-<entidades>-query.dto.ts
    ├── <entidade>-response.dto.ts
    └── paginated-<entidades>-response.dto.ts
```

Crie os arquivos à mão. O `nest g resource` gera imports sem `.js` e specs no estilo Jest, que não seguem este projeto.

## Passos

1. **Schema** novo ou alterado? Siga a skill `prisma-migration-workflow` antes de escrever o service.
2. **Module**: `imports: [AuthModule]` se usar guards (o `PrismaModule` é global). Registre o módulo no `imports` do `src/app.module.ts`.
3. **DTOs de entrada**: `class-validator` + `@ApiProperty` em todo campo; strings com tamanho mínimo e máximo; números de query com `@Type(() => Number)`.
4. **DTOs de resposta**: classe com `@ApiProperty` e `static from(entity)`. Nunca exponha a entidade do Prisma nem campos sensíveis.
5. **Service**: injeta `PrismaService`; retorna sempre Response DTOs; ownership pela skill `ownership-check`; listagens paginadas `{ items, total, page, limit }` com `limit` máximo de 50 e `$transaction([findMany, count])`; fluxo com estados pela skill `state-machine-pattern`.
6. **Controller**: `@ApiTags`; `@UseGuards(JwtAuthGuard)` ou `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`, nessa ordem; `@ApiBearerAuth()` nas rotas protegidas; tipo de retorno declarado; `@ApiOkResponse`/`@ApiCreatedResponse` e as respostas de erro; `ParseUUIDPipe` nos `:id`.
7. **Testes** do service: agente `test-engineer`.

## DTO aninhado

Um objeto dentro do DTO só é validado com **os dois** decorators. Sem o `@Type`, o `class-validator` recebe um objeto comum e não valida nada dentro dele.

```ts
@ApiProperty({ type: VehicleDto })
@ValidateNested()
@Type(() => VehicleDto)
vehicle: VehicleDto;
```

Para arrays: `@ValidateNested({ each: true })` + `@Type(() => ItemDto)`.

## Atenção: `PartialType` não é profundo

`PartialType(CreateDto)` (de `@nestjs/swagger`) torna opcionais só os campos do **primeiro nível**. Um campo aninhado fica opcional, mas, se for enviado, precisa vir **completo**, porque continua validado pelo DTO original. Se o `PATCH` deve aceitar um objeto aninhado parcial, crie um DTO de update para ele e sobrescreva o campo:

```ts
export class UpdateVehicleDto extends PartialType(VehicleDto) {}

export class UpdateListingDto extends PartialType(CreateListingDto) {
  @ApiPropertyOptional({ type: UpdateVehicleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateVehicleDto)
  vehicle?: UpdateVehicleDto;
}
```

Na escrita, `relacao: { update: ... }` falha se a relação ainda não existe; avalie `upsert`.

## Checklist final

- [ ] Imports relativos terminam em `.js`; imports só de tipo usam `import type`.
- [ ] Nenhuma entidade do Prisma sai do controller.
- [ ] DTOs aninhados com `@ValidateNested` + `@Type`; update aninhado decidido (completo ou parcial).
- [ ] Ownership classificado (público ou privado) e testado.
- [ ] Mensagens de erro e comentários em pt-BR.
- [ ] Módulo registrado no `AppModule`.
- [ ] `npm run lint`, `npm run build` e `npm test` rodados.
