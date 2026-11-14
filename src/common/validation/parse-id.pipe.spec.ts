import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { parseIdPipe } from './parse-id.pipe.js';

const metadata: ArgumentMetadata = { type: 'param', data: 'id' };

describe('parseIdPipe', () => {
  it('devolve o id quando ele é um uuid', async () => {
    const id = '0b7c6f2e-3f4a-4d5b-9c8d-1e2f3a4b5c6d';

    await expect(parseIdPipe.transform(id, metadata)).resolves.toBe(id);
  });

  it.each(['nao-e-uuid', '123', ''])(
    'lança 400 "Identificador inválido" para %j (risco 70)',
    async (value) => {
      await expect(parseIdPipe.transform(value, metadata)).rejects.toThrow(
        new BadRequestException('Identificador inválido'),
      );
    },
  );

  it('não usa a mensagem padrão do Nest, em inglês', async () => {
    const error = await parseIdPipe.transform('abc', metadata).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((error as BadRequestException).getResponse())).not.toMatch(
      /Validation failed|uuid is expected/,
    );
  });
});
