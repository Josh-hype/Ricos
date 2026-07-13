/* Static config loader. The active shop's config is materialised at
   data/_active/config.json by scripts/build-shop.js before each deploy,
   picked from data/shops/<SHOP_SLUG>/config.json. Each Pages project sets
   its own SHOP_SLUG env var. */
import config from '../../data/_active/config.json';
import { activeClosure } from './hours.js';

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
        // Hard distance cap (road miles) layered on top of outcode pricing. When
        // set, the browser can't price locally (distance needs a geocode), so the
        // order page routes the postcode check through /api/delivery-quote — the
        // same server path radius shops use — so the cap actually applies.
        maxMiles: Number(delivery.maxMiles) > 0 ? Number(delivery.maxMiles) : null,
        radius: delivery.radius || null,
        lateStart: delivery.lateStart || null,
      },
    },
    hours: config.hours,
    // Today's one-off closure (emergency "we're closed today"), or null.
    closure: activeClosure(config),
    ordering: config.ordering,
    // promo carries both the standing autoOnlineDiscount and the first-orders
    // welcome offer (firstOrders {enabled,percent,limit,label}); the order page
    // previews the right one for the signed-in customer. The server recomputes
    // authoritatively at /api/order regardless.
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
      // Online-orders-only device mode (e.g. Sunmi V2 Plus at a delivery-only
      // shop): the till receives/accepts/prints online orders and keeps the full
      // back office, but hides the in-person EPOS (counter sale + card reader).
      ordersOnly: !!pos.ordersOnly,
    },
    allergens: config.allergens,
    marketing: config.marketing,
  };
}
