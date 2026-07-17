import type { ConnectorGuideColor, ConnectorLayer } from '../../../chart/note'
import type { StoredGuideArtFrame, StoredGuideArtRect } from '../../../state/store/guideArt'
import { guideColors } from '../../../utils/colors'
import { clamp } from '../../../utils/math'

export type GuideArtRect = StoredGuideArtRect
export type GuideArtFrame = StoredGuideArtFrame

export type GuideMediaSource =
    | {
          kind: 'image'
          name: string
          width: number
          height: number
          url: string
          bitmap: ImageBitmap
      }
    | {
          kind: 'video'
          name: string
          width: number
          height: number
          duration: number
          url: string
          video: HTMLVideoElement
      }

export type PreparedGuideArt = {
    kind: 'image' | 'video'
    name: string
    aspectRatio: number
    widthLanes: number
    columns: number
    rows: number
    frames: GuideArtFrame[]
    layer: ConnectorLayer
    frameEnds?: number[]
    frameDuration?: number
    compatibility?: boolean
    compatibilityNoteSpeed?: number
    entranceDuration?: number
    holdDuration?: number
    exitDuration?: number
}

export type PrepareGuideArtOptions = {
    widthLanes: number
    columns: number
    layer: ConnectorLayer
    fps: number
    start: number
    end: number
    compatibility: boolean
    compatibilityNoteSpeed: number
    entranceDuration: number
    holdDuration: number
    exitDuration: number
    onProgress?: (current: number, total: number) => void
}

export class GuideArtConversionError extends Error {
    constructor(
        public readonly code: 'unsupported' | 'invalidRange' | 'invalidTiming' | 'tooManySegments',
    ) {
        super(code)
    }
}

const MAX_IMAGE_SEGMENTS = 4000
const MAX_VIDEO_DECODE_WORKERS = 12
const MAX_CONCURRENT_VIDEO_PIXELS = 1920 * 1080 * MAX_VIDEO_DECODE_WORKERS
// Playback advances at most half an output frame of media per presented callback,
// so every sample is covered by a presentation even when a callback slips.
const MAX_VIDEO_DECODE_PLAYBACK_RATE = 8
const VIDEO_DECODE_TARGET_CALLBACK_RATE = 30
// Seeks can cost hundreds of milliseconds each on keyframe sparse videos, so only
// trivially small conversions decode purely by seeking.
const VIDEO_SEEK_DECODE_MAX_FRAMES = 24
const GUIDE_ALPHA = 0.6

const ALPHA_QUANT_STEPS = 20
const ALPHA_FINE_SCALE = 4
const ALPHA_HYSTERESIS_FINE = 3
const MAX_GRADIENT_STEP_DELTA = 2

const REPAIR_SOURCE_GAP_FACTOR = 1.25
const STATIC_REPAIR_FILL_MAX_FRAMES = 32

type CellFrame = {
    colors: Uint8Array
    alphas: Uint8Array
}

type QuantizedCells = {
    colors: Uint8Array
    steps: Uint8Array
}

const palette = (Object.entries(guideColors) as [ConnectorGuideColor, string][]).map(
    ([color, hex]) => {
        const rgb = hexToRgb(hex)
        return {
            color,
            rgb,
            hsv: rgbToHsv(rgb.r, rgb.g, rgb.b),
        }
    },
)

export const loadGuideMedia = async (file: File): Promise<GuideMediaSource> => {
    const kind = getMediaKind(file)
    if (!kind) throw new GuideArtConversionError('unsupported')

    const url = URL.createObjectURL(file)

    try {
        if (kind === 'image') {
            const bitmap = await createImageBitmap(file)
            return {
                kind,
                name: file.name,
                width: bitmap.width,
                height: bitmap.height,
                url,
                bitmap,
            }
        }

        const video = document.createElement('video')
        video.preload = 'auto'
        video.muted = true
        video.playsInline = true
        video.src = url

        await waitForVideoMetadata(video)

        return {
            kind,
            name: file.name,
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
            url,
            video,
        }
    } catch (error) {
        URL.revokeObjectURL(url)
        if (error instanceof GuideArtConversionError) throw error
        throw new GuideArtConversionError('unsupported')
    }
}

export const disposeGuideMedia = (source: GuideMediaSource | undefined) => {
    if (!source) return

    if (source.kind === 'image') {
        source.bitmap.close()
    } else {
        source.video.pause()
        source.video.removeAttribute('src')
        source.video.load()
    }

    URL.revokeObjectURL(source.url)
}

export const prepareGuideArt = async (
    source: GuideMediaSource,
    options: PrepareGuideArtOptions,
): Promise<PreparedGuideArt> => {
    const columns = Math.round(options.columns)
    const rows = Math.max(1, Math.round((columns * source.height) / source.width))

    if (source.kind === 'image') {
        if (
            !isValidDuration(options.entranceDuration) ||
            !isValidDuration(options.holdDuration) ||
            !isValidDuration(options.exitDuration)
        ) {
            throw new GuideArtConversionError('invalidTiming')
        }

        const cells = createFrameCapturer(columns, rows)(source.bitmap)
        const frame = packQuantizedCells(quantizeCells(cells, undefined), columns, rows)
        if (frame.rects.length > MAX_IMAGE_SEGMENTS)
            throw new GuideArtConversionError('tooManySegments')

        options.onProgress?.(1, 1)

        return {
            kind: source.kind,
            name: source.name,
            aspectRatio: source.height / source.width,
            widthLanes: options.widthLanes,
            columns,
            rows,
            frames: [frame],
            layer: options.layer,
            entranceDuration: options.entranceDuration,
            holdDuration: options.holdDuration,
            exitDuration: options.exitDuration,
        }
    }

    const start = clamp(options.start, 0, source.duration)
    const end = clamp(options.end, 0, source.duration)
    if (!(end > start) || !(options.fps > 0)) throw new GuideArtConversionError('invalidRange')

    const frameCount = Math.ceil((end - start) * options.fps)

    const frameDuration = (end - start) / frameCount
    const cellFrames = await decodeVideoFrames(
        source,
        columns,
        rows,
        start,
        frameDuration,
        frameCount,
        options.onProgress,
    )

    // Quantize with temporal hysteresis so noise does not flicker cells between
    // adjacent alpha levels, then merge identical consecutive frames into one
    // stored frame spanning them, so static sections and low frame rate sources
    // emit far fewer segments.
    const frames: GuideArtFrame[] = []
    const frameEnds: number[] = []
    let previousCellFrame: CellFrame | undefined
    let previousCells: QuantizedCells | undefined
    let previousUniqueCells: QuantizedCells | undefined
    for (const [index, cellFrame] of cellFrames.entries()) {
        // Samples covered by the same presented frame share one cell frame object,
        // and quantization is a fixed point on identical input, so extend directly.
        if (cellFrame === previousCellFrame && frameEnds.length) {
            frameEnds[frameEnds.length - 1] = index + 1
            continue
        }
        previousCellFrame = cellFrame

        const quantized = quantizeCells(cellFrame, previousCells)
        previousCells = quantized

        if (previousUniqueCells && isSameQuantizedCells(previousUniqueCells, quantized)) {
            frameEnds[frameEnds.length - 1] = index + 1
        } else {
            frames.push(packQuantizedCells(quantized, columns, rows))
            frameEnds.push(index + 1)
            previousUniqueCells = quantized
        }
    }

    return {
        kind: source.kind,
        name: source.name,
        aspectRatio: source.height / source.width,
        widthLanes: options.widthLanes,
        columns,
        rows,
        frames,
        layer: options.layer,
        frameEnds,
        frameDuration,
        compatibility: options.compatibility,
        compatibilityNoteSpeed: options.compatibilityNoteSpeed,
    }
}

const getMediaKind = (file: File) => {
    if (file.type.startsWith('image/')) return 'image'
    if (file.type.startsWith('video/')) return 'video'

    const extension = file.name.split('.').at(-1)?.toLowerCase()
    if (extension && ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'].includes(extension))
        return 'image'
    if (extension && ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(extension)) return 'video'
}

const isValidDuration = (value: number) => Number.isFinite(value) && value >= 0

const waitForVideoMetadata = (video: HTMLVideoElement) =>
    new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            video.removeEventListener('loadedmetadata', onLoaded)
            video.removeEventListener('error', onError)
        }
        const onLoaded = () => {
            cleanup()
            if (!Number.isFinite(video.duration) || !video.videoWidth || !video.videoHeight) {
                reject(new GuideArtConversionError('unsupported'))
                return
            }
            resolve()
        }
        const onError = () => {
            cleanup()
            reject(new GuideArtConversionError('unsupported'))
        }

        video.addEventListener('loadedmetadata', onLoaded)
        video.addEventListener('error', onError)

        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
            onLoaded()
        } else {
            video.load()
        }
    })

const decodeVideoFrames = async (
    source: Extract<GuideMediaSource, { kind: 'video' }>,
    columns: number,
    rows: number,
    start: number,
    frameDuration: number,
    frameCount: number,
    onProgress: PrepareGuideArtOptions['onProgress'],
) => {
    return await decodeVideoFramesWithPlayback(
        source,
        columns,
        rows,
        start,
        frameDuration,
        frameCount,
        onProgress,
    )
}

const decodeVideoFramesWithPlayback = async (
    source: Extract<GuideMediaSource, { kind: 'video' }>,
    columns: number,
    rows: number,
    start: number,
    frameDuration: number,
    frameCount: number,
    onProgress: PrepareGuideArtOptions['onProgress'],
) => {
    const workerCount = getVideoDecodeWorkerCount(source, frameCount)
    const videos = [source.video]

    for (let i = 1; i < workerCount; i++) {
        const video = document.createElement('video')
        video.preload = 'auto'
        video.muted = true
        video.playsInline = true
        video.src = source.url
        videos.push(video)
    }

    const frames: (CellFrame | undefined)[] = Array.from({ length: frameCount })
    const coverStarts = new Float64Array(frameCount).fill(Number.NEGATIVE_INFINITY)
    let minPresentedDelta = Number.POSITIVE_INFINITY
    let completed = 0

    const sampleTimeAt = (index: number) => start + (index + 0.5) * frameDuration
    // Low sample counts decode entirely by seeking, which is frame exact and cheap
    // there, while playback capture stays the fast path for long conversions.
    const preferSeek = frameCount <= VIDEO_SEEK_DECODE_MAX_FRAMES

    try {
        await Promise.all(videos.slice(1).map(waitForVideoMetadata))

        const results = await Promise.allSettled(
            videos.map(async (video, workerIndex) => {
                const captureFrame = createFrameCapturer(columns, rows)
                const from = Math.floor((frameCount * workerIndex) / workerCount)
                const to = Math.floor((frameCount * (workerIndex + 1)) / workerCount)

                const setFrame = (index: number, cells: CellFrame, coverStart: number) => {
                    if (!frames[index]) {
                        completed++
                        onProgress?.(completed, frameCount)
                    }
                    frames[index] = cells
                    coverStarts[index] = coverStart
                }

                if (!preferSeek && 'requestVideoFrameCallback' in video) {
                    await decodeVideoWorkerByPlayback(
                        video,
                        from,
                        to,
                        start,
                        frameDuration,
                        captureFrame,
                        setFrame,
                        (delta) => {
                            if (delta > 0.001 && delta < minPresentedDelta) {
                                minPresentedDelta = delta
                            }
                        },
                    )
                } else {
                    await decodeVideoWorkerBySeeking(
                        video,
                        from,
                        to,
                        start,
                        frameDuration,
                        captureFrame,
                        setFrame,
                    )
                }
            }),
        )

        const failure = results.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason

        // Playback assigns each sample the frame the video actually presented at that
        // time; a sample is only suspect when its covering frame is older than half an
        // output frame and older than one source frame, meaning a presentation was
        // missed. Static spans fill from one capture when both ends show identical
        // cells, so repairs stay cheap for still sections too.
        const sourceFrameGap = Number.isFinite(minPresentedDelta) ? minPresentedDelta : 0
        const staleTolerance = Math.max(
            frameDuration / 2,
            REPAIR_SOURCE_GAP_FACTOR * sourceFrameGap,
        )
        const staleRanges: [number, number][] = []
        for (let index = 0; index < frameCount; index++) {
            const coverStart = coverStarts[index] ?? Number.NEGATIVE_INFINITY
            if (frames[index] && sampleTimeAt(index) - coverStart <= staleTolerance) continue

            const last = staleRanges.at(-1)
            if (last?.[1] === index - 1) {
                last[1] = index
            } else {
                staleRanges.push([index, index])
            }
        }

        if (staleRanges.length) {
            const repairWorkerCount = Math.min(videos.length, staleRanges.length)
            const repairResults = await Promise.allSettled(
                videos.slice(0, repairWorkerCount).map(async (video, workerIndex) => {
                    const captureFrame = createFrameCapturer(columns, rows)

                    for (let i = workerIndex; i < staleRanges.length; i += repairWorkerCount) {
                        const range = staleRanges[i]
                        if (!range) continue

                        await repairVideoRangeBySeeking(
                            video,
                            captureFrame,
                            range[0],
                            range[1],
                            sampleTimeAt,
                            (index, cells) => {
                                if (!frames[index]) {
                                    completed++
                                    onProgress?.(completed, frameCount)
                                }
                                frames[index] = cells
                            },
                        )
                    }
                }),
            )

            const repairFailure = repairResults.find((result) => result.status === 'rejected')
            if (repairFailure?.status === 'rejected') throw repairFailure.reason
        }
    } finally {
        for (const video of videos.slice(1)) {
            video.pause()
            video.removeAttribute('src')
            video.load()
        }
    }

    return frames.map((frame) => {
        if (!frame) throw new GuideArtConversionError('unsupported')
        return frame
    })
}

const getVideoDecodeWorkerCount = (
    source: Extract<GuideMediaSource, { kind: 'video' }>,
    frameCount: number,
) => {
    const hardwareWorkers = Math.max(1, (navigator.hardwareConcurrency || 2) - 2)
    const resolutionWorkers = Math.max(
        1,
        Math.floor(MAX_CONCURRENT_VIDEO_PIXELS / (source.width * source.height)),
    )
    return Math.min(frameCount, MAX_VIDEO_DECODE_WORKERS, hardwareWorkers, resolutionWorkers)
}

const decodeVideoWorkerByPlayback = async (
    video: HTMLVideoElement,
    from: number,
    to: number,
    start: number,
    frameDuration: number,
    captureFrame: (source: CanvasImageSource) => CellFrame,
    setFrame: (index: number, cells: CellFrame, coverStart: number) => void,
    onPresentedDelta: (delta: number) => void,
) => {
    await seekVideo(video, start + from * frameDuration)

    const playbackRate = clamp(
        VIDEO_DECODE_TARGET_CALLBACK_RATE * frameDuration,
        1,
        MAX_VIDEO_DECODE_PLAYBACK_RATE,
    )
    let index = from
    let pendingCells: CellFrame | undefined
    let pendingTime = Number.NEGATIVE_INFINITY

    await new Promise<void>((resolve, reject) => {
        let callbackId = 0
        let settled = false

        const cleanup = () => {
            if (callbackId) video.cancelVideoFrameCallback(callbackId)
            video.removeEventListener('ended', onEnded)
            video.removeEventListener('error', onError)
            video.pause()
            video.playbackRate = 1
        }
        const finish = () => {
            if (settled) return
            settled = true
            cleanup()
            resolve()
        }
        const fail = () => {
            if (settled) return
            settled = true
            cleanup()
            reject(new GuideArtConversionError('unsupported'))
        }
        // Assign every sample the latest frame presented at or before it, sharing one
        // captured cell frame across all samples it covers.
        const flushThrough = (mediaTime: number) => {
            const cells = pendingCells
            if (!cells) return

            while (index < to && start + (index + 0.5) * frameDuration < mediaTime) {
                setFrame(index, cells, pendingTime)
                index++
            }
        }
        const onEnded = () => {
            flushThrough(Number.POSITIVE_INFINITY)
            finish()
        }
        const onError = () => {
            fail()
        }
        const onVideoFrame = (_now: number, metadata: { mediaTime: number }): void => {
            if (pendingTime !== Number.NEGATIVE_INFINITY) {
                onPresentedDelta(metadata.mediaTime - pendingTime)
            }
            flushThrough(metadata.mediaTime)

            if (index >= to) {
                finish()
                return
            }

            pendingCells = captureFrame(video)
            pendingTime = metadata.mediaTime
            callbackId = video.requestVideoFrameCallback(onVideoFrame)
        }

        video.addEventListener('ended', onEnded)
        video.addEventListener('error', onError)
        video.playbackRate = playbackRate
        callbackId = video.requestVideoFrameCallback(onVideoFrame)
        void video.play().catch(fail)
    })
}

const decodeVideoWorkerBySeeking = async (
    video: HTMLVideoElement,
    from: number,
    to: number,
    start: number,
    frameDuration: number,
    captureFrame: (source: CanvasImageSource) => CellFrame,
    setFrame: (index: number, cells: CellFrame, coverStart: number) => void,
) => {
    for (let i = from; i < to; i++) {
        const sampleTime = start + (i + 0.5) * frameDuration
        await seekVideo(video, sampleTime)
        setFrame(i, captureFrame(video), sampleTime)
        if ((i - from) % 4 === 3) await nextFrame()
    }
}

const repairVideoRangeBySeeking = async (
    video: HTMLVideoElement,
    captureFrame: (source: CanvasImageSource) => CellFrame,
    first: number,
    last: number,
    sampleTimeAt: (index: number) => number,
    setFrame: (index: number, cells: CellFrame) => void,
) => {
    const captured = new Map<number, CellFrame>()
    const captureAt = async (index: number) => {
        let cells = captured.get(index)
        if (!cells) {
            await seekVideo(video, sampleTimeAt(index))
            cells = captureFrame(video)
            captured.set(index, cells)
        }
        return cells
    }

    // Capture both ends of a span; identical cells mean a still section one capture
    // can fill, otherwise bisect until every differing frame is captured.
    const fill = async (lo: number, hi: number): Promise<void> => {
        const loCells = await captureAt(lo)
        const hiCells = await captureAt(hi)
        setFrame(lo, loCells)
        setFrame(hi, hiCells)

        if (hi - lo <= 1) return

        if (hi - lo <= STATIC_REPAIR_FILL_MAX_FRAMES && isSameCellFrame(loCells, hiCells)) {
            for (let index = lo + 1; index < hi; index++) setFrame(index, loCells)
            return
        }

        const mid = (lo + hi) >> 1
        await fill(lo, mid)
        await fill(mid, hi)
    }

    await fill(first, last)
}

const isSameCellFrame = (a: CellFrame, b: CellFrame) =>
    isSameBytes(a.colors, b.colors) && isSameBytes(a.alphas, b.alphas)

const seekVideo = (video: HTMLVideoElement, time: number) =>
    new Promise<void>((resolve, reject) => {
        if (
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            Math.abs(video.currentTime - time) < 1e-4
        ) {
            resolve()
            return
        }

        const cleanup = () => {
            video.removeEventListener('seeked', onSeeked)
            video.removeEventListener('error', onError)
        }
        const onSeeked = () => {
            cleanup()
            resolve()
        }
        const onError = () => {
            cleanup()
            reject(new GuideArtConversionError('unsupported'))
        }

        video.addEventListener('seeked', onSeeked)
        video.addEventListener('error', onError)
        video.currentTime = time
    })

const createFrameCapturer = (columns: number, rows: number) => {
    const canvas = document.createElement('canvas')
    canvas.width = columns
    canvas.height = rows

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new GuideArtConversionError('unsupported')

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'

    return (source: CanvasImageSource): CellFrame => {
        context.clearRect(0, 0, columns, rows)
        context.drawImage(source, 0, 0, columns, rows)

        const data = context.getImageData(0, 0, columns, rows).data
        const colors = new Uint8Array(columns * rows)
        const alphas = new Uint8Array(columns * rows)

        for (let i = 0; i < colors.length; i++) {
            const offset = i * 4
            const sourceAlpha = (data[offset + 3] ?? 0) / 255
            if (sourceAlpha < 0.04) continue

            const r = data[offset] ?? 0
            const g = data[offset + 1] ?? 0
            const b = data[offset + 2] ?? 0

            const colorIndex = getClosestPaletteColorIndex(rgbToHsv(r, g, b))
            const entry = palette[colorIndex]
            if (!entry) throw new Error('Unexpected missing Guide palette')

            const opacity =
                colorIndex === blackPaletteIndex
                    ? sourceAlpha
                    : sourceAlpha * getPaletteOpacity(r, g, b, entry.rgb)

            colors[i] = colorIndex + 1
            alphas[i] = Math.round(
                clamp(opacity / GUIDE_ALPHA, 0, 2) * ALPHA_QUANT_STEPS * ALPHA_FINE_SCALE,
            )
        }

        return { colors, alphas }
    }
}

const quantizeCells = (frame: CellFrame, previous: QuantizedCells | undefined): QuantizedCells => {
    const colors = new Uint8Array(frame.colors)
    const steps = new Uint8Array(colors.length)

    for (let i = 0; i < colors.length; i++) {
        if (!colors[i]) continue

        const fine = frame.alphas[i] ?? 0
        let step = Math.round(fine / ALPHA_FINE_SCALE)

        // Keep the previous frame's level while the raw value stays close to it, so
        // noise does not flicker cells between adjacent levels and defeat frame merging.
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

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false
    }

    return true
}

type ActiveGuideArtRun = {
    index: number
    lastStep: number
    stepDelta: number | undefined
}

const packQuantizedCells = (
    { colors, steps }: QuantizedCells,
    columns: number,
    rows: number,
): GuideArtFrame => {
    const rects: GuideArtRect[] = []
    let active = new Map<string, ActiveGuideArtRun>()

    for (let y = 0; y < rows; y++) {
        const nextActive = new Map<string, ActiveGuideArtRun>()

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

            const key = `${x}:${end}:${color}`
            const run = active.get(key)
            const bottom = 1 - (y + 1) / rows
            let merged = false

            // Rows with the same span whose alpha changes at a constant small rate
            // merge into one rect rendered as a gradient between its end alphas.
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
                rects.push({
                    left: x / columns,
                    width: (end - x) / columns,
                    bottom,
                    height: 1 / rows,
                    color: paletteColorAt(color - 1),
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

const paletteColorAt = (index: number) => {
    const entry = palette[index]
    if (!entry) throw new Error('Unexpected missing Guide palette')
    return entry.color
}

const blackPaletteIndex = palette.findIndex(({ color }) => color === 'black')
const neutralPaletteIndex = palette.findIndex(({ color }) => color === 'neutral')
const purplePaletteIndex = palette.findIndex(({ color }) => color === 'purple')

const getClosestPaletteColorIndex = (source: { h: number; s: number; v: number }) => {
    if (source.v < 0.22) return blackPaletteIndex
    if (source.s < 0.08) return neutralPaletteIndex

    if (source.v < 0.65 && source.s < 0.4 && source.h >= 260) {
        return purplePaletteIndex
    }

    let closest = -1
    let closestDistance = Number.POSITIVE_INFINITY

    for (const [index, entry] of palette.entries()) {
        if (index === blackPaletteIndex || index === neutralPaletteIndex) continue

        const distance = Math.min(
            Math.abs(source.h - entry.hsv.h),
            360 - Math.abs(source.h - entry.hsv.h),
        )
        if (distance >= closestDistance) continue

        closest = index
        closestDistance = distance
    }

    return closest
}

const getPaletteOpacity = (
    r: number,
    g: number,
    b: number,
    target: { r: number; g: number; b: number },
) =>
    clamp(
        (r * target.r + g * target.g + b * target.b) /
            (target.r * target.r + target.g * target.g + target.b * target.b),
        0,
        1,
    )

function hexToRgb(hex: string) {
    const value = Number.parseInt(hex.slice(1), 16)
    return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff,
    }
}

function rgbToHsv(r: number, g: number, b: number) {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    let h = 0

    if (delta && max === r) h = 60 * (((g - b) / delta) % 6)
    else if (delta && max === g) h = 60 * ((b - r) / delta + 2)
    else if (delta) h = 60 * ((r - g) / delta + 4)

    return {
        h: h < 0 ? h + 360 : h,
        s: max ? delta / max : 0,
        v: max / 255,
    }
}

const nextFrame = () =>
    new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
            resolve()
        }),
    )
