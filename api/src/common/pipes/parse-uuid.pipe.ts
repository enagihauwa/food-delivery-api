import { Injectable, PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AppException } from '../errors/app-exception.js';

/** A malformed id can never exist, so it is a 404 (and never reaches Postgres). */
@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  constructor(private readonly resource: string) {}

  transform(value: string): string {
    if (!isUUID(value)) throw AppException.notFound(this.resource);
    return value;
  }
}
