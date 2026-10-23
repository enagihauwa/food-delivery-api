import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { AppException, type ErrorDetail } from '../errors/app-exception.js';

function flatten(errors: ValidationError[], parent = ''): ErrorDetail[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

const base = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};

/** Request bodies: invalid shape is a 422 with the offending fields named. */
export const bodyPipe = new ValidationPipe({
  ...base,
  exceptionFactory: (errors) => AppException.validation('Request body is invalid', flatten(errors)),
});

/** Query strings: bad input is a plain 400 whose message names the parameter. */
export const queryPipe = new ValidationPipe({
  ...base,
  exceptionFactory: (errors) => {
    const details = flatten(errors);
    return AppException.badRequest(details[0]?.message ?? 'Invalid query parameters', details);
  },
});
