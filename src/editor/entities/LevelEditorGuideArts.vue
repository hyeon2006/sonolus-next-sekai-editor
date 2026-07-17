<script setup lang="ts">
import { computed } from 'vue'
import { beats } from '..'
import { bpms } from '../../history/bpms'
import { store } from '../../history/store'
import { settings } from '../../settings'
import { beatToTime } from '../../state/integrals/bpms'
import {
    getGuideArtFrameBeatRange,
    getGuideArtSegmentBeats,
    type StoredGuideArt,
} from '../../state/store/guideArt'
import { guideColors } from '../../utils/colors'
import { ups, view } from '../view'

// Segment beats depend only on the guide art itself (via its embedded source bpms),
// so they are cached per guide art object to avoid recomputing them on every scroll.
const segmentBeatsCache = new WeakMap<
    StoredGuideArt,
    ({ head: number; tail: number }[] | undefined)[]
>()

const getFrameSegmentBeats = (guideArt: StoredGuideArt, frameIndex: number) => {
    let frames = segmentBeatsCache.get(guideArt)
    if (!frames) {
        frames = Array.from({ length: guideArt.frames.length }, () => undefined)
        segmentBeatsCache.set(guideArt, frames)
    }

    let segments = frames[frameIndex]
    if (!segments) {
        segments = (guideArt.frames[frameIndex]?.rects ?? []).map((rect) =>
            getGuideArtSegmentBeats(guideArt, frameIndex, rect),
        )
        frames[frameIndex] = segments
    }

    return segments
}

const graphics = computed(() => {
    const result: {
        key: string
        x: number
        y: number
        width: number
        height: number
        fill: string
        opacity: number
    }[] = []

    for (const [guideArtIndex, guideArt] of store.value.guideArts.entries()) {
        const isVisibleByGroup =
            view.groupId === undefined ||
            guideArt.groupId === view.groupId ||
            (guideArt.kind === 'video' && guideArt.altGroupId === view.groupId)
        const isVisibleByStage = view.stageId === undefined || guideArt.stageId === view.stageId
        const isVisibleByType = view.visibilities.connector

        if (!settings.showOtherGroups && !isVisibleByGroup) continue
        if (!settings.showOtherStages && !isVisibleByStage) continue
        if (!settings.showOtherObjects && !isVisibleByType) continue

        const opacity = isVisibleByGroup && isVisibleByStage && isVisibleByType ? 1 : 0.25
        const frameCount = guideArt.frames.length
        const from = findFirstGreaterBy(
            frameCount,
            (frameIndex) => getGuideArtFrameBeatRange(guideArt, frameIndex).end,
            beats.value.min,
        )
        const to = findFirstGreaterBy(
            frameCount,
            (frameIndex) => getGuideArtFrameBeatRange(guideArt, frameIndex).start,
            beats.value.max,
        )

        for (let frameIndex = from; frameIndex < to; frameIndex++) {
            const frame = guideArt.frames[frameIndex]
            if (!frame) continue

            const segments = getFrameSegmentBeats(guideArt, frameIndex)

            for (const [rectIndex, rect] of frame.rects.entries()) {
                const segment = segments[rectIndex]
                if (!segment) continue
                if (segment.head > beats.value.max || segment.tail < beats.value.min) continue

                const headY = beatToTime(bpms.value, segment.head) * ups.value
                const tailY = beatToTime(bpms.value, segment.tail) * ups.value

                result.push({
                    key: `${guideArtIndex}:${frameIndex}:${rectIndex}`,
                    x: guideArt.anchorLane + rect.left * guideArt.widthLanes,
                    y: tailY,
                    width: rect.width * guideArt.widthLanes,
                    height: headY - tailY,
                    fill: guideColors[rect.color],
                    opacity: opacity * ((rect.headAlpha + rect.tailAlpha) / 2) * 0.5,
                })
            }
        }
    }

    return result
})

const findFirstGreaterBy = (length: number, valueAt: (index: number) => number, target: number) => {
    let lo = 0
    let hi = length

    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (valueAt(mid) <= target) {
            lo = mid + 1
        } else {
            hi = mid
        }
    }

    return lo
}
</script>

<template>
    <g class="pointer-events-none">
        <rect
            v-for="graphic in graphics"
            :key="graphic.key"
            :x="graphic.x"
            :y="graphic.y"
            :width="graphic.width"
            :height="graphic.height"
            :fill="graphic.fill"
            :fill-opacity="graphic.opacity"
        />
    </g>
</template>
