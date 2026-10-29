if (!customElements.get('gift-wrapping')) {
  customElements.define(
    'gift-wrapping',
    class GiftWrapping extends HTMLElement {
      constructor() {
        super();
        this.onToggle = this.onToggle.bind(this);
      }

      connectedCallback() {
        this.toggleEl = this.querySelector('[data-gift-wrap-toggle]');
        this.fieldsEl = this.querySelector('[data-gift-wrap-fields]');
        this.stockEl = this.querySelector('[id^="LowStock-"]');

        this.variantChangeUnsubscriber = subscribe(PUB_SUB_EVENTS.variantChange, ({ data }) => this.updateStock(data.html));

        if (!this.toggleEl) return;

        this.toggleEl.addEventListener('change', this.onToggle);
        // Sync with state the browser may have restored (back/forward cache).
        this.onToggle();
      }

      disconnectedCallback() {
        this.variantChangeUnsubscriber?.();
        this.toggleEl?.removeEventListener('change', this.onToggle);
      }

      get isSelected() {
        return Boolean(this.toggleEl?.checked);
      }

      onToggle() {
        const { isSelected } = this;
        this.fieldsEl.disabled = !isSelected;
        this.fieldsEl.hidden = !isSelected;
      }

      /**
       * Swaps in the low stock message for the newly selected variant.
       * @param {Document} html The product section rendered for the new variant
       */
      updateStock(html) {
        if (!this.stockEl) return;

        const newStockEl = html.getElementById(this.stockEl.id);
        if (!newStockEl) return;

        this.stockEl.innerHTML = newStockEl.innerHTML;
      }

      /**
       * Builds a JSON add-to-cart body holding the product and its gift wrap, so both lines are
       * added in one request and either both succeed or both fail. The product gets a hidden
       * `_gift_wrap_id` and the wrap a matching `_gift_wrap_for`, which is how the cart pairs them.
       * The To, From and message fields (`gift_wrap[...]`) become properties on the wrap line.
       * @param {FormData} formData The product form's data
       * @returns {string | null} The request body, or null when gift wrap isn't selected
       */
      getCartRequestBody(formData) {
        if (!this.isSelected) return null;

        const giftWrapId = crypto.randomUUID?.() ?? `${Date.now()}`;
        const quantity = Number(formData.get('quantity')) || 1;
        const productItem = {
          id: Number(formData.get('id')),
          quantity,
          properties: { _gift_wrap_id: giftWrapId },
        };
        const giftWrapItem = {
          id: Number(this.dataset.variantId),
          quantity,
          properties: { [this.dataset.parentProperty]: this.dataset.parentTitle, _gift_wrap_for: giftWrapId },
        };

        const sellingPlan = formData.get('selling_plan');
        if (sellingPlan) productItem.selling_plan = Number(sellingPlan);

        for (const [key, value] of formData) {
          const [, group, name] = key.match(/^(properties|gift_wrap)\[(.+)\]$/) ?? [];
          if (!group || typeof value !== 'string' || !value.trim()) continue;

          const item = group === 'gift_wrap' ? giftWrapItem : productItem;
          item.properties[name] = value.trim();
        }

        return JSON.stringify({
          items: [productItem, giftWrapItem],
          sections: formData.get('sections') ?? undefined,
          sections_url: formData.get('sections_url') ?? undefined,
        });
      }
    }
  );
}
