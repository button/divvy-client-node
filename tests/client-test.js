'use strict';

const assert = require('assert');
const net = require('net');
const sinon = require('sinon');

const carrier = require('carrier');

const Errors = require('../src/errors');
const Client = require('../src/client');
const Bluebird = require('bluebird');

describe('src/client', () => {

  describe('general tests', () => {
    // Fake server.
    var server;

    // Test client.
    var client;

    // String the server should received. Set in tests.
    var expectedClientMessage;

    // String the server should send back. Set in tests.
    var mockServerResponse;

    // The server's client connection.
    var clientConnection;

    beforeEach((done) => {
      // Create a server on port 0 (ephemeral / randomly-selected port)
      server = net.createServer((conn) => {
        clientConnection = conn;
        carrier.carry(conn, (line) => {
          assert.equal(expectedClientMessage, line);
          conn.write(mockServerResponse + '\n');
        });
      });

      // Once the server is bound, connect a client to it then finish.
      server.on('listening', () => {
        client = new Client('', server.address().port, {
          autoReconnect: false,
          throttleConnect: false
        });
        client.on('connected', done);
        client.connect();
      });

      server.listen(0);
    });

    it('parses an allowed response', (done) => {
      expectedClientMessage = 'HIT "name"="test" "path"="123"';
      mockServerResponse = 'OK true 1 2';

      client.hit({ name: 'test', path: '123'}).then((response) => {
        assert.deepEqual(response, {
          isAllowed: true,
          currentCredit: 1,
          nextResetSeconds: 2
        });
        done();
      }).catch(done);
    });

    it('sorts HIT operation keys', (done) => {
      expectedClientMessage = 'HIT "name"="test" "path"="123"';
      mockServerResponse = 'OK true 1 2';

      client.hit({ path: '123', name: 'test' }).then((response) => {
        assert.deepEqual(response, {
          isAllowed: true,
          currentCredit: 1,
          nextResetSeconds: 2
        });
        done();
      }).catch(done);
    });

    it('parses a not-allowed response', (done) => {
      expectedClientMessage = 'HIT "name"="test" "path"="123"';
      mockServerResponse = 'OK false 0 0';

      client.hit({ name: 'test', path: '123'}).then((response) => {
        assert.deepEqual(response, {
          isAllowed: false,
          currentCredit: 0,
          nextResetSeconds: 0
        });
        done();
      }).catch(done);
    });

    it('emits an event when disconnected', (done) => {
      client.on('disconnected', () => {
        assert.equal(false, client.connected);
        done();
      });
      setTimeout(() => {
        clientConnection.destroy();
      }, 10);
    });

    it('client automatically connects if needed', (done) => {
      client.close();

      // Create a new client and never explicitly call connect()
      const myClient = new Client('', server.address().port);
      expectedClientMessage = 'HIT "name"="test" "path"="123"';
      mockServerResponse = 'OK true 1 2';

      myClient.hit({ path: '123', name: 'test' }).then((response) => {
        assert.deepEqual(response, {
          isAllowed: true,
          currentCredit: 1,
          nextResetSeconds: 2
        });
        assert(myClient.connected);
        done();
      }).catch(done);

    });
  });

  describe('timeout tests', () => {
    // TODO(mikey): These tests should use a fake clock.

    // Fake server.
    var server;

    // Test client.
    var client;

    beforeEach((done) => {
      // A server that always succeeds, but delays 100ms.
      server = net.createServer((conn) => {
        carrier.carry(conn, () => {
          setTimeout(() => {
            conn.write('OK true 1 2\n');
          }, 50);
        });
      });

      server.on('listening', () => {
        client = new Client('', server.address().port);
        client.on('connected', done);
        client.connect();
      });

      server.listen(0);
    });

    it('processes timeouts correctly', (done) => {
      const promises = [
        client.hit({}, 50).catch((err) => err),
        client.hit({}, 60).catch((err) => err),
        client.hit({}, 25).catch((err) => err),
      ];

      Bluebird.all(promises).then((results) => {
        assert(results[0] instanceof Errors.TimeoutError);

        assert(!(results[1] instanceof Error));
        assert.deepEqual({ isAllowed: true, currentCredit: 1, nextResetSeconds: 2 }, results[1]);

        assert(results[2] instanceof Errors.TimeoutError);
        done();
      }).catch(done);

    });
  });

  describe('autoreconnect tests', () => {
    // Fake server.
    var server;
    var serverPort;

    var clock;

    beforeEach((done) => {

      // A server that tells us when a client has connected.
      server = net.createServer(function(conn) {
        this.emit('client-connected', conn);
      });

      server.on('listening', () => {
        serverPort = server.address().port;
        done();
      });

      server.listen(0);

      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it('reconnects automatically', (done) => {
      var reconnectCount = 0;

      const client = new Client('', serverPort, {
        autoReconnect: true,
        throttleConnect: false
      });

      // Client will keep reconnecting.
      server.on('client-connected', (conn) => {
        reconnectCount++;
        if (reconnectCount === 10) {
          done();
          return;
        }
        conn.destroy();
      });

      client.connect();
    });

    it('throttles reconnect', (done) => {
      const client = new Client('', serverPort, {
        autoReconnect: true,
        throttleConnect: true
      });

      // Client will keep reconnecting.
      server.on('client-connected', (conn) => {
        conn.destroy();
      });

      client.once('disconnected', () => {
        assert(!client.connected);
        clock.tick(1000);
        client.once('connected', () => {
          assert(client.connected);
          done();
        });
      });

      client.connect();
    });

  });

  describe('maxPendingRequests tests', () => {
    // Fake server.
    var server;
    var serverPort;

    beforeEach((done) => {
      server = net.createServer(function(conn) {
        this.emit('client-connected', conn);
        carrier.carry(conn, () => {
          setTimeout(() => {
            conn.write('OK true 1 2\n');
          }, 100);
        });
      });

      server.on('listening', () => {
        serverPort = server.address().port;
        done();
      });

      server.listen(0);
    });

    it('rejects after 3 pending requests', (done) => {
      const client = new Client('', serverPort, {
        autoReconnect: true,
        maxPendingRequests: 3
      });

      const promises = [
        client.hit({}).catch((err) => err),
        client.hit({}).catch((err) => err),
        client.hit({}).catch((err) => err),
        client.hit({}).catch((err) => err),
      ];

      Bluebird.all(promises).then((results) => {
        assert(!(results[0] instanceof Error));
        assert(!(results[1] instanceof Error));
        assert(!(results[2] instanceof Error));
        assert(results[3] instanceof Errors.BacklogError);
        done();
      }).catch(done);
    });

    // Test is flaky on travis :-(
    xit('rejects in-flight requests when disconnected', (done) => {
      const client = new Client('', serverPort, {
        autoReconnect: false,
        maxPendingRequests: 3
      });

      server.once('client-connected', (conn) => {
        conn.destroy();
      });

      client.once('connected', () => {
        const promises = [
          client.hit({}).catch((err) => err),
          client.hit({}).catch((err) => err)
        ];

        Bluebird.all(promises).then((results) => {
          assert(results[0] instanceof Errors.DisconnectedError);
          assert(results[1] instanceof Errors.DisconnectedError);
          done();
        }).catch(done);
      });

      client.connect();

    });

  });

  describe('Client.Stub', function() {

    beforeEach(function() {
      this.client = new Client.Stub();
    });

    it('is a no-op hit', function(done) {
      this.client.hit({}).then(quota => {
        assert.equal(quota.isAllowed, true);
        assert.equal(quota.currentCredit, 0);
        assert.equal(quota.nextResetSeconds, 0);
        done();
      });
    });

    it('does not error when calling connect', function() {
      this.client.connect();
    });

    it('does not error when calling close', function() {
      this.client.close();
    });

  });

});
