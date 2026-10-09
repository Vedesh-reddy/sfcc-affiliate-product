'use strict';

// Slot 4 returns shoppers to the affiliate page after login; slot 3 belongs to plugin_productreviews.
var endpoints = {};
Object.keys(module.superModule).forEach(function (key) {
    endpoints[key] = module.superModule[key];
});
endpoints[4] = 'Affiliate-Show';
module.exports = endpoints;
