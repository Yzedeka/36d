// src/index.js

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=";

const BASE = 76;
const DIMENSIONS = 36;
const BLOCK_BYTES = 64;

const MAGIC_1 = 0x36;
const MAGIC_2 = 0xd2;
const VERSION = 1;

const CODEC_RAW = 0;
const CODEC_DEFLATE = 1;
const CODEC_BROTLI = 2;
const CODEC_ZSTD = 3;

const FULL_BLOCK_CHARS = Math.ceil(
  (BLOCK_BYTES * 8) / Math.log2(BASE)
);

const THEORETICAL_CHARS_PER_BYTE =
  8 / Math.log2(BASE);

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {
  fatal: true
});

let nodeZlibPromise = null;

/* =========================================================
   Runtime detection
   ========================================================= */

function isNode() {
  return (
    typeof process !== "undefined" &&
    process?.versions?.node
  );
}

async function getNodeZlib() {
  if (!isNode()) {
    return null;
  }

  if (!nodeZlibPromise) {
    nodeZlibPromise = import("node:zlib");
  }

  return nodeZlibPromise;
}

/* =========================================================
   Byte helpers
   ========================================================= */

function concatBytes(...arrays) {
  const total = arrays.reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  const result = new Uint8Array(total);

  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength
    );
  }

  throw new TypeError(
    "Expected Uint8Array or ArrayBuffer"
  );
}

/* =========================================================
   Varints
   ========================================================= */

function encodeVarint(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new RangeError(
      "Varint value must be a non-negative safe integer"
    );
  }

  const bytes = [];

  do {
    let byte = value % 128;

    value = Math.floor(value / 128);

    if (value !== 0) {
      byte |= 0x80;
    }

    bytes.push(byte);
  } while (value !== 0);

  return Uint8Array.from(bytes);
}

function decodeVarint(bytes, offset = 0) {
  let value = 0;
  let multiplier = 1;

  for (
    let i = offset;
    i < bytes.length;
    i++
  ) {
    const byte = bytes[i];

    value +=
      (byte & 0x7f) *
      multiplier;

    if ((byte & 0x80) === 0) {
      if (
        !Number.isSafeInteger(value)
      ) {
        throw new Error(
          "Varint exceeds JavaScript safe integer range"
        );
      }

      return {
        value,
        nextOffset: i + 1
      };
    }

    multiplier *= 128;

    if (
      multiplier >
      Number.MAX_SAFE_INTEGER
    ) {
      throw new Error(
        "Invalid varint"
      );
    }
  }

  throw new Error(
    "Truncated varint"
  );
}

/* =========================================================
   Browser CompressionStream
   ========================================================= */

async function streamCompress(
  bytes,
  format
) {
  if (
    typeof CompressionStream ===
    "undefined"
  ) {
    throw new Error(
      "CompressionStream is not supported"
    );
  }

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(
      new CompressionStream(format)
    );

  return new Uint8Array(
    await new Response(
      stream
    ).arrayBuffer()
  );
}

async function streamDecompress(
  bytes,
  format
) {
  if (
    typeof DecompressionStream ===
    "undefined"
  ) {
    throw new Error(
      "DecompressionStream is not supported"
    );
  }

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(
      new DecompressionStream(format)
    );

  return new Uint8Array(
    await new Response(
      stream
    ).arrayBuffer()
  );
}

/* =========================================================
   Node compression
   ========================================================= */

function nodeBufferToUint8Array(
  buffer
) {
  return new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
}

async function nodeCompress(
  bytes,
  codec
) {
  const zlib =
    await getNodeZlib();

  if (!zlib) {
    throw new Error(
      "Node zlib is unavailable"
    );
  }

  const input =
    Buffer.from(bytes);

  if (
    codec === CODEC_DEFLATE
  ) {
    return nodeBufferToUint8Array(
      await new Promise(
        (resolve, reject) => {
          zlib.deflateRaw(
            input,
            (error, result) => {
              if (error) {
                reject(error);
              } else {
                resolve(result);
              }
            }
          );
        }
      )
    );
  }

  if (
    codec === CODEC_BROTLI
  ) {
    return nodeBufferToUint8Array(
      await new Promise(
        (resolve, reject) => {
          zlib.brotliCompress(
            input,
            (error, result) => {
              if (error) {
                reject(error);
              } else {
                resolve(result);
              }
            }
          );
        }
      )
    );
  }

  if (
    codec === CODEC_ZSTD
  ) {
    if (
      typeof zlib.zstdCompress !==
      "function"
    ) {
      throw new Error(
        "Zstandard is not supported by this Node version"
      );
    }

    return nodeBufferToUint8Array(
      await new Promise(
        (resolve, reject) => {
          zlib.zstdCompress(
            input,
            (error, result) => {
              if (error) {
                reject(error);
              } else {
                resolve(result);
              }
            }
          );
        }
      )
    );
  }

  throw new Error(
    "Unsupported compression codec"
  );
}

async function nodeDecompress(
  bytes,
  codec
) {
  const zlib =
    await getNodeZlib();

  if (!zlib) {
    throw new Error(
      "Node zlib is unavailable"
    );
  }

  const input =
    Buffer.from(bytes);

  if (
    codec === CODEC_DEFLATE
  ) {
    return nodeBufferToUint8Array(
      await new Promise(
        (resolve, reject) => {
          zlib.inflateRaw(
            input,
            (error, result) => {
              if (error) {
                reject(error);
              } else {
                resolve(result);
              }
            }
          );
        }
      )
    );
  }

  if (
    codec === CODEC_BROTLI
  ) {
    return nodeBufferToUint8Array(
      await new Promise(
        (resolve, reject) => {
          zlib.brotliDecompress(
            input,
            (error, result) => {
              if (error) {
                reject(error);
              } else {
                resolve(result);
              }
            }
          );
        }
      )
    );
  }

  if (
    codec === CODEC_ZSTD
  ) {
    if (
      typeof zlib.zstdDecompress !==
      "function"
    ) {
      throw new Error(
        "Zstandard is not supported by this Node version"
      );
    }

    return nodeBufferToUint8Array(
      await new Promise(
        (resolve, reject) => {
          zlib.zstdDecompress(
            input,
            (error, result) => {
              if (error) {
                reject(error);
              } else {
                resolve(result);
              }
            }
          );
        }
      )
    );
  }

  throw new Error(
    "Unsupported compression codec"
  );
}

/* =========================================================
   Codec support
   ========================================================= */

async function codecSupported(
  codec
) {
  if (
    codec === CODEC_RAW
  ) {
    return true;
  }

  if (isNode()) {
    const zlib =
      await getNodeZlib();

    if (!zlib) {
      return false;
    }

    if (
      codec === CODEC_DEFLATE
    ) {
      return (
        typeof zlib.deflateRaw ===
        "function"
      );
    }

    if (
      codec === CODEC_BROTLI
    ) {
      return (
        typeof zlib.brotliCompress ===
        "function"
      );
    }

    if (
      codec === CODEC_ZSTD
    ) {
      return (
        typeof zlib.zstdCompress ===
        "function"
      );
    }

    return false;
  }

  if (
    typeof CompressionStream ===
    "undefined"
  ) {
    return false;
  }

  const formats = {
    [CODEC_DEFLATE]:
      "deflate-raw",

    [CODEC_BROTLI]:
      "brotli",

    [CODEC_ZSTD]:
      "zstd"
  };

  const format =
    formats[codec];

  if (!format) {
    return false;
  }

  try {
    new CompressionStream(
      format
    );

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   Compression / decompression
   ========================================================= */

async function compress(
  bytes,
  codec
) {
  if (
    codec === CODEC_RAW
  ) {
    return bytes.slice();
  }

  if (isNode()) {
    return nodeCompress(
      bytes,
      codec
    );
  }

  const formats = {
    [CODEC_DEFLATE]:
      "deflate-raw",

    [CODEC_BROTLI]:
      "brotli",

    [CODEC_ZSTD]:
      "zstd"
  };

  const format =
    formats[codec];

  if (!format) {
    throw new Error(
      "Unsupported compression codec"
    );
  }

  return streamCompress(
    bytes,
    format
  );
}

async function decompress(
  bytes,
  codec
) {
  if (
    codec === CODEC_RAW
  ) {
    return bytes.slice();
  }

  if (isNode()) {
    return nodeDecompress(
      bytes,
      codec
    );
  }

  const formats = {
    [CODEC_DEFLATE]:
      "deflate-raw",

    [CODEC_BROTLI]:
      "brotli",

    [CODEC_ZSTD]:
      "zstd"
  };

  const format =
    formats[codec];

  if (!format) {
    throw new Error(
      "Unsupported compression codec"
    );
  }

  return streamDecompress(
    bytes,
    format
  );
}

/* =========================================================
   Base-76
   ========================================================= */

function digitsForBytes(
  byteCount
) {
  if (byteCount <= 0) {
    return 0;
  }

  return Math.ceil(
    (byteCount * 8) /
      Math.log2(BASE)
  );
}

function packBase76(
  bytes
) {
  bytes =
    toUint8Array(bytes);

  if (bytes.length === 0) {
    return ALPHABET[0];
  }

  const output = [];

  /*
   * First Base-76 character:
   *
   * 0 = final block is exactly 64 bytes
   * 1-63 = final block contains that many bytes
   */

  const tail =
    bytes.length % BLOCK_BYTES;

  output.push(
    ALPHABET[tail]
  );

  for (
    let offset = 0;
    offset < bytes.length;
    offset += BLOCK_BYTES
  ) {
    const end =
      Math.min(
        offset + BLOCK_BYTES,
        bytes.length
      );

    const block =
      bytes.slice(
        offset,
        end
      );

    let value = 0n;

    for (
      const byte of block
    ) {
      value =
        (value << 8n) |
        BigInt(byte);
    }

    const digitCount =
      block.length ===
      BLOCK_BYTES
        ? FULL_BLOCK_CHARS
        : digitsForBytes(
            block.length
          );

    const chars =
      new Array(
        digitCount
      );

    for (
      let i =
        digitCount - 1;
      i >= 0;
      i--
    ) {
      chars[i] =
        ALPHABET[
          Number(
            value %
              BigInt(BASE)
          )
        ];

      value /=
        BigInt(BASE);
    }

    if (value !== 0n) {
      throw new Error(
        "Base-76 block overflow during encoding"
      );
    }

    output.push(
      chars.join("")
    );
  }

  return output.join("");
}

function unpackBase76(
  text
) {
  if (
    typeof text !== "string"
  ) {
    throw new TypeError(
      "Encoded value must be a string"
    );
  }

  if (text.length === 0) {
    throw new Error(
      "Encoded value is empty"
    );
  }

  validateBase76(text);

  const tail =
    ALPHABET.indexOf(
      text[0]
    );

  if (
    tail < 0 ||
    tail >= BLOCK_BYTES
  ) {
    throw new Error(
      "Invalid Base-76 tail length"
    );
  }

  /*
   * Special empty representation.
   */
  if (text.length === 1) {
    if (tail !== 0) {
      throw new Error(
        "Invalid empty Base-76 value"
      );
    }

    return new Uint8Array(0);
  }

  const digits =
    text.slice(1);

  /*
   * IMPORTANT:
   *
   * tail === 0 means ALL blocks are
   * complete 64-byte blocks.
   *
   * tail !== 0 means the final block
   * is partial.
   */

  let fullDigitCount;

  let finalDigitCount = 0;

  if (tail === 0) {
    /*
     * Every block is 64 bytes.
     */
    fullDigitCount =
      digits.length;

    if (
      fullDigitCount %
        FULL_BLOCK_CHARS !==
      0
    ) {
      throw new Error(
        "Invalid Base-76 block length"
      );
    }
  } else {
    /*
     * The final block is partial.
     */
    finalDigitCount =
      digitsForBytes(tail);

    if (
      digits.length <
      finalDigitCount
    ) {
      throw new Error(
        "Truncated Base-76 data"
      );
    }

    fullDigitCount =
      digits.length -
      finalDigitCount;

    if (
      fullDigitCount %
        FULL_BLOCK_CHARS !==
      0
    ) {
      throw new Error(
        "Invalid Base-76 block length"
      );
    }
  }

  const blocks = [];

  let offset = 0;

  /*
   * Decode all complete blocks.
   */
  while (
    offset < fullDigitCount
  ) {
    const chunk =
      digits.slice(
        offset,
        offset +
          FULL_BLOCK_CHARS
      );

    if (
      chunk.length !==
      FULL_BLOCK_CHARS
    ) {
      throw new Error(
        "Truncated Base-76 block"
      );
    }

    offset +=
      FULL_BLOCK_CHARS;

    let value = 0n;

    for (
      const char of chunk
    ) {
      const digit =
        ALPHABET.indexOf(
          char
        );

      if (digit < 0) {
        throw new Error(
          "Invalid Base-76 character"
        );
      }

      value =
        value * BigInt(BASE) +
        BigInt(digit);
    }

    const block =
      new Uint8Array(
        BLOCK_BYTES
      );

    for (
      let i =
        BLOCK_BYTES - 1;
      i >= 0;
      i--
    ) {
      block[i] =
        Number(
          value & 0xffn
        );

      value >>= 8n;
    }

    if (value !== 0n) {
      throw new Error(
        "Base-76 block overflow"
      );
    }

    blocks.push(block);
  }

  /*
   * Decode partial final block.
   */
  if (tail !== 0) {
    const chunk =
      digits.slice(
        offset,
        offset +
          finalDigitCount
      );

    if (
      chunk.length !==
      finalDigitCount
    ) {
      throw new Error(
        "Truncated Base-76 tail"
      );
    }

    offset +=
      finalDigitCount;

    let value = 0n;

    for (
      const char of chunk
    ) {
      const digit =
        ALPHABET.indexOf(
          char
        );

      if (digit < 0) {
        throw new Error(
          "Invalid Base-76 character"
        );
      }

      value =
        value * BigInt(BASE) +
        BigInt(digit);
    }

    const block =
      new Uint8Array(tail);

    for (
      let i = tail - 1;
      i >= 0;
      i--
    ) {
      block[i] =
        Number(
          value & 0xffn
        );

      value >>= 8n;
    }

    if (value !== 0n) {
      throw new Error(
        "Base-76 tail overflow"
      );
    }

    blocks.push(block);
  }

  if (
    offset !== digits.length
  ) {
    throw new Error(
      "Invalid trailing Base-76 data"
    );
  }

  return concatBytes(
    ...blocks
  );
}

function validateBase76(
  text
) {
  for (
    const char of text
  ) {
    if (
      ALPHABET.indexOf(
        char
      ) === -1
    ) {
      throw new Error(
        `Invalid Base-76 character: ${JSON.stringify(char)}`
      );
    }
  }

  return true;
}

/* =========================================================
   36D splitting
   ========================================================= */

function split36(
  text
) {
  if (
    typeof text !== "string"
  ) {
    throw new TypeError(
      "Value must be a string"
    );
  }

  const result = [];

  const baseLength =
    Math.floor(
      text.length /
        DIMENSIONS
    );

  const extra =
    text.length %
    DIMENSIONS;

  let offset = 0;

  for (
    let i = 0;
    i < DIMENSIONS;
    i++
  ) {
    const length =
      baseLength +
      (i < extra ? 1 : 0);

    result.push(
      text.slice(
        offset,
        offset + length
      )
    );

    offset += length;
  }

  return result;
}

function join36(
  dimensions
) {
  if (
    !Array.isArray(
      dimensions
    )
  ) {
    throw new TypeError(
      "Dimensions must be an array"
    );
  }

  if (
    dimensions.length !==
    DIMENSIONS
  ) {
    throw new Error(
      `36D requires exactly ${DIMENSIONS} dimensions`
    );
  }

  for (
    const dimension of dimensions
  ) {
    if (
      typeof dimension !==
      "string"
    ) {
      throw new TypeError(
        "Every dimension must be a string"
      );
    }

    validateBase76(
      dimension
    );
  }

  return dimensions.join("");
}

/* =========================================================
   Binary envelope
   =========================================================

   [magic 1]
   [magic 2]
   [version]
   [codec]
   [original UTF-8 length varint]
   [compressed/raw data]

   ========================================================= */

function makeEnvelope(
  codec,
  originalLength,
  payload
) {
  return concatBytes(
    Uint8Array.from([
      MAGIC_1,
      MAGIC_2,
      VERSION,
      codec
    ]),

    encodeVarint(
      originalLength
    ),

    payload
  );
}

function parseEnvelope(
  bytes
) {
  if (
    bytes.length < 5
  ) {
    throw new Error(
      "Invalid compression header"
    );
  }

  if (
    bytes[0] !== MAGIC_1 ||
    bytes[1] !== MAGIC_2
  ) {
    throw new Error(
      "Invalid compression header"
    );
  }

  if (
    bytes[2] !== VERSION
  ) {
    throw new Error(
      `Unsupported 36D version: ${bytes[2]}`
    );
  }

  const codec =
    bytes[3];

  if (
    codec !== CODEC_RAW &&
    codec !== CODEC_DEFLATE &&
    codec !== CODEC_BROTLI &&
    codec !== CODEC_ZSTD
  ) {
    throw new Error(
      `Unknown compression codec: ${codec}`
    );
  }

  const {
    value: originalLength,
    nextOffset
  } =
    decodeVarint(
      bytes,
      4
    );

  if (
    nextOffset >
    bytes.length
  ) {
    throw new Error(
      "Invalid compression envelope"
    );
  }

  return {
    codec,
    originalLength,
    payload:
      bytes.slice(
        nextOffset
      )
  };
}

/* =========================================================
   Codec selection
   ========================================================= */

function codecName(
  codec
) {
  switch (codec) {
    case CODEC_RAW:
      return "Raw";

    case CODEC_DEFLATE:
      return "DEFLATE";

    case CODEC_BROTLI:
      return "Brotli";

    case CODEC_ZSTD:
      return "Zstandard";

    default:
      return "Unknown";
  }
}

async function makeCandidates(
  inputBytes
) {
  const candidates = [];

  /*
   * Raw is always available.
   */
  candidates.push({
    codec: CODEC_RAW,
    payload:
      inputBytes.slice()
  });

  const codecs = [
    CODEC_DEFLATE,
    CODEC_BROTLI,
    CODEC_ZSTD
  ];

  await Promise.all(
    codecs.map(
      async codec => {
        if (
          !(await codecSupported(
            codec
          ))
        ) {
          return;
        }

        try {
          const payload =
            await compress(
              inputBytes,
              codec
            );

          candidates.push({
            codec,
            payload
          });
        } catch {
          /*
           * Codec exists but failed.
           * Ignore it and continue.
           */
        }
      }
    )
  );

  return candidates;
}

/* =========================================================
   Encode
   ========================================================= */

export async function encode(
  text
) {
  if (
    typeof text !== "string"
  ) {
    throw new TypeError(
      "36D encode() expects a string"
    );
  }

  const originalBytes =
    encoder.encode(text);

  const candidates =
    await makeCandidates(
      originalBytes
    );

  let best = null;

  for (
    const candidate of candidates
  ) {
    const envelope =
      makeEnvelope(
        candidate.codec,
        originalBytes.length,
        candidate.payload
      );

    const encoded =
      packBase76(
        envelope
      );

    if (
      !best ||
      encoded.length <
        best.encoded.length
    ) {
      best = {
        ...candidate,
        envelope,
        encoded
      };
    }
  }

  if (!best) {
    throw new Error(
      "No usable compression codec"
    );
  }

  return best.encoded;
}

/* =========================================================
   Detailed encode
   ========================================================= */

export async function encodeDetailed(
  text
) {
  if (
    typeof text !== "string"
  ) {
    throw new TypeError(
      "36D encode() expects a string"
    );
  }

  const start =
    performanceNow();

  const originalBytes =
    encoder.encode(text);

  const candidates =
    await makeCandidates(
      originalBytes
    );

  let best = null;

  for (
    const candidate of candidates
  ) {
    const envelope =
      makeEnvelope(
        candidate.codec,
        originalBytes.length,
        candidate.payload
      );

    const encoded =
      packBase76(
        envelope
      );

    if (
      !best ||
      encoded.length <
        best.encoded.length
    ) {
      best = {
        ...candidate,
        envelope,
        encoded
      };
    }
  }

  if (!best) {
    throw new Error(
      "No usable compression codec"
    );
  }

  const dimensions =
    split36(
      best.encoded
    );

  const encodedBytes =
    encoder.encode(
      best.encoded
    ).length;

  const originalCharacters =
    [...text].length;

  const reductionPercent =
    originalBytes.length === 0
      ? 0
      : (
          1 -
          encodedBytes /
            originalBytes.length
        ) * 100;

  return {
    encoded:
      best.encoded,

    dimensions,

    codec:
      codecName(
        best.codec
      ),

    codecId:
      best.codec,

    originalCharacters,

    originalBytes:
      originalBytes.length,

    compressedBytes:
      best.payload.length,

    envelopeBytes:
      best.envelope.length,

    coordinateCharacters:
      best.encoded.length,

    encodedBytes,

    reductionPercent,

    base76CharactersPerByte:
      originalBytes.length === 0
        ? 0
        : best.encoded.length /
          originalBytes.length,

    theoreticalCharactersPerByte:
      THEORETICAL_CHARS_PER_BYTE,

    dimensionsCount:
      DIMENSIONS,

    encodeTime:
      performanceNow() -
      start
  };
}

/* =========================================================
   Decode
   ========================================================= */

export async function decode(
  encoded
) {
  if (
    Array.isArray(encoded)
  ) {
    encoded =
      join36(encoded);
  }

  if (
    typeof encoded !==
    "string"
  ) {
    throw new TypeError(
      "36D decode() expects an encoded string or 36 dimensions"
    );
  }

  /*
   * Allow whitespace/newlines
   * when copying addresses.
   */
  encoded =
    encoded.replace(
      /\s+/g,
      ""
    );

  if (
    encoded.length === 0
  ) {
    throw new Error(
      "Encoded value is empty"
    );
  }

  validateBase76(
    encoded
  );

  const envelopeBytes =
    unpackBase76(
      encoded
    );

  const {
    codec,
    originalLength,
    payload
  } =
    parseEnvelope(
      envelopeBytes
    );

  const originalBytes =
    await decompress(
      payload,
      codec
    );

  if (
    originalBytes.length !==
    originalLength
  ) {
    throw new Error(
      `Decoded byte length mismatch: expected ${originalLength}, got ${originalBytes.length}`
    );
  }

  try {
    return decoder.decode(
      originalBytes
    );
  } catch {
    throw new Error(
      "Decoded data is not valid UTF-8"
    );
  }
}

/* =========================================================
   Detailed decode
   ========================================================= */

export async function decodeDetailed(
  encoded
) {
  if (
    Array.isArray(encoded)
  ) {
    encoded =
      join36(encoded);
  }

  if (
    typeof encoded !==
    "string"
  ) {
    throw new TypeError(
      "36D decode() expects an encoded string or 36 dimensions"
    );
  }

  encoded =
    encoded.replace(
      /\s+/g,
      ""
    );

  if (
    encoded.length === 0
  ) {
    throw new Error(
      "Encoded value is empty"
    );
  }

  validateBase76(
    encoded
  );

  const envelopeBytes =
    unpackBase76(
      encoded
    );

  const {
    codec,
    originalLength,
    payload
  } =
    parseEnvelope(
      envelopeBytes
    );

  const originalBytes =
    await decompress(
      payload,
      codec
    );

  if (
    originalBytes.length !==
    originalLength
  ) {
    throw new Error(
      `Decoded byte length mismatch: expected ${originalLength}, got ${originalBytes.length}`
    );
  }

  let text;

  try {
    text =
      decoder.decode(
        originalBytes
      );
  } catch {
    throw new Error(
      "Decoded data is not valid UTF-8"
    );
  }

  return {
    text,

    codec:
      codecName(codec),

    codecId:
      codec,

    originalCharacters:
      [...text].length,

    originalBytes:
      originalBytes.length,

    compressedBytes:
      payload.length,

    envelopeBytes:
      envelopeBytes.length,

    encodedCharacters:
      encoded.length,

    dimensions:
      split36(encoded),

    dimensionsCount:
      DIMENSIONS
  };
}

/* =========================================================
   Dimension helpers
   ========================================================= */

export function dimensions(
  encoded
) {
  if (
    Array.isArray(encoded)
  ) {
    if (
      encoded.length !==
      DIMENSIONS
    ) {
      throw new Error(
        `Expected ${DIMENSIONS} dimensions`
      );
    }

    return encoded.slice();
  }

  if (
    typeof encoded !==
    "string"
  ) {
    throw new TypeError(
      "Encoded value must be a string"
    );
  }

  return split36(
    encoded.replace(
      /\s+/g,
      ""
    )
  );
}

export function fromDimensions(
  parts
) {
  return join36(parts);
}

/* =========================================================
   Verification
   ========================================================= */

export async function verify(
  text,
  encoded
) {
  try {
    const decoded =
      await decode(encoded);

    return decoded === text;
  } catch {
    return false;
  }
}

/* =========================================================
   Public constants
   ========================================================= */

export const constants =
  Object.freeze({
    alphabet:
      ALPHABET,

    base:
      BASE,

    dimensions:
      DIMENSIONS,

    blockBytes:
      BLOCK_BYTES,

    fullBlockChars:
      FULL_BLOCK_CHARS,

    theoreticalCharactersPerByte:
      THEORETICAL_CHARS_PER_BYTE,

    codecs:
      Object.freeze({
        RAW:
          CODEC_RAW,

        DEFLATE:
          CODEC_DEFLATE,

        BROTLI:
          CODEC_BROTLI,

        ZSTD:
          CODEC_ZSTD
      })
  });

/* =========================================================
   Utility
   ========================================================= */

function performanceNow() {
  if (
    typeof performance !==
      "undefined" &&
    typeof performance.now ===
      "function"
  ) {
    return performance.now();
  }

  return Date.now();
}