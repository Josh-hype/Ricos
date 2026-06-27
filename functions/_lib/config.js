/* Static config loader. The active shop's config is materialised at
   data/_active/config.json by scripts/build-shop.js before each deploy,
   picked from data/shops/<SHOP_SLUG>/config.json. Each Pages project sets
   its own SHOP_SLUG env var. */
import config from '../../data/_active/config.json';

export function getConfig() {
  return config;
}

/* Public-safe slice for the browser. Drops anything operational. */
export function getPublicConfig() {
  // Defensive reads: an incomplete shop config should not 500 /api/config for
  // the whole site. Missing sections degrade to sensible empties.
  const business = config.business || {};
  const fulfillment = config.fulfillment || {};
  const collection = fulfillment.collection || {};
  const delivery = fulfillment.delivery || {};
  const payments = config.payments || {};
  const pos = config.pos || {};
  return {
    business: {
      tradingName: business.tradingName,
      shortName: business.shortName,
      address: business.address,
      phone: business.phone,
      email: business.email,
    },
    fulfillment: {
      collection: { enabled: collection.enabled },
      delivery: {
        enabled: delivery.enabled,
        mode: delivery.mode || 'outcode',
        feePence: delivery.feePence,
        feeByOutcode: delivery.feeByOutcode || {},
        minimumOrderPence: delivery.minimumOrderPence,
        minimumIncludesFees: !!delivery.minimumIncludesFees,
        allowedOutcodes: delivery.allowedOutcodes,
        radius: delivery.radius || null,
        lateStart: delivery.lateStart || null,
      },
    },
    hours: config.hours,
    ordering: config.ordering,
    promo: config.promo,
    serviceFeePence: Number(config.serviceFeePence) || 0,
    payments: {
      stripeEnabled: payments.stripeEnabled,
      cashOnCollectionEnabled: payments.cashOnCollectionEnabled,
      cashOnDeliveryEnabled: payments.cashOnDeliveryEnabled,
      savedCardCvcThresholdPence: Number(payments.savedCardCvcThresholdPence) || 0,
    },
    // Till behaviour: externalCardMachine → the Card button records a card sale
    // immediately (shop uses its own terminal); selfServeDrinks → hide the drink
    // picker; requireOrderPin → staff must enter their operator code to start each
    // order (opt-in; the manager PIN on voids/refunds is separate and always on).
    pos: {
      externalCardMachine: !!pos.externalCardMachine,
      selfServeDrinks: !!pos.selfServeDrinks,
      requireOrderPin: !!pos.requireOrderPin,
    },
    allergens: config.allergens,
    marketing: config.marketing,
  };
}
