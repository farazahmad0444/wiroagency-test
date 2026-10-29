if (!customElements.get('cart-gift-wrapping')) {
  /**
   * The cart elements on the page: the drawer, the cart page, or both.
   * @returns {HTMLElement[]}
   */
  const getCartItemsEls = () => [...document.querySelectorAll('cart-items, cart-drawer-items')];

  /**
   * Repaints every cart on the page from a cart API response that requested their sections,
   * reusing each cart element's own section config so they render exactly as Dawn does.
   * @param {HTMLElement[]} cartItemsEls
   * @param {{ sections?: Record<string, string>, item_count?: number }} state
   */
  function renderCartSections(cartItemsEls, state) {
    for (const cartItemsEl of cartItemsEls) {
      for (const section of cartItemsEl.getSectionsToRender()) {
        const sectionHtml = state.sections?.[section.section];
        const sectionEl = document.getElementById(section.id);
        if (!sectionHtml || !sectionEl) continue;

        const targetEl = sectionEl.querySelector(section.selector) || sectionEl;
        targetEl.innerHTML = cartItemsEl.getSectionInnerHTML(sectionHtml, section.selector);
      }
    }

    if (typeof state.item_count !== 'number') return;

    const isEmpty = state.item_count === 0;
    const emptyStateEls = [document.querySelector('cart-drawer'), document.getElementById('main-cart-footer'), ...cartItemsEls];
    for (const el of emptyStateEls) el?.classList.toggle('is-empty', isEmpty);
  }

  /**
   * Sends a cart API request and, unless told otherwise, repaints the cart from its response.
   * @param {string} url A cart API route, e.g. `routes.cart_change_url`
   * @param {object} body The request payload
   * @param {{ shouldRender?: boolean }} [options] Skip rendering for intermediate steps
   * @returns {Promise<object>} The parsed response
   */
  async function updateCart(url, body, { shouldRender = true } = {}) {
    const cartItemsEls = getCartItemsEls();
    const sections = shouldRender
      ? [...new Set(cartItemsEls.flatMap((el) => el.getSectionsToRender().map(({ section }) => section)))]
      : [];

    const response = await fetch(url, {
      ...fetchConfig(),
      body: JSON.stringify({ ...body, sections, sections_url: window.location.pathname }),
    });
    const state = await response.json();
    if (!response.ok || state.status) throw new Error(state.description || state.message || window.cartStrings.error);

    if (shouldRender) renderCartSections(cartItemsEls, state);
    return state;
  }

  /**
   * Liquid's `json` filter renders line item properties as `[key, value]` pairs, not an object.
   * @param {string} [json] A line item's properties, as rendered by Liquid
   * @returns {Record<string, string>}
   */
  const parseProperties = (json) => Object.fromEntries(JSON.parse(json || '[]') ?? []);

  /**
   * Finds gift wrap lines whose quantity no longer matches the product they wrap,
   * including wraps whose product has been removed (which should go to 0).
   * @param {{ items: object[] }} cart
   * @returns {Record<string, number>} Line key to quantity
   */
  function getGiftWrapUpdates(cart) {
    const parentQuantities = new Map();
    for (const item of cart.items) {
      const giftWrapId = item.properties?._gift_wrap_id;
      if (giftWrapId) parentQuantities.set(giftWrapId, item.quantity);
    }

    const updates = {};
    for (const item of cart.items) {
      const giftWrapFor = item.properties?._gift_wrap_for;
      if (!giftWrapFor) continue;

      const quantity = parentQuantities.get(giftWrapFor) ?? 0;
      if (item.quantity !== quantity) updates[item.key] = quantity;
    }
    return updates;
  }

  // Dawn's cart publishes the full cart after every quantity change or removal, so wraps are
  // reconciled here, whichever control the customer used.
  subscribe(PUB_SUB_EVENTS.cartUpdate, async ({ source, cartData }) => {
    if (source !== 'cart-items' || !cartData?.items) return;

    const updates = getGiftWrapUpdates(cartData);
    if (!Object.keys(updates).length) return;

    try {
      await updateCart(routes.cart_update_url, { updates });
    } catch (error) {
      console.error(error);
    }
  });

  customElements.define(
    'cart-gift-wrapping',
    class CartGiftWrapping extends HTMLElement {
      constructor() {
        super();
        this.onToggle = this.onToggle.bind(this);
        this.onClick = this.onClick.bind(this);
        this.onKeydown = this.onKeydown.bind(this);
        this.stopChange = (event) => event.stopPropagation();
      }

      connectedCallback() {
        this.toggleEl = this.querySelector('[data-gift-wrap-toggle]');
        this.editEl = this.querySelector('[data-gift-wrap-edit]');
        this.formEl = this.querySelector('[data-gift-wrap-form]');
        this.summaryEl = this.querySelector('[data-gift-wrap-summary]');
        this.loaderEl = this.querySelector('[data-gift-wrap-loader]');
        this.errorEl = this.querySelector('[data-gift-wrap-error]');

        this.toggleEl.addEventListener('change', this.onToggle);
        this.addEventListener('click', this.onClick);
        this.addEventListener('keydown', this.onKeydown);
        // The cart treats any `change` inside it as a quantity update, so keep ours to ourselves.
        this.addEventListener('change', this.stopChange);
      }

      disconnectedCallback() {
        this.toggleEl.removeEventListener('change', this.onToggle);
        this.removeEventListener('click', this.onClick);
        this.removeEventListener('keydown', this.onKeydown);
        this.removeEventListener('change', this.stopChange);
      }

      // The panel only renders for wrapped lines, so unticking is the one toggle action.
      onToggle() {
        if (this.toggleEl.checked) return;
        this.run(() => this.removeGiftWrap());
      }

      /**
       * @param {MouseEvent} event
       */
      onClick(event) {
        if (event.target.closest('[data-gift-wrap-edit]')) return this.setFormOpen(this.formEl.hidden);
        if (event.target.closest('[data-gift-wrap-cancel]')) return this.cancelEdit();
        if (event.target.closest('[data-gift-wrap-save]')) this.saveDetails();
      }

      /**
       * Enter in a text field would submit the surrounding cart form (and go to checkout), so it saves instead.
       * @param {KeyboardEvent} event
       */
      onKeydown(event) {
        if (event.key !== 'Enter' || event.target.tagName !== 'INPUT' || event.target.type !== 'text') return;

        event.preventDefault();
        this.saveDetails();
      }

      /**
       * @param {boolean} isOpen
       */
      setFormOpen(isOpen) {
        this.formEl.hidden = !isOpen;
        this.editEl.setAttribute('aria-expanded', isOpen);
        if (isOpen) this.formEl.querySelector('input, textarea')?.focus();
      }

      get fieldEls() {
        return [...this.formEl.querySelectorAll('[data-gift-wrap-property]')];
      }

      get isBusy() {
        return this.hasAttribute('aria-busy');
      }

      /**
       * @param {boolean} isBusy
       */
      setBusy(isBusy) {
        this.toggleAttribute('aria-busy', isBusy);
        this.loaderEl.hidden = !isBusy;
      }

      /**
       * @param {string | null} message The error to show, or null to clear it
       */
      setError(message) {
        this.errorEl.textContent = message ?? '';
        this.errorEl.hidden = !message;
      }

      /**
       * Runs a cart update that re-renders the cart, then restores focus once it has.
       * @param {() => Promise<void>} update
       */
      async run(update) {
        const scopeEl = this.closest('cart-drawer') || document.getElementById('main-cart-items');
        this.setBusy(true);
        this.setError(null);

        try {
          await update();
          this.restoreFocus(scopeEl);
        } catch (error) {
          this.setBusy(false);
          this.toggleEl.checked = true;
          this.setError(error.message);
        }
      }

      removeGiftWrap() {
        return updateCart(routes.cart_change_url, { id: this.dataset.wrapKey, quantity: 0 });
      }

      /**
       * Discards unsaved edits and closes the form.
       */
      cancelEdit() {
        this.fillFields(parseProperties(this.dataset.wrapProperties));
        this.setFormOpen(false);
        this.editEl.focus();
      }

      /**
       * Saves the To, From and message fields onto the gift wrap line, dropping any left blank.
       * Editing these doesn't change the price, so the panel updates straight away and the cart
       * isn't re-rendered; if the save fails, the previous details are restored.
       */
      async saveDetails() {
        if (this.isBusy) return;

        const savedProperties = parseProperties(this.dataset.wrapProperties);
        const properties = { ...savedProperties };
        for (const fieldEl of this.fieldEls) {
          const value = fieldEl.value.trim();
          if (value) properties[fieldEl.dataset.giftWrapProperty] = value;
          else delete properties[fieldEl.dataset.giftWrapProperty];
        }

        this.setFormOpen(false);
        this.editEl.focus();
        this.renderSummary(properties);
        this.setError(null);
        this.setBusy(true);

        try {
          const cart = await updateCart(
            routes.cart_change_url,
            { id: this.dataset.wrapKey, quantity: Number(this.dataset.wrapQuantity), properties },
            { shouldRender: false }
          );
          this.storeWrapLine(cart);
        } catch (error) {
          this.renderSummary(savedProperties);
          this.setFormOpen(true);
          this.setError(error.message);
        } finally {
          this.setBusy(false);
        }
      }

      /**
       * @param {Record<string, string>} properties
       */
      fillFields(properties) {
        for (const fieldEl of this.fieldEls) fieldEl.value = properties[fieldEl.dataset.giftWrapProperty] ?? '';
      }

      /**
       * Renders the summary the same way the Liquid does: `To: Lily / From: Jack / “message”`.
       * @param {Record<string, string>} properties
       */
      renderSummary(properties) {
        const parts = [];
        for (const fieldEl of this.fieldEls) {
          const property = fieldEl.dataset.giftWrapProperty;
          const value = properties[property];
          if (!value) continue;

          parts.push(fieldEl.tagName === 'TEXTAREA' ? `“${value}”` : `${property}: ${value}`);
        }

        this.summaryEl.textContent = parts.join(' / ');
        this.summaryEl.hidden = !parts.length;
      }

      /**
       * Changing a line's properties changes its key, so keep the new key and properties for the next edit.
       * @param {{ items: object[] }} cart The cart returned by the save
       */
      storeWrapLine(cart) {
        const wrapItem = cart.items.find((item) => item.properties?._gift_wrap_for === this.dataset.giftWrapId);
        if (!wrapItem) return;

        this.dataset.wrapKey = wrapItem.key;
        this.dataset.wrapProperties = JSON.stringify(Object.entries(wrapItem.properties));
      }

      /**
       * Moves focus back to this line's Edit button after the cart re-renders, or to the first
       * product link when the wrap was removed, keeping it trapped within an open drawer.
       * @param {HTMLElement | null} scopeEl The drawer or cart page this panel was in
       */
      restoreFocus(scopeEl) {
        if (!scopeEl) return;

        const panelEl = scopeEl.querySelector(`cart-gift-wrapping[data-gift-wrap-id="${CSS.escape(this.dataset.giftWrapId)}"]`);
        const focusEl = panelEl?.querySelector('[data-gift-wrap-edit]') ?? scopeEl.querySelector('.cart-item__name');
        if (!focusEl) return;

        if (scopeEl.tagName === 'CART-DRAWER') return trapFocus(scopeEl, focusEl);
        focusEl.focus();
      }
    }
  );
}
