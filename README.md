# 36Dimensional Coordinate Compressor

Lossless text compression and encoding with a custom Base-76 representation split into 36 deterministic dimensions.

## Features

* Lossless UTF-8 text compression
* Automatic codec selection
* DEFLATE, Brotli, and Zstandard when available
* Custom Base-76 encoding
* Exactly 36 deterministic dimensions
* Unicode and emoji support
* Built-in integrity verification
* Node.js and browser support

## Installation

### From GitHub

```bash
npm install github:Yzedeka/36d
```

### From a release

Download the latest `.tgz` release and install it with:

```bash
npm install ./36d-26.9.1.tgz
```

## Usage

```js
import { encode, decode } from "36d";

const original = "Hello world! 🌍";

const compressed = await encode(original);
const decoded = await decode(compressed);

console.log(compressed);
console.log(decoded);
```

Output:

```text
Hello world! 🌍
```

## 36 Dimensions

36D takes the final Base-76 encoded representation and deterministically divides it into exactly 36 dimensions.

```js
import { encode, dimensions, fromDimensions } from "36d";

const encoded = await encode("Hello world!");
const dims = dimensions(encoded);

console.log(dims.length); // 36

const reconstructed = fromDimensions(dims);

console.log(reconstructed === encoded); // true
```

The dimensions are simply a deterministic representation of the encoded data. They do not change or discard any information.

## Verification

```js
import { encode, verify } from "36d";

const encoded = await encode("Hello world!");

console.log(await verify(encoded)); // true
```

## API

### `encode(text)`

Compresses and encodes a UTF-8 string.

Returns a Base-76 encoded string.

### `decode(encoded)`

Decodes and decompresses a 36D string.

Returns the original UTF-8 string.

### `encodeDetailed(text)`

Returns the encoded data along with compression and codec information.

### `decodeDetailed(encoded)`

Decodes the data and returns additional metadata.

### `dimensions(encoded)`

Splits an encoded string into exactly 36 dimensions.

### `fromDimensions(dimensions)`

Reconstructs the encoded string from 36 dimensions.

### `verify(encoded)`

Checks whether an encoded value can be successfully decoded.

### `constants`

Exposes 36D encoding constants.

## License

36D is licensed under the **GNU General Public License v2.0**.

See [`LICENSE`](./LICENSE).

## Release

Current release: **26.9.1**

GitHub: https://github.com/Yzedeka/36d
