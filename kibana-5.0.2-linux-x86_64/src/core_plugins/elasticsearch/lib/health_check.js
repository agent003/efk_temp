'use strict';

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _elasticsearch = require('elasticsearch');

var _elasticsearch2 = _interopRequireDefault(_elasticsearch);

var _expose_client = require('./expose_client');

var _expose_client2 = _interopRequireDefault(_expose_client);

var _migrate_config = require('./migrate_config');

var _migrate_config2 = _interopRequireDefault(_migrate_config);

var _create_kibana_index = require('./create_kibana_index');

var _create_kibana_index2 = _interopRequireDefault(_create_kibana_index);

var _check_es_version = require('./check_es_version');

var _check_es_version2 = _interopRequireDefault(_check_es_version);

var _kibana_version = require('./kibana_version');

var _kibana_version2 = _interopRequireDefault(_kibana_version);

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

var NoConnections = _elasticsearch2['default'].errors.NoConnections;

var format = _util2['default'].format;

var NO_INDEX = 'no_index';
var INITIALIZING = 'initializing';
var READY = 'ready';

var REQUEST_DELAY = 2500;

module.exports = function (plugin, server) {
  var config = server.config();
  var client = server.plugins.elasticsearch.client;

  plugin.status.yellow('Waiting for Elasticsearch');

  function waitForPong() {
    return client.ping()['catch'](function (err) {
      if (!(err instanceof NoConnections)) throw err;

      plugin.status.red(format('Unable to connect to Elasticsearch at %s.', config.get('elasticsearch.url')));

      return _bluebird2['default'].delay(REQUEST_DELAY).then(waitForPong);
    });
  }

  // just figure out the current "health" of the es setup
  function getHealth() {
    return client.cluster.health({
      timeout: '5s', // tells es to not sit around and wait forever
      index: config.get('kibana.index'),
      ignore: [408]
    }).then(function (resp) {
      // if "timed_out" === true then elasticsearch could not
      // find any idices matching our filter within 5 seconds
      if (!resp || resp.timed_out) {
        return NO_INDEX;
      }

      // If status === "red" that means that index(es) were found
      // but the shards are not ready for queries
      if (resp.status === 'red') {
        return INITIALIZING;
      }

      return READY;
    });
  }

  function waitUntilReady() {
    return getHealth().then(function (health) {
      if (health !== READY) {
        return _bluebird2['default'].delay(REQUEST_DELAY).then(waitUntilReady);
      }
    });
  }

  function waitForShards() {
    return getHealth().then(function (health) {
      if (health === NO_INDEX) {
        plugin.status.yellow('No existing Kibana index found');
        return (0, _create_kibana_index2['default'])(server);
      }

      if (health === INITIALIZING) {
        plugin.status.red('Elasticsearch is still initializing the kibana index.');
        return _bluebird2['default'].delay(REQUEST_DELAY).then(waitForShards);
      }
    });
  }

  function setGreenStatus() {
    return plugin.status.green('Kibana index ready');
  }

  function check() {
    return waitForPong().then(function () {
      return (0, _check_es_version2['default'])(server, _kibana_version2['default'].get());
    }).then(waitForShards).then(setGreenStatus).then(_lodash2['default'].partial(_migrate_config2['default'], server))['catch'](function (err) {
      return plugin.status.red(err);
    });
  }

  var timeoutId = null;

  function scheduleCheck(ms) {
    if (timeoutId) return;

    var myId = setTimeout(function () {
      check()['finally'](function () {
        if (timeoutId === myId) startorRestartChecking();
      });
    }, ms);

    timeoutId = myId;
  }

  function startorRestartChecking() {
    scheduleCheck(stopChecking() ? REQUEST_DELAY : 1);
  }

  function stopChecking() {
    if (!timeoutId) return false;
    clearTimeout(timeoutId);
    timeoutId = null;
    return true;
  }

  return {
    waitUntilReady: waitUntilReady,
    run: check,
    start: startorRestartChecking,
    stop: stopChecking,
    isRunning: function isRunning() {
      return !!timeoutId;
    }
  };
};
