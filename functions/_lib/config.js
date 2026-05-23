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
  return {
    business: {
      tradingName: config.business.tradingName,
      address: config.business.address,
      phone: config.business.phone,
      email: config.business.email,
    },
    fulfillment: {
      collection: { enabled: config.fulfillment.collection.enabled },
      delivery: {
        enabled: config.fulfillment.delivery.enabled,
        feePence: config.fulfillment.delivery.feePence,
        minimumOrderPence: config.fulfillment.delivery.minimumOrderPence,
        allowedOutcodes: config.fulfillment.delivery.allowedOutcodes,
      },
    },
    hours: config.hours,
    ordering: config.ordering,
    promo: config.promo,
    serviceFeePence: Number(config.serviceFeePence) || 0,
    payments: {
      stripeEnabled: config.payments.stripeEnabled,
      cashOnCollectionEnabled: config.payments.cashOnCollectionEnabled,
      cashOnDeliveryEnabled: config.payments.cashOnDeliveryEnabled,
      savedCardCvcThresholdPence: Number(config.payments.savedCardCvcThresholdPence) || 0,
    },
    allergens: config.allergens,
    marketing: config.marketing,
  };
}
