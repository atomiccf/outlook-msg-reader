import { PropertyDecodeError } from '../errors/errors';

const COMPRESSED_MAGIC = 0x75465a4c; // LZFu
const UNCOMPRESSED_MAGIC = 0x414c454d; // MELA
const DICTIONARY_SIZE = 4096;
export const DEFAULT_MAX_RTF_BYTES = 64 * 1024 * 1024;
const INITIAL_DICTIONARY = Buffer.from(
  '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx',
  'ascii',
);

// A Latin-1 byte string preserves every byte and keeps \binN offsets unchanged.
// Text runs are decoded later, using the document or selected font code page.
function preserveRtfBytes(bytes: Buffer, maxTextBytes?: number): string {
  const parts: string[] = [];
  let textBytes = 0;
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    const chunk = bytes.subarray(offset, offset + 4096).toString('latin1');
    textBytes += Buffer.byteLength(chunk);
    if (maxTextBytes !== undefined && textBytes > maxTextBytes) {
      throw new RangeError(`RTF text exceeds remaining maxResultBytes (${maxTextBytes})`);
    }
    parts.push(chunk);
  }
  return parts.join('');
}

/** Decompresses PidTagRtfCompressed into a lossless Latin-1 byte string (MS-OXRTFCP). */
export function decompressRtf(
  input: Buffer,
  maxRtfBytes: number = DEFAULT_MAX_RTF_BYTES,
  maxTextBytes?: number,
): string {
  if (!Number.isSafeInteger(maxRtfBytes) || maxRtfBytes < 0) {
    throw new RangeError('maxRtfBytes must be a non-negative safe integer');
  }
  if (maxTextBytes !== undefined && (!Number.isSafeInteger(maxTextBytes) || maxTextBytes < 0)) {
    throw new RangeError('maxTextBytes must be a non-negative safe integer');
  }
  if (input.length < 16) throw new PropertyDecodeError('Compressed RTF header is truncated');

  const compressedSize = input.readUInt32LE(0);
  const rawSize = input.readUInt32LE(4);
  const magic = input.readUInt32LE(8);
  if (compressedSize + 4 > input.length) throw new PropertyDecodeError('Compressed RTF size exceeds the property stream');
  if (rawSize > maxRtfBytes) {
    throw new RangeError(`RTF body exceeds maxRtfBytes (${maxRtfBytes})`);
  }
  if (maxTextBytes !== undefined && rawSize > maxTextBytes) {
    throw new RangeError(`RTF body exceeds remaining maxResultBytes (${maxTextBytes})`);
  }

  if (magic === UNCOMPRESSED_MAGIC) {
    if (16 + rawSize > input.length) throw new PropertyDecodeError('Uncompressed RTF body is truncated');
    return preserveRtfBytes(input.subarray(16, 16 + rawSize), maxTextBytes);
  }
  if (magic !== COMPRESSED_MAGIC) throw new PropertyDecodeError('Unknown compressed RTF signature');

  const dictionary = Buffer.alloc(DICTIONARY_SIZE);
  INITIAL_DICTIONARY.copy(dictionary);
  let dictionaryOffset = INITIAL_DICTIONARY.length;
  let inputOffset = 16;
  const output = Buffer.alloc(rawSize);
  let outputOffset = 0;

  while (inputOffset < input.length && outputOffset < rawSize) {
    const control = input[inputOffset++];
    for (let bit = 0; bit < 8 && outputOffset < rawSize && inputOffset < input.length; bit += 1) {
      if ((control & (1 << bit)) === 0) {
        const value = input[inputOffset++];
        output[outputOffset++] = value;
        dictionary[dictionaryOffset] = value;
        dictionaryOffset = (dictionaryOffset + 1) % DICTIONARY_SIZE;
        continue;
      }

      if (inputOffset + 1 >= input.length) throw new PropertyDecodeError('Compressed RTF reference is truncated');
      const first = input[inputOffset++];
      const second = input[inputOffset++];
      let referenceOffset = (first << 4) | (second >> 4);
      const length = (second & 0x0f) + 2;
      if (referenceOffset === dictionaryOffset) return preserveRtfBytes(output.subarray(0, outputOffset), maxTextBytes);

      for (let index = 0; index < length && outputOffset < rawSize; index += 1) {
        const value = dictionary[referenceOffset];
        referenceOffset = (referenceOffset + 1) % DICTIONARY_SIZE;
        output[outputOffset++] = value;
        dictionary[dictionaryOffset] = value;
        dictionaryOffset = (dictionaryOffset + 1) % DICTIONARY_SIZE;
      }
    }
  }

  if (outputOffset !== rawSize) throw new PropertyDecodeError(`Compressed RTF ended at ${outputOffset} of ${rawSize} bytes`);
  return preserveRtfBytes(output, maxTextBytes);
}
