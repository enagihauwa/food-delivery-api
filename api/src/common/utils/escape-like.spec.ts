import { escapeLike } from './escape-like.js';

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
  it('leaves ordinary text alone', () => {
    expect(escapeLike("Mama's Kitchen")).toBe("Mama's Kitchen");
  });
});
