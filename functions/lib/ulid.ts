/**
 * Customer.io deduplicates events on a ULID. We derive it from the Swell event id,
 * so a delivery that Swell repeats carries the same id and is ignored by Customer.io.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Time a Swell record or event was created, in Unix seconds, read from its id */
export function idTimestamp(id: unknown): number | undefined {
  if (typeof id !== "string" || !OBJECT_ID.test(id)) {
    return undefined;
  }
  return parseInt(id.slice(0, 8), 16);
}

// 16-bit FNV-1a, enough to tell apart the few event names one Swell event can produce
function hash16(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 16) ^ hash) & 0xffff;
}

/**
 * ULID for the Customer.io event that a Swell event produces: 48 bits of time, then 80 bits
 * that are the rest of the Swell event id and a hash of the event name. Always the same
 * for the same input. Returns undefined when the id is not a Swell id.
 */
export function eventUlid(eventId: unknown, name: string): string | undefined {
  const seconds = idTimestamp(eventId);
  if (seconds === undefined) {
    return undefined;
  }

  // 16 bytes: 6 of time in milliseconds, 8 from the Swell id, 2 from the event name
  const bytes: number[] = [];
  let milliseconds = seconds * 1000;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = milliseconds % 256;
    milliseconds = Math.floor(milliseconds / 256);
  }
  const rest = (eventId as string).slice(8);
  for (let i = 0; i < rest.length; i += 2) {
    bytes.push(parseInt(rest.slice(i, i + 2), 16));
  }
  const hash = hash16(name);
  bytes.push(hash >> 8, hash & 0xff);

  // 26 characters of 5 bits hold 130 bits, so the 128 bits are padded with two leading zeros
  let bits = "00";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let ulid = "";
  for (let i = 0; i < bits.length; i += 5) {
    ulid += CROCKFORD[parseInt(bits.slice(i, i + 5), 2)];
  }
  return ulid;
}
