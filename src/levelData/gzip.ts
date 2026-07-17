import type { LevelData, LevelDataEntity } from '@sonolus/core'
import { Deflate } from 'pako'

const JSON_CHUNK_SIZE = 1024 * 1024
const GZIP_CHUNK_SIZE = 256 * 1024
const FALLBACK_COMPRESSION_LEVEL = 1

type IterableLevelData = Omit<LevelData, 'entities'> & {
    entities: Iterable<LevelDataEntity | string>
}

export const gzipLevelData = async (levelData: IterableLevelData) => {
    if (typeof CompressionStream !== 'undefined') {
        return await collectChunks(createGzipStream(levelData))
    }

    return await gzipLevelDataWithPako(levelData)
}

export const writeGzipLevelData = async (
    levelData: IterableLevelData,
    writable: FileSystemWritableFileStream,
) => {
    if (typeof CompressionStream !== 'undefined') {
        await createGzipStream(levelData).pipeTo(writable)
        return
    }

    const chunks = await gzipLevelDataWithPako(levelData)
    await writable.write(new Blob(chunks, { type: 'application/octet-stream' }))
    await writable.close()
}

const createGzipStream = (levelData: IterableLevelData) =>
    createJsonStream(levelData).pipeThrough(new CompressionStream('gzip'))

const createJsonStream = (levelData: IterableLevelData) => {
    const encoder = new TextEncoder()
    const chunks = iterateLevelDataJson(levelData)

    return new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(controller) {
            const result = chunks.next()
            if (result.done) {
                controller.close()
            } else {
                controller.enqueue(encoder.encode(result.value))
            }
        },
        cancel() {
            chunks.return()
        },
    })
}

const collectChunks = async (stream: ReadableStream<Uint8Array<ArrayBuffer>>) => {
    const chunks: Uint8Array<ArrayBuffer>[] = []
    const reader = stream.getReader()

    while (true) {
        const result = await reader.read()
        if (result.done) return chunks
        chunks.push(result.value)
    }
}

const gzipLevelDataWithPako = async (levelData: IterableLevelData) => {
    const chunks: Uint8Array<ArrayBuffer>[] = []
    const deflate = new Deflate({
        gzip: true,
        level: FALLBACK_COMPRESSION_LEVEL,
        chunkSize: GZIP_CHUNK_SIZE,
    })
    deflate.onData = (chunk) => {
        chunks.push(chunk)
    }

    for (const json of iterateLevelDataJson(levelData)) {
        if (!deflate.push(json, false)) throw new Error(deflate.msg)
        await yieldToBrowser()
    }

    if (!deflate.push('', true) || deflate.err) throw new Error(deflate.msg)

    return chunks
}

function* iterateLevelDataJson(levelData: IterableLevelData) {
    let json = `{"bgmOffset":${JSON.stringify(levelData.bgmOffset)},"entities":[`
    let index = 0

    for (const entity of levelData.entities) {
        const serialized = typeof entity === 'string' ? entity : JSON.stringify(entity)
        const next = `${index ? ',' : ''}${serialized}`

        if (json && json.length + next.length > JSON_CHUNK_SIZE) {
            yield json
            json = ''
        }
        json += next
        index++
    }

    yield `${json}]}`
}

const yieldToBrowser = () =>
    new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'undefined') {
            setTimeout(resolve)
        } else {
            requestAnimationFrame(() => {
                resolve()
            })
        }
    })
