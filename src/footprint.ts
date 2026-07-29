// R3 (realistic-stand): a REAL, load-driven memory footprint.
//
// Under sustained loadgen traffic the process must build a steady RSS so that a
// risky change which LOWERS resources.limits.memory BELOW that footprint gets the
// container OOMKilled by the kernel — a real, emergent failure, not an injected
// crash. The footprint MUST plateau: it is a BOUNDED ring buffer of the last N
// request payloads, so RSS climbs to ~MEM_FOOTPRINT_MB and then holds flat. An
// unbounded leak would OOM even at the baseline limit, which we never want.
//
// Sizing: each slot is a fixed 256 KiB buffer; N = MEM_FOOTPRINT_MB * 4 slots
// (256 KiB * 4 = 1 MiB per MB). So the retained set is ~MEM_FOOTPRINT_MB MiB once
// N requests have been served. MEM_FOOTPRINT_MB=0 disables it entirely (no
// allocation), so local/unit runs and the no-DB fallback are unaffected.
//
// The slot for a given ring position is allocated ONCE (on first use) and then
// reused IN PLACE on every later request that maps to it — the request payload is
// overwritten into the existing buffer, never re-allocated. This is deliberate:
// allocating a fresh 256 KiB buffer per request and dropping the old one churns
// the allocator and RSS creeps up from fragmentation (freed pages not returned to
// the OS) even though the live set is bounded — which could OOM at the baseline
// limit too. Reuse-in-place keeps RSS perfectly FLAT at ~MEM_FOOTPRINT_MB.

const SLOT_BYTES = 256 * 1024; // 256 KiB per retained payload

function footprintMb(): number {
  const v = Number(process.env.MEM_FOOTPRINT_MB ?? "150");
  return Number.isFinite(v) && v > 0 ? v : 0;
}

const capacity = footprintMb() * 4; // slots; MEM_FOOTPRINT_MB * (1 MiB / 256 KiB)
const ring: Buffer[] = new Array(capacity);
let cursor = 0;

/**
 * Record one business request into the bounded ring buffer. The slot is allocated
 * once (zero-filled → real committed pages) and thereafter overwritten in place,
 * so the retained memory climbs to ~MEM_FOOTPRINT_MB MiB and then holds flat —
 * bounded, never growing unbounded. No-op when disabled.
 */
export function recordFootprint(): void {
  if (capacity <= 0) return;
  const idx = cursor % capacity;
  let buf = ring[idx];
  if (!buf) {
    buf = Buffer.alloc(SLOT_BYTES); // first touch of this slot: commit its pages
    ring[idx] = buf;
  }
  // Overwrite the payload in place (one byte per 4 KiB page keeps pages resident
  // without re-allocating — the pages stay committed, RSS stays flat).
  for (let off = 0; off < SLOT_BYTES; off += 4096) buf[off] = cursor & 0xff;
  cursor++;
}
