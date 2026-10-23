/** Escapes LIKE wildcards so user text such as "%" or "_" is matched literally by `contains`. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => '\\' + c);
