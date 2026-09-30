import { describe, expect, it } from 'vitest'
import { box, coverageBands, outlinePath, slotRects, supplierBands } from './geometry'
import { explode, lerpRect, squarify } from './layout'
import { initials, SlotMap, slotColor, surname } from './palette'

const cell = { x: 0, y: 0, w: 100, h: 100 }

describe('slotRects', () => {
  const areaOf = (r: { w: number; h: number }) => r.w * r.h

  it('emits nothing when nothing is charged', () => {
    expect(slotRects({}, cell, 0.34)).toEqual([])
    expect(slotRects({ shooting: 0, interior: 0 }, cell, 0.34)).toEqual([])
  })

  it('puts shooting and interior on the top edge, left slot first', () => {
    const s = slotRects({ shooting: 0.1, interior: 0.1 }, cell, 0.34)
    const top = s.filter((r) => r.edge === 'top')
    expect(top.map((r) => r.id)).toEqual(['shooting', 'interior'])
    expect(top[0].x).toBeLessThan(top[1].x)
    expect(top.every((r) => r.y === cell.y)).toBe(true)
  })

  it('puts needs-a-creator above perimeter D on the left edge', () => {
    const s = slotRects({ noCreator: 0.05, perimeterD: 0.1 }, cell, 0.34)
    const left = s.filter((r) => r.edge === 'left')
    expect(left.map((r) => r.id)).toEqual(['noCreator', 'perimeterD'])
    expect(left[0].y + left[0].h).toBeLessThanOrEqual(left[1].y)
  })

  it('cuts ball dominance into the right edge, like every other notch', () => {
    const b = slotRects({ ball: 0.06 }, cell, 0.34).find((r) => r.id === 'ball')!
    expect(b.x + b.w).toBeCloseTo(cell.x + cell.w, 8)
    expect(b.inward).toBe('left')
  })

  it('gives every notch exactly its share of the piece, square or stretched', () => {
    for (const c of [cell, { x: 0, y: 0, w: 300, h: 60 }, { x: 5, y: 5, w: 40, h: 160 }]) {
      const fracs = { shooting: 0.12, interior: 0.08, noCreator: 0.05, perimeterD: 0.1, ball: 0.04 }
      for (const r of slotRects(fracs, c, 0.34)) {
        expect(areaOf(r) / areaOf(c)).toBeCloseTo(fracs[r.id], 8)
      }
    }
  })

  it('widens a notch rather than cutting past the depth limit', () => {
    const r = slotRects({ shooting: 0.3 }, cell, 0.34)[0]
    expect(r.h).toBeLessThanOrEqual(cell.h * 0.46 + 1e-9)
    expect(r.w).toBeGreaterThan(cell.w * 0.34)
    expect(areaOf(r) / areaOf(cell)).toBeCloseTo(0.3, 8)
  })

  it('keeps notches on one edge apart', () => {
    const s = slotRects({ shooting: 0.15, interior: 0.15 }, cell, 0.34)
    const [a, b] = s.filter((r) => r.edge === 'top')
    expect(a.x + a.w).toBeLessThanOrEqual(b.x)
  })

  it('drops a side notch below a top notch it would otherwise run into', () => {
    // a deep shooting notch and a deep needs-a-creator notch share the top-left corner
    const s = slotRects({ shooting: 0.15, noCreator: 0.1 }, cell, 0.34)
    const top = s.find((r) => r.id === 'shooting')!
    const side = s.find((r) => r.id === 'noCreator')!
    const overlapX = side.x + side.w > top.x && top.x + top.w > side.x
    const overlapY = side.y + side.h > top.y && top.y + top.h > side.y
    expect(overlapX && overlapY).toBe(false)
    expect(areaOf(side) / areaOf(cell)).toBeCloseTo(0.1, 8)
  })
})

describe('outlinePath', () => {
  it('closes, and is a plain square when nothing is cut', () => {
    const path = outlinePath([], cell)
    expect(path.endsWith('Z')).toBe(true)
    expect(path).toBe('M 0 0 L 100 0 L 100 100 L 0 100 Z')
  })

  it('adds four points per slot', () => {
    const slots = slotRects({ shooting: 0.1, perimeterD: 0.1, ball: 0.05 }, cell, 0.34)
    const count = (p: string) => p.split(' L ').length
    expect(count(outlinePath(slots, cell))).toBe(count(outlinePath([], cell)) + 4 * 3)
  })

  it('never emits a non-finite coordinate', () => {
    const slots = slotRects(
      { shooting: 0.15, interior: 0.15, perimeterD: 0.15, noCreator: 0.08, ball: 0.08 },
      cell,
      0.34,
    )
    const nums = outlinePath(slots, cell).match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(nums.every(Number.isFinite)).toBe(true)
  })
})

describe('coverageBands', () => {
  const top = () => slotRects({ shooting: 0.12 }, cell, 0.34)[0]

  it('paints a top notch from the edge downward', () => {
    const slot = top()
    const { covered, waste } = coverageBands(slot, 0.25)
    expect(covered.y).toBe(slot.y)
    expect(covered.h).toBeCloseTo(slot.h * 0.25, 8)
    expect(waste.y).toBeCloseTo(slot.y + slot.h * 0.25, 8)
    expect(covered.h + waste.h).toBeCloseTo(slot.h, 8)
  })

  it('paints a left notch from the edge rightward', () => {
    const slot = slotRects({ perimeterD: 0.12 }, cell, 0.34).find((s) => s.id === 'perimeterD')!
    const { covered, waste } = coverageBands(slot, 0.5)
    expect(covered.x).toBe(slot.x)
    expect(covered.w + waste.w).toBeCloseTo(slot.w, 8)
  })

  it('paints a right notch from the right edge leftward', () => {
    const slot = slotRects({ ball: 0.06 }, cell, 0.34)[0]
    const { covered, waste } = coverageBands(slot, 0.25)
    expect(covered.x + covered.w).toBeCloseTo(slot.x + slot.w, 8)
    expect(waste.x).toBeCloseTo(slot.x, 8)
    expect(covered.w + waste.w).toBeCloseTo(slot.w, 8)
  })

  it('splits the uncovered part into paid-back and striped by the credit', () => {
    const slot = top()
    const { covered, credited, waste } = coverageBands(slot, 0.5, 0.9)
    expect(covered.h).toBeCloseTo(slot.h * 0.5, 8)
    expect(credited.h).toBeCloseTo(slot.h * 0.45, 8)
    expect(waste.h).toBeCloseTo(slot.h * 0.05, 8)
    expect(credited.y).toBeCloseTo(covered.y + covered.h, 8)
    expect(waste.y).toBeCloseTo(credited.y + credited.h, 8)
  })

  it('leaves nothing striped at full coverage and everything striped at none', () => {
    const slot = top()
    expect(coverageBands(slot, 1).waste.h).toBeCloseTo(0, 8)
    expect(coverageBands(slot, 0).covered.h).toBeCloseTo(0, 8)
  })

  it('clamps coverage outside 0-1', () => {
    const slot = top()
    expect(coverageBands(slot, 3).waste.h).toBeCloseTo(0, 8)
    expect(coverageBands(slot, -2).covered.h).toBeCloseTo(0, 8)
  })
})

describe('box', () => {
  it('renames w/h to width/height, which is what <rect> needs', () => {
    // spreading a Rect straight into <rect> silently yields a zero-sized rect:
    // the waste stripes vanish and the bare notch reads as a gap in the board
    expect(box({ x: 3, y: 4, w: 10, h: 20 })).toEqual({ x: 3, y: 4, width: 10, height: 20 })
  })

  it('gives every band of a partly covered notch a drawable size', () => {
    const slot = slotRects({ shooting: 0.12 }, cell, 0.34)[0]
    const { covered, waste } = coverageBands(slot, 0.4)
    for (const r of [box(covered), box(waste)]) {
      expect(r.width).toBeGreaterThan(0)
      expect(r.height).toBeGreaterThan(0)
    }
  })
})

describe('supplierBands', () => {
  it('splits a top band across the slot in share order, covering it exactly', () => {
    const slot = slotRects({ shooting: 0.12 }, cell, 0.34)[0]
    const { covered } = coverageBands(slot, 1)
    const bands = supplierBands(covered, [
      { id: 'a', share: 0.6 },
      { id: 'b', share: 0.4 },
    ], slot)
    expect(bands.map((b) => b.id)).toEqual(['a', 'b'])
    expect(bands[0].w).toBeCloseTo(covered.w * 0.6, 8)
    expect(bands[0].x + bands[0].w).toBeCloseTo(bands[1].x, 8)
    expect(bands.reduce((s, b) => s + b.w, 0)).toBeCloseTo(covered.w, 8)
  })

  it('splits a left band down the slot instead of across it', () => {
    const slot = slotRects({ perimeterD: 0.12 }, cell, 0.34).find((s) => s.id === 'perimeterD')!
    const { covered } = coverageBands(slot, 1)
    const bands = supplierBands(covered, [{ id: 'a', share: 0.5 }, { id: 'b', share: 0.5 }], slot)
    expect(bands[0].y + bands[0].h).toBeCloseTo(bands[1].y, 8)
    expect(bands[0].w).toBeCloseTo(covered.w, 8)
  })

  it('returns nothing when nobody supplies the skill', () => {
    const slot = slotRects({ shooting: 0.12 }, cell, 0.34)[0]
    expect(supplierBands(coverageBands(slot, 0).covered, [], slot)).toEqual([])
  })
})

describe('squarify', () => {
  const items = [
    { id: 'a', value: 24 },
    { id: 'b', value: 14 },
    { id: 'c', value: 12 },
    { id: 'd', value: 9 },
    { id: 'e', value: 8 },
    { id: 'f', value: 8 },
    { id: 'g', value: 7 },
    { id: 'h', value: 6 },
  ]
  const frame = { x: 0, y: 0, w: 400, h: 300 }
  const cells = squarify(items, frame)

  it('places every item once', () => {
    expect(cells.map((c) => c.id).sort()).toEqual(items.map((i) => i.id).sort())
  })

  it('tiles the frame with no gaps', () => {
    const area = cells.reduce((s, c) => s + c.w * c.h, 0)
    expect(area).toBeCloseTo(frame.w * frame.h, 4)
  })

  it('keeps cell area proportional to value', () => {
    const scale = (frame.w * frame.h) / items.reduce((s, i) => s + i.value, 0)
    for (const c of cells) expect(c.w * c.h).toBeCloseTo(c.value * scale, 4)
  })

  it('puts the largest piece in the same corner every time', () => {
    const a = cells.find((c) => c.id === 'a')!
    expect(a.x).toBe(frame.x)
    expect(a.y).toBe(frame.y)
  })

  it('is deterministic: the same rotation gives the same board', () => {
    expect(squarify(items, frame)).toEqual(cells)
  })

  it('stays inside the frame', () => {
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(frame.x - 1e-6)
      expect(c.y).toBeGreaterThanOrEqual(frame.y - 1e-6)
      expect(c.x + c.w).toBeLessThanOrEqual(frame.x + frame.w + 1e-6)
      expect(c.y + c.h).toBeLessThanOrEqual(frame.y + frame.h + 1e-6)
    }
  })

  it('keeps cells reasonably square', () => {
    for (const c of cells) expect(Math.max(c.w / c.h, c.h / c.w)).toBeLessThan(3)
  })

  it('handles a single item and an empty list', () => {
    expect(squarify([{ id: 'only', value: 5 }], frame)).toEqual([
      { id: 'only', value: 5, x: 0, y: 0, w: 400, h: 300 },
    ])
    expect(squarify([], frame)).toEqual([])
    expect(squarify([{ id: 'zero', value: 0 }], frame)).toEqual([])
  })
})

describe('explode', () => {
  const items = [
    { id: 'a', value: 24 },
    { id: 'b', value: 6 },
  ]
  const cells = explode(items, { x: 0, y: 0, w: 400, h: 200 }, 4)

  it('makes true squares', () => {
    for (const c of cells) expect(c.w).toBeCloseTo(c.h, 8)
  })

  it('keeps a common scale, so side goes as the square root of load', () => {
    const [a, b] = cells
    expect(a.w / b.w).toBeCloseTo(Math.sqrt(24 / 6), 6)
  })
})

describe('lerpRect', () => {
  it('returns the ends exactly and the midpoint halfway', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 }
    const b = { x: 20, y: 40, w: 30, h: 50 }
    expect(lerpRect(a, b, 0)).toEqual(a)
    expect(lerpRect(a, b, 1)).toEqual(b)
    expect(lerpRect(a, b, 0.5)).toEqual({ x: 10, y: 20, w: 20, h: 30 })
  })
})

describe('palette', () => {
  it('keeps a player’s color when a teammate is swapped out', () => {
    const map = new SlotMap(['a', 'b', 'c'])
    const before = map.slot('c')
    map.replace('b', 'new')
    expect(map.slot('c')).toBe(before)
    expect(map.slot('new')).toBe(1)
    expect(map.slot('a')).toBe(0)
  })

  it('gives light and dark their own step for the same slot', () => {
    expect(slotColor(0, 'light')).not.toBe(slotColor(0, 'dark'))
  })

  it('reduces names to a readable label', () => {
    expect(initials('Shai Gilgeous-Alexander')).toBe('SG')
    expect(initials('Nikola Jokic')).toBe('NJ')
    expect(surname('Jaylin Williams')).toBe('Williams')
    expect(surname('Bobby Portis Jr.')).toBe('Portis')
  })
})
