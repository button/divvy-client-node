# Divvy NodeJS Client

A client for the [Divvy rate limit server](https://github.com/button/divvy).

1. [Requirements](#requirements)
2. [Usage](#usage)
3. [Other Features](#other-features)
4. [License and Copyright](#license-and-copyright)

## Requirements

* NodeJS version 4 or newer.

## Usage

```js
const DivvyClient = require('@button/divvy-client');
const client = new DivvyClient('localhost', 8321);

client.hit({ method: 'GET', path: '/pantry/cookies' }).then((result) => {
    console.log(`Success: ${JSON.stringify(result)}`);
    // { allowed: true, currentCredit: 100, nextResetSeconds: 60 }
}).catch((err) => {
    console.log(`Error: ${err.message}`);    
});
```

## Other Features

### Client Stub

A stub of the interface is exposed as `Client.Stub`, which implements the core methods (connect, close, and hit).

## License and Copyright

Licensed under the MIT license. See `LICENSE.txt` for full terms.

Copyright 2016 Button, Inc.
