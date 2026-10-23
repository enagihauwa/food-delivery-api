/** Pure helpers, no DOM, so they are trivial to test. */

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

/** The API stores money as integer kobo; 350000 kobo is ₦3,500.00. */
export function formatNaira(kobo) {
  return naira.format(kobo / 100);
}

/** Builds "?a=1&b=2" from an object, skipping empty values. Returns "" when nothing is left. */
export function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Turns an ApiError into a short message plus whether retrying makes sense. */
export function describeError(error) {
  if (error.kind === 'network') {
    return { title: 'Cannot reach the server', message: 'Check your connection and try again.', retryable: true };
  }
  if (error.status === 429) {
    const wait = error.retryAfter ? ` Try again in ${error.retryAfter} second${error.retryAfter === 1 ? '' : 's'}.` : ' Try again shortly.';
    return { title: 'Too many requests', message: `You have hit the rate limit.${wait}`, retryable: true };
  }
  if (error.status >= 500) {
    return { title: 'The server had a problem', message: 'This is not your fault. Please try again.', retryable: true };
  }
  return { title: 'Request failed', message: error.message || 'Something went wrong.', retryable: false };
}

/** "Showing 21–40 of 300" */
export function describeRange({ pageIndex, pageSize, count, total }) {
  if (total === 0 || count === 0) return 'No results';
  const start = pageIndex * pageSize + 1;
  return `Showing ${start}–${start + count - 1} of ${total}`;
}

/** Sort dropdown value → API params. */
export const SORT_OPTIONS = [
  { value: 'rating:desc', label: 'Rating (high to low)' },
  { value: 'rating:asc', label: 'Rating (low to high)' },
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'createdAt:desc', label: 'Newest first' },
];

export function parseSort(value) {
  const [sort, order] = value.split(':');
  return { sort, order };
}

export const CUISINES = ['pizza', 'burgers', 'jollof', 'suya', 'sushi', 'chinese', 'bakery', 'vegetarian'];
export const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu', 'Benin City', 'Kaduna'];
export const CATEGORIES = ['starter', 'main', 'side', 'drink', 'dessert'];

export const titleCase = (text) => text.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
