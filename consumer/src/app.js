import {
  CATEGORIES,
  CITIES,
  CUISINES,
  SORT_OPTIONS,
  describeError,
  describeRange,
  formatNaira,
  parseSort,
  titleCase,
} from './lib.js';

const PAGE_SIZE = 12;
const MENU_PAGE_SIZE = 8;

/**
 * Builds an element. Text always goes in via textContent / text nodes, never innerHTML,
 * so data from the API can never inject markup.
 */
function h(doc, tag, props = {}, ...children) {
  const el = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' || typeof child === 'number' ? doc.createTextNode(String(child)) : child);
  }
  return el;
}

/** Mounts the restaurant browser into `root`. `client.get(path, params, { signal })` talks to the API. */
export function mountApp({ root, client, debounceMs = 300 }) {
  const doc = root.ownerDocument;

  const filters = { q: '', cuisine: '', city: '', minRating: '', isOpen: false, sort: 'rating:desc' };
  const page = { cursor: null, index: 0 };
  let requestId = 0;
  let controller = null;
  let debounceTimer = null;
  let lastMeta = null;

  // ---------- static layout ----------
  const field = (label, control) => h(doc, 'label', { class: 'field' }, h(doc, 'span', {}, label), control);
  const select = (name, options, { any } = {}) =>
    h(
      doc,
      'select',
      { name, onChange: onFilterChange },
      any ? h(doc, 'option', { value: '' }, any) : null,
      options.map((o) => (typeof o === 'string' ? h(doc, 'option', { value: o }, titleCase(o)) : h(doc, 'option', { value: o.value }, o.label))),
    );

  const searchInput = h(doc, 'input', { type: 'search', name: 'q', placeholder: 'Search by name…', autocomplete: 'off', onInput: onSearchInput });
  const cuisineSelect = select('cuisine', CUISINES, { any: 'Any cuisine' });
  const citySelect = select('city', CITIES, { any: 'Any city' });
  const ratingSelect = select('minRating', [{ value: '3', label: '3+' }, { value: '4', label: '4+' }, { value: '4.5', label: '4.5+' }], { any: 'Any rating' });
  const sortSelect = select('sort', SORT_OPTIONS);
  const openBox = h(doc, 'input', { type: 'checkbox', name: 'isOpen', onChange: onFilterChange });
  const clearButton = h(doc, 'button', { type: 'button', class: 'link', onClick: clearFilters }, 'Clear filters');

  const status = h(doc, 'p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const results = h(doc, 'div', { class: 'results', 'aria-busy': 'false' });
  const prevButton = h(doc, 'button', { type: 'button', name: 'prev', onClick: () => go('prev') }, '← Previous');
  const nextButton = h(doc, 'button', { type: 'button', name: 'next', onClick: () => go('next') }, 'Next page →');
  const rangeText = h(doc, 'span', { class: 'range' });
  const pager = h(doc, 'nav', { class: 'pager', 'aria-label': 'Pagination' }, prevButton, rangeText, nextButton);

  const menuPanel = h(doc, 'aside', { class: 'menu-panel', hidden: true, 'aria-label': 'Restaurant menu' });

  root.replaceChildren(
    h(
      doc,
      'form',
      { class: 'filters', onSubmit: (e) => e.preventDefault() },
      field('Search', searchInput),
      field('Cuisine', cuisineSelect),
      field('City', citySelect),
      field('Rating', ratingSelect),
      field('Sort by', sortSelect),
      h(doc, 'label', { class: 'field check' }, openBox, h(doc, 'span', {}, 'Open now')),
      clearButton,
    ),
    status,
    results,
    pager,
    menuPanel,
  );

  // ---------- filters ----------
  function readFilters() {
    filters.q = searchInput.value.trim();
    filters.cuisine = cuisineSelect.value;
    filters.city = citySelect.value;
    filters.minRating = ratingSelect.value;
    filters.sort = sortSelect.value;
    filters.isOpen = openBox.checked;
  }

  function onFilterChange() {
    readFilters();
    reset();
  }

  function onSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onFilterChange, debounceMs);
  }

  function clearFilters() {
    searchInput.value = '';
    cuisineSelect.value = '';
    citySelect.value = '';
    ratingSelect.value = '';
    sortSelect.value = 'rating:desc';
    openBox.checked = false;
    onFilterChange();
  }

  /** Any change of filters or sort starts again at page one (cursors are tied to the sort). */
  function reset() {
    page.cursor = null;
    page.index = 0;
    load();
  }

  function go(direction) {
    const cursor = direction === 'next' ? lastMeta?.nextCursor : lastMeta?.prevCursor;
    if (!cursor) return;
    page.cursor = cursor;
    page.index += direction === 'next' ? 1 : -1;
    load();
  }

  // ---------- loading ----------
  async function load() {
    controller?.abort();
    controller = new AbortController();
    const myRequest = ++requestId;

    setBusy(true);
    status.textContent = 'Loading restaurants…';
    showFiltersState();

    const { sort, order } = parseSort(filters.sort);
    const params = {
      limit: PAGE_SIZE,
      cursor: page.cursor,
      sort,
      order,
      q: filters.q,
      cuisine: filters.cuisine,
      city: filters.city,
      minRating: filters.minRating,
      isOpen: filters.isOpen ? 'true' : '',
    };

    try {
      const body = await client.get('/restaurants', params, { signal: controller.signal });
      if (myRequest !== requestId) return; // a newer request superseded this one
      lastMeta = body.meta;
      renderList(body.data, body.meta);
    } catch (error) {
      if (error?.name === 'AbortError' || myRequest !== requestId) return;
      lastMeta = null;
      renderError(error, load);
    } finally {
      if (myRequest === requestId) setBusy(false);
    }
  }

  function setBusy(busy) {
    results.setAttribute('aria-busy', String(busy));
    prevButton.disabled = busy || !lastMeta?.prevCursor;
    nextButton.disabled = busy || !lastMeta?.nextCursor;
  }

  function showFiltersState() {
    const active = filters.q || filters.cuisine || filters.city || filters.minRating || filters.isOpen || filters.sort !== 'rating:desc';
    clearButton.hidden = !active;
  }

  // ---------- rendering ----------
  function renderList(items, meta) {
    pager.hidden = false;
    if (items.length === 0) {
      status.textContent = '';
      rangeText.textContent = 'No results';
      results.replaceChildren(
        h(
          doc,
          'div',
          { class: 'empty', 'data-state': 'empty' },
          h(doc, 'h2', {}, 'No restaurants match your filters'),
          h(doc, 'p', {}, 'Try a different cuisine or city, or clear the filters.'),
          h(doc, 'button', { type: 'button', onClick: clearFilters }, 'Clear filters'),
        ),
      );
      prevButton.disabled = true;
      nextButton.disabled = true;
      return;
    }

    status.textContent = `${meta.total} restaurant${meta.total === 1 ? '' : 's'} found`;
    rangeText.textContent = describeRange({ pageIndex: page.index, pageSize: meta.limit, count: items.length, total: meta.total });
    results.replaceChildren(
      h(
        doc,
        'ul',
        { class: 'cards', 'data-state': 'list' },
        items.map((r) =>
          h(
            doc,
            'li',
            { class: 'card' },
            h(
              doc,
              'button',
              { type: 'button', class: 'card-button', 'data-id': r.id, onClick: () => openMenu(r) },
              h(doc, 'h2', {}, r.name),
              h(doc, 'p', { class: 'meta' }, `${titleCase(r.cuisine)} · ${r.city}`),
              h(
                doc,
                'p',
                { class: 'badges' },
                h(doc, 'span', { class: 'badge rating' }, `★ ${r.rating.toFixed(1)}`),
                h(doc, 'span', { class: `badge ${r.isOpen ? 'open' : 'closed'}` }, r.isOpen ? 'Open' : 'Closed'),
              ),
            ),
          ),
        ),
      ),
    );
    prevButton.disabled = !meta.prevCursor;
    nextButton.disabled = !meta.nextCursor;
  }

  function renderError(error, retry) {
    const info = describeError(error);
    status.textContent = '';
    pager.hidden = true;
    results.replaceChildren(
      h(
        doc,
        'div',
        { class: 'error', role: 'alert', 'data-state': 'error' },
        h(doc, 'h2', {}, info.title),
        h(doc, 'p', {}, info.message),
        info.retryable ? h(doc, 'button', { type: 'button', name: 'retry', onClick: retry }, 'Try again') : null,
      ),
    );
  }

  // ---------- menu panel ----------
  async function openMenu(restaurant) {
    const state = { category: '', cursor: null, index: 0, meta: null, requestId: 0, controller: null };

    const close = () => {
      state.controller?.abort();
      menuPanel.hidden = true;
      menuPanel.replaceChildren();
    };

    const body = h(doc, 'div', { class: 'menu-body' });
    const menuPrev = h(doc, 'button', { type: 'button', name: 'menu-prev', onClick: () => step('prev') }, '← Previous');
    const menuNext = h(doc, 'button', { type: 'button', name: 'menu-next', onClick: () => step('next') }, 'Next →');
    const menuRange = h(doc, 'span', { class: 'range' });
    const categorySelect = h(
      doc,
      'select',
      {
        name: 'category',
        onChange: () => {
          state.category = categorySelect.value;
          state.cursor = null;
          state.index = 0;
          fetchMenu();
        },
      },
      h(doc, 'option', { value: '' }, 'All categories'),
      CATEGORIES.map((c) => h(doc, 'option', { value: c }, titleCase(c))),
    );

    menuPanel.replaceChildren(
      h(
        doc,
        'header',
        {},
        h(doc, 'div', {}, h(doc, 'h2', {}, restaurant.name), h(doc, 'p', { class: 'meta' }, `${titleCase(restaurant.cuisine)} · ${restaurant.city}`)),
        h(doc, 'button', { type: 'button', class: 'close', 'aria-label': 'Close menu', onClick: close }, '×'),
      ),
      h(doc, 'label', { class: 'field' }, h(doc, 'span', {}, 'Category'), categorySelect),
      body,
      h(doc, 'nav', { class: 'pager', 'aria-label': 'Menu pagination' }, menuPrev, menuRange, menuNext),
    );
    menuPanel.hidden = false;
    menuPanel.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });

    function step(direction) {
      const cursor = direction === 'next' ? state.meta?.nextCursor : state.meta?.prevCursor;
      if (!cursor) return;
      state.cursor = cursor;
      state.index += direction === 'next' ? 1 : -1;
      fetchMenu();
    }

    async function fetchMenu() {
      state.controller?.abort();
      state.controller = new AbortController();
      const mine = ++state.requestId;
      body.replaceChildren(h(doc, 'p', { class: 'status' }, 'Loading menu…'));
      menuPrev.disabled = true;
      menuNext.disabled = true;
      try {
        const res = await client.get(
          `/restaurants/${encodeURIComponent(restaurant.id)}/menu`,
          { limit: MENU_PAGE_SIZE, cursor: state.cursor, sort: 'price', order: 'asc', category: state.category },
          { signal: state.controller.signal },
        );
        if (mine !== state.requestId) return;
        state.meta = res.meta;
        if (res.data.length === 0) {
          body.replaceChildren(h(doc, 'p', { class: 'empty', 'data-state': 'menu-empty' }, 'No menu items in this category.'));
          menuRange.textContent = 'No results';
        } else {
          body.replaceChildren(
            h(
              doc,
              'ul',
              { class: 'menu-list', 'data-state': 'menu-list' },
              res.data.map((item) =>
                h(
                  doc,
                  'li',
                  { class: item.available ? '' : 'unavailable' },
                  h(doc, 'div', {}, h(doc, 'strong', {}, item.name), h(doc, 'span', { class: 'meta' }, ` · ${titleCase(item.category)}`), item.description ? h(doc, 'p', { class: 'meta' }, item.description) : null),
                  h(doc, 'div', { class: 'price' }, formatNaira(item.priceKobo), item.available ? null : h(doc, 'span', { class: 'badge closed' }, 'Unavailable')),
                ),
              ),
            ),
          );
          menuRange.textContent = describeRange({ pageIndex: state.index, pageSize: res.meta.limit, count: res.data.length, total: res.meta.total });
        }
        menuPrev.disabled = !res.meta.prevCursor;
        menuNext.disabled = !res.meta.nextCursor;
      } catch (error) {
        if (error?.name === 'AbortError' || mine !== state.requestId) return;
        const info = describeError(error);
        body.replaceChildren(
          h(doc, 'div', { class: 'error', role: 'alert', 'data-state': 'menu-error' }, h(doc, 'p', {}, `${info.title}. ${info.message}`), info.retryable ? h(doc, 'button', { type: 'button', name: 'menu-retry', onClick: fetchMenu }, 'Try again') : null),
        );
      }
    }

    await fetchMenu();
  }

  // ---------- start ----------
  showFiltersState();
  load();

  return {
    /** For tests: resolves when no request is in flight. */
    async idle() {
      while (results.getAttribute('aria-busy') === 'true') await new Promise((r) => setTimeout(r, 0));
    },
  };
}
