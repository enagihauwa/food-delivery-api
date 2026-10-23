import { BadRequestException, NotFoundException } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { AppException } from '../errors/app-exception.js';
import { ResponseEnvelopeInterceptor } from '../interceptors/response-envelope.interceptor.js';
import { Paginated } from '../pagination/paginated.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function run(exception: unknown) {
  const out: { status?: number; body?: unknown } = {};
  const res = {
    headersSent: false,
    status(s: number) {
      out.status = s;
      return this;
    },
    json(b: unknown) {
      out.body = b;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) };
  new AllExceptionsFilter().catch(exception, host as never);
  return out;
}

describe('AllExceptionsFilter', () => {
  it('maps AppException with details', () => {
    const out = run(AppException.validation('Request body is invalid', [{ field: 'customerId', message: 'required' }]));
    expect(out).toEqual({
      status: 422,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Request body is invalid', details: [{ field: 'customerId', message: 'required' }] } },
    });
  });
  it('omits details when there are none', () => {
    expect(run(AppException.notFound('Restaurant')).body).toEqual({ error: { code: 'NOT_FOUND', message: 'Restaurant not found' } });
  });
  it('maps generic Nest HttpExceptions by status', () => {
    expect(run(new NotFoundException('Cannot GET /x'))).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } });
    expect(run(new BadRequestException('bad'))).toMatchObject({ status: 400, body: { error: { code: 'BAD_REQUEST' } } });
  });
  it.each([
    ['P2025', 404, 'NOT_FOUND'],
    ['P2002', 409, 'CONFLICT'],
    ['P2003', 422, 'VALIDATION_ERROR'],
  ])('maps Prisma %s', (code, status, errCode) => {
    const e = Object.assign(new Error('db'), { name: 'PrismaClientKnownRequestError', code });
    expect(run(e)).toMatchObject({ status, body: { error: { code: errCode } } });
  });
  it('hides internals of unknown errors behind a 500', () => {
    const out = run(new Error('secret stack detail'));
    expect(out).toEqual({ status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong' } } });
  });
  it('returns client errors from middleware with their own 4xx status', () => {
    const e = Object.assign(new Error('too big'), { status: 413, type: 'entity.too.large' });
    expect(run(e)).toMatchObject({ status: 413, body: { error: { message: 'Request body is too large' } } });
  });
});

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor();
  const wrap = (value: unknown) => lastValueFrom(interceptor.intercept({} as never, { handle: () => of(value) }));

  it('wraps single values in { data }', async () => {
    expect(await wrap({ id: '1' })).toEqual({ data: { id: '1' } });
  });
  it('wraps Paginated results in { data, meta }', async () => {
    const meta = { total: 1, limit: 20, hasMore: false, nextCursor: null, prevCursor: null, offset: null };
    expect(await wrap(new Paginated([{ id: '1' }], meta))).toEqual({ data: [{ id: '1' }], meta });
  });
  it('leaves undefined (204) untouched', async () => {
    expect(await wrap(undefined)).toBeUndefined();
  });
});
