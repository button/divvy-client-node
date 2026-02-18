import { EventEmitter } from 'events';

/**
 * Basic Divvy protocol client.
 *
 * Commands supported: The only command currently supported is `hit()`.
 *
 * Connection management: The client can be explicitly connected by
 * calling `connect()`. The connection will be kept open as long as possible.
 * If a command is called while the client is disconnected, the command
 * will be enqueued and the client will be connected.
 *
 * @fires Client#connected
 * @fires Client#disconnected
 * @fires Client#error
 */
declare class Client extends EventEmitter {
  /**
   * @param host server hostname
   * @param port server port number
   * @param options client options
   */
  constructor(host: string, port: number, options?: Client.ClientOptions);

  host: string;
  port: number;
  connected: boolean;

  /** Schedules connection to the server; no-op if already connected. */
  connect(): void;

  /** Manually close the connection. This will not trigger a reconnect. */
  close(): void;

  /**
   * Perform a "hit" command against the given operation.
   * Upon success, the promise is resolved with an object containing
   * fields `isAllowed` (boolean), `currentCredit`, and `nextResetSeconds`.
   *
   * @param operation the operation object, consisting of string key-value pairs
   * @param timeout the timeout in millis; if undefined, uses instance default timeout
   * @throws {Client.Error.BacklogError} if too many requests are pending
   * @throws {Client.Error.TimeoutError} if the request times out
   * @throws {Client.Error.DisconnectedError} if the connection is closed
   * @throws {Client.Error.BadResponseError} if the server returns an invalid response
   */
  hit(operation?: Client.Operation, timeout?: number): Promise<Client.HitResponse>;
}

declare namespace Client {
  type ClientOptions = import('./src/types').ClientOptions;
  type HitResponse = import('./src/types').HitResponse;
  type Operation = import('./src/types').Operation;

  /**
   * Stub of the public interface. Always allows operations without
   * making any network calls.
   */
  class Stub extends Client {
    connect(): void;
    close(): void;
    hit(): Promise<HitResponse>;
  }

  namespace Error {
    /** Base error class for all Divvy client errors. */
    class DivvyClientError extends globalThis.Error {}
    /** Message timed out. */
    class TimeoutError extends DivvyClientError {}
    /** Tried to send message while disconnected. */
    class DisconnectedError extends DivvyClientError {}
    /** Too many requests in flight. */
    class BacklogError extends DivvyClientError {}
    /** Got a bad response from the server. */
    class BadResponseError extends DivvyClientError {}
  }
}

export = Client;
