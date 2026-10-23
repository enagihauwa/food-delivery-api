import { Transform } from 'class-transformer';

/** Query strings arrive as text; turn "true"/"false" into booleans and leave anything else for IsBoolean to reject. */
export const ToBoolean = () =>
  Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));
