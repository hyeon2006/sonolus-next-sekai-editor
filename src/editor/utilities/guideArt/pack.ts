import type { ConnectorGuideColor } from '../../../chart/note'
import type { StoredGuideArtFrame, StoredGuideArtRect } from '../../../state/store/guideArt'
import { guideColors } from '../../../utils/colors'

export type CellFrame = {
    colors: Uint8Array
    alphas: Uint8Array
}

type QuantizedCells = {
    colors: Uint8Array
    steps: Uint8Array
}

type ActiveGuideArtRun = {
    index: number
    lastStep: number
    stepDelta: number | undefined
}

export type PackedGuideArt = {
    frames: StoredGuideArtFrame[]
    frameEnds: number[]
}

const ALPHA_QUANT_STEPS = 20
const ALPHA_FINE_SCALE = 4
const ALPHA_HYSTERESIS_FINE = 3
const MAX_GRADIENT_STEP_DELTA = 2
const palette = Object.keys(guideColors) as ConnectorGuideColor[]

/**
 * Quantizes and packs decoded cells in-place. The caller no longer needs the input
 * buffers, so reusing them avoids allocating and copying two full grids per frame.
 */
export const packCellFrames = (
    cellFrames: CellFrame[],
    columns: number,
    rows: number,
    onProgress?: (current: number) => void,
): PackedGuideArt => {
    const frames: StoredGuideArtFrame[] = []
    const frameEnds: number[] = []
    let previousCellFrame: CellFrame | undefined
    let previousCells: QuantizedCells | undefined
    let previousUniqueCells: QuantizedCells | undefined

    for (const [index, cellFrame] of cellFrames.entries()) {
        if (cellFrame === previousCellFrame && frameEnds.length) {
            frameEnds[frameEnds.length - 1] = index + 1
        } else {
            previousCellFrame = cellFrame
            const quantized = quantizeCellsInPlace(cellFrame, previousCells)
            previousCells = quantized

            if (previousUniqueCells && isSameQuantizedCells(previousUniqueCells, quantized)) {
                frameEnds[frameEnds.length - 1] = index + 1
            } else {
                frames.push(packQuantizedCells(quantized, columns, rows))
                frameEnds.push(index + 1)
                previousUniqueCells = quantized
            }
        }

        if (index % 32 === 31) onProgress?.(index + 1)
    }

    onProgress?.(cellFrames.length)
    return { frames, frameEnds }
}

const quantizeCellsInPlace = (
    frame: CellFrame,
    previous: QuantizedCells | undefined,
): QuantizedCells => {
    const colors = frame.colors
    const steps = frame.alphas

    for (let i = 0; i < colors.length; i++) {
        if (!colors[i]) continue

        const fine = steps[i] ?? 0
        let step = Math.round(fine / ALPHA_FINE_SCALE)
        if (previous && previous.colors[i] === colors[i]) {
            const previousStep = previous.steps[i] ?? 0
            if (Math.abs(fine - previousStep * ALPHA_FINE_SCALE) <= ALPHA_HYSTERESIS_FINE) {
                step = previousStep
            }
        }

        if (step) {
            steps[i] = step
        } else {
            colors[i] = 0
        }
    }

    return { colors, steps }
}

const isSameQuantizedCells = (a: QuantizedCells, b: QuantizedCells) =>
    isSameBytes(a.colors, b.colors) && isSameBytes(a.steps, b.steps)

const isSameBytes = (a: Uint8Array, b: Uint8Array) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
}

const packQuantizedCells = (
    { colors, steps }: QuantizedCells,
    columns: number,
    rows: number,
): StoredGuideArtFrame => {
    const rects: StoredGuideArtRect[] = []
    let active = new Map<number, ActiveGuideArtRun>()

    for (let y = 0; y < rows; y++) {
        const nextActive = new Map<number, ActiveGuideArtRun>()

        for (let x = 0; x < columns;) {
            const offset = y * columns + x
            const color = colors[offset]
            const step = steps[offset] ?? 0
            if (!color || !step) {
                x++
                continue
            }

            let end = x + 1
            while (
                end < columns &&
                colors[y * columns + end] === color &&
                steps[y * columns + end] === step
            ) {
                end++
            }

            const key = (x * (columns + 1) + end) * (palette.length + 1) + color
            const run = active.get(key)
            const bottom = 1 - (y + 1) / rows
            let merged = false

            if (run) {
                const rect = rects[run.index]
                if (!rect) throw new Error('Unexpected missing Guide rectangle')
                const stepDelta = step - run.lastStep
                if (
                    Math.abs(stepDelta) <= MAX_GRADIENT_STEP_DELTA &&
                    (run.stepDelta === undefined || run.stepDelta === stepDelta)
                ) {
                    rect.bottom = bottom
                    rect.height += 1 / rows
                    rect.headAlpha = step / ALPHA_QUANT_STEPS
                    run.lastStep = step
                    run.stepDelta = stepDelta
                    nextActive.set(key, run)
                    merged = true
                }
            }

            if (!merged) {
                const guideColor = palette[color - 1]
                if (!guideColor) throw new Error('Unexpected missing Guide palette')
                rects.push({
                    left: x / columns,
                    width: (end - x) / columns,
                    bottom,
                    height: 1 / rows,
                    color: guideColor,
                    headAlpha: step / ALPHA_QUANT_STEPS,
                    tailAlpha: step / ALPHA_QUANT_STEPS,
                })
                nextActive.set(key, {
                    index: rects.length - 1,
                    lastStep: step,
                    stepDelta: undefined,
                })
            }

            x = end
        }

        active = nextActive
    }

    return { rects }
}
