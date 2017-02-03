'use strict';

var _ = require('lodash');

module.exports = function (server) {
  server.route({
    method: 'GET',
    path: '/api/timelion/functions',
    handler: function handler(request, reply) {
      var functionArray = _.map(server.plugins.timelion.functions, function (val, key) {
        // TODO: This won't work on frozen objects, it should be removed when everything is converted to datasources and chainables
        return _.extend({}, val, { name: key });
      });
      reply(_.sortBy(functionArray, 'name'));
    }
  });
};