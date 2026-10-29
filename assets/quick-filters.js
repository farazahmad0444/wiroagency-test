if (!customElements.get('quick-filters')) {
  /**
   * Compares filter queries regardless of parameter order or page.
   * @param {URLSearchParams} searchParams
   * @returns {string}
   */
  function getFilterKey(searchParams) {
    const params = new URLSearchParams(searchParams);
    params.delete('page');
    params.sort();
    return params.toString();
  }

  customElements.define(
    'quick-filters',
    class QuickFilters extends HTMLElement {
      constructor() {
        super();
        this.onClick = this.onClick.bind(this);
        this.updateNext = this.updateNext.bind(this);
        this.resizeObserver = new ResizeObserver(this.updateNext);
        // Dawn's facets replace the list after every filter change, which can change its width.
        this.mutationObserver = new MutationObserver(this.updateNext);
      }

      connectedCallback() {
        this.scrollerEl = this.querySelector('[data-quick-filters-list]');
        this.nextEl = this.querySelector('[data-quick-filters-next]');

        this.addEventListener('click', this.onClick);
        this.scrollerEl.addEventListener('scroll', this.updateNext, { passive: true });
        this.resizeObserver.observe(this.scrollerEl);
        this.mutationObserver.observe(this.scrollerEl, { childList: true });

        this.scrollToActive();
        this.updateNext();
      }

      disconnectedCallback() {
        this.removeEventListener('click', this.onClick);
        this.scrollerEl.removeEventListener('scroll', this.updateNext);
        this.resizeObserver.disconnect();
        this.mutationObserver.disconnect();
      }

      /**
       * @param {MouseEvent} event
       */
      onClick(event) {
        if (event.target.closest('[data-quick-filters-next]')) return this.scrollNext();

        const linkEl = event.target.closest('a[href]');
        if (linkEl) this.applyFilter(linkEl, event);
      }

      /**
       * Applies the clicked quick filter in place through Dawn's facets, which fetches the filtered
       * grid, updates the URL and history, and re-renders the list with the server's active state.
       * Links opened in a new tab, or pages without facets, navigate as normal.
       * @param {HTMLAnchorElement} linkEl
       * @param {MouseEvent} event
       */
      applyFilter(linkEl, event) {
        const FacetFiltersForm = customElements.get('facet-filters-form');
        const isModified = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (!FacetFiltersForm || isModified) return;

        event.preventDefault();

        const { searchParams } = new URL(linkEl.href);
        if (getFilterKey(searchParams) === getFilterKey(new URLSearchParams(window.location.search))) return;

        this.setPending(linkEl);
        FacetFiltersForm.renderPage(searchParams.toString());
      }

      /**
       * Shows the clicked filter as active straight away and blocks further clicks until Dawn
       * re-renders the list, which replaces this markup and so clears both.
       * @param {HTMLAnchorElement} linkEl
       */
      setPending(linkEl) {
        for (const activeEl of this.querySelectorAll('[aria-current]')) activeEl.removeAttribute('aria-current');
        linkEl.setAttribute('aria-current', 'true');
        linkEl.closest('ul')?.setAttribute('aria-busy', 'true');
      }

      get hasMoreToScroll() {
        const { scrollLeft, scrollWidth, clientWidth } = this.scrollerEl;
        return scrollLeft + clientWidth < scrollWidth - 1;
      }

      /**
       * Shows the arrow only while there are filters further along the row.
       */
      updateNext() {
        this.nextEl.hidden = !this.hasMoreToScroll;
      }

      scrollNext() {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        this.scrollerEl.scrollBy({ left: this.scrollerEl.clientWidth * 0.75, behavior });
      }

      /**
       * On small screens the row scrolls sideways, so bring an active filter that loaded off-screen into view.
       */
      scrollToActive() {
        const activeEl = this.scrollerEl.querySelector('[aria-current="true"]');
        if (!activeEl || this.scrollerEl.scrollWidth <= this.scrollerEl.clientWidth) return;

        this.scrollerEl.scrollLeft = activeEl.offsetLeft - (this.scrollerEl.clientWidth - activeEl.offsetWidth) / 2;
      }
    }
  );
}
