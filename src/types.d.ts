export interface ClientOptions {
  /** Whether to automatically reconnect when the server connection is unexpectedly closed. Default: `true` */
  autoReconnect?: boolean;
  /** Default timeout for commands in milliseconds, or `null` to disable. Default: `1000` */
  defaultCommandTimeoutMillis?: number | null;
  /** Maximum number of requests allowed in flight at once. Requests over this limit will be dropped. Default: `100` */
  maxPendingRequests?: number;
  /** When `autoReconnect` is true, maximum number of consecutive reconnect attempts before giving up. Default: `5` */
  maxReconnectAttempts?: number;
  /** Whether to throttle `connect()` calls to at most once per `throttleConnectTimeoutMillis`. Default: `true` */
  throttleConnect?: boolean;
  /** When `throttleConnect` is true, minimum milliseconds between connection attempts. Default: `1000` */
  throttleConnectTimeoutMillis?: number;
}

export interface HitResponse {
  /** Whether the operation is allowed. */
  isAllowed: boolean;
  /** The current credit remaining. */
  currentCredit: number;
  /** Seconds until the next credit reset. */
  nextResetSeconds: number;
}

export type Operation = Record<string, string | number>;
