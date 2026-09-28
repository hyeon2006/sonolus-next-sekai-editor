/// <reference lib="webworker" />

import { packCellFrames, type CellFrame, type PackedGuideArt } from './pack'

type Request = {
    cellFrames: CellFrame[]
    columns: number
    rows: number
}

type Response =
    | { type: 'progress'; current: number }
    | { type: 'complete'; packed: PackedGuideArt }
    | { type: 'error'; message: string }

self.onmessage = ({ data }: MessageEvent<Request>) => {
    try {
        const packed = packCellFrames(data.cellFrames, data.columns, data.rows, (current) => {
            self.postMessage({ type: 'progress', current } satisfies Response)
        })
        self.postMessage({ type: 'complete', packed } satisfies Response)
    } catch (error) {
        self.postMessage({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
        } satisfies Response)
    }
}

export {}
