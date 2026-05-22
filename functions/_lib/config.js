/* Static config loader. config.json lives at /data/config.json in the repo
   and is bundled at deploy time. */
import config from '../../data/config.json';

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
    payments: {
      stripeEnabled: config.payments.stripeEnabled,
      cashOnCollectionEnabled: config.payments.cashOnCollectionEnabled,
      cashOnDeliveryEnabled: config.payments.cashOnDeliveryEnabled,
    },
    allergens: config.allergens,
    marketing: config.marketing,
  };
}
