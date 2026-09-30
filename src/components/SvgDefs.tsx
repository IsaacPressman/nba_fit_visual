/**
 * Paint definitions, rendered once. SVG ids are document-global, so one hidden
 * sprite serves the team board and all thirty league tiles.
 *
 * The waste hatch is ink over a void tone rather than a hue, so "nobody covers
 * this" reads the same over every piece color and survives a grayscale print.
 * The textures are the opt-in accessibility channel: one directional fill at
 * 45 degrees and its 135-degree mirror, never on by default.
 */
import { SLOT_COUNT, slotColor, textureId, type Mode } from '../fit/palette'

export function SvgDefs({ mode }: { mode: Mode }) {
  const colors = Array.from({ length: SLOT_COUNT }, (_, i) => slotColor(i, mode))

  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
      <defs>
        <pattern
          id="waste-hatch"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--hatch)" strokeWidth="1.6" />
        </pattern>
        {/* Paid back elsewhere: part of the hole, not part of the exposure.
            Dots rather than stripes, so it can never be read as waste. */}
        <pattern id="credit-dots" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.1" fill="var(--hatch)" />
        </pattern>
        {/* The league tiles draw pieces in one neutral tone, so exposure is the
            only colored thing on a tile and thirty of them compare at a glance. */}
        <pattern
          id="waste-hatch-accent"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" fill="var(--exposure-wash)" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--exposure)" strokeWidth="2.2" />
        </pattern>
        {colors.flatMap((color) =>
          [false, true].map((mirror) => (
            <pattern
              key={textureId(color, mirror)}
              id={textureId(color, mirror)}
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
              patternTransform={`rotate(${mirror ? 135 : 45})`}
            >
              <rect width="4" height="4" fill={color} opacity="0.3" />
              <line x1="0" y1="0" x2="0" y2="4" stroke={color} strokeWidth="2.2" />
            </pattern>
          )),
        )}
      </defs>
    </svg>
  )
}
