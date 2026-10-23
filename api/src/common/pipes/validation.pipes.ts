import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { AppException, type ErrorDetail } from '../errors/app-exception.js';

/** One clear message per problem: a missing value is simply "required", not every rule it fails. */
export function flatten(errors: ValidationError[], parent = ''): ErrorDetail[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const messages = Object.values(e.constraints ?? {});
    const own =
      e.value === undefined || e.value === null
        ? messages.length
          ? [{ field, message: `${e.property} is required` }]
          : []
        : [...new Set(messages)].map((message) => ({ field, message }));
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
