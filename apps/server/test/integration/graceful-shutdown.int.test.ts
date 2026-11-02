import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Public } from '../../src/auth/decorators.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase } from '../helpers/test-database.js';

/** A request that is still working when the server is asked to stop. */
@Controller('qa-slow')
class SlowController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public() // Test only: a slow request to stop the server under.
  async slow(): Promise<{ ok: boolean }> {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}

describe('[NFR-A03] [NFR-A04] stopping the server with a request in flight (QA-041)', () => {
  it('finishes the request before the database closes, instead of failing it', async () => {
    const database = await createTestDatabase();
    const app = await createTestApp({ databaseUrl: database.url, controllers: [SlowController] });
    const answer = request(httpServer(app))
      .get('/api/v1/qa-slow')
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.close();
    const response = await answer;
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    await database.drop();
  });
});
