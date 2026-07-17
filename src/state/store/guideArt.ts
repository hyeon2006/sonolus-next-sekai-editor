import type { GroupId } from '../../chart/groups'
import type { ConnectorGuideColor, ConnectorLayer } from '../../chart/note'
import type { StageId } from '../../chart/stages'
import type { BpmIntegral } from '../integrals/bpms'
import { timeToBeat } from '../integrals/bpms'

export type StoredGuideArtRect = {
    left: number
    width: number
    bottom: number
    height: number
    color: ConnectorGuideColor
    // Alpha at each end of the segment; the engine interpolates linearly between
    // them, which lets rows with a constant alpha slope merge into one rect.
    headAlpha: number
    tailAlpha: number
}

export type StoredGuideArtFrame = {
    rects: StoredGuideArtRect[]
}

type StoredGuideArtBase = {
    groupId: GroupId
    stageId: StageId
    anchorLane: number
    widthLanes: number
    layer: ConnectorLayer
    sourceBpms: BpmIntegral[]
    frames: StoredGuideArtFrame[]
}

export type StoredGuideArt =
    | (StoredGuideArtBase & {
          kind: 'image'
          exitStartTime: number
          exitDuration: number
      })
    | (StoredGuideArtBase & {
          kind: 'video'
          // Odd frames live in this second group; the two groups alternate so each
          // one lays its segments out while hidden and the other one is displayed.
          altGroupId: GroupId
          anchorTime: number
          frameDuration: number
          // Cumulative source frame count at the end of each stored frame; identical
          // consecutive source frames are merged into one stored frame spanning them.
          frameEnds: number[]
          transitionDuration: number
          frameRenderDuration: number
      })

export const getGuideArtFrameTimeRange = (guideArt: StoredGuideArt, frameIndex: number) => {
    if (guideArt.kind === 'image') {
        return {
            start: guideArt.exitStartTime,
            end: guideArt.exitStartTime + guideArt.exitDuration,
        }
    }

    // Video frame segments are laid out in a hidden sweep right after the frame's
    // display span ends.
    const displayEnd =
        guideArt.anchorTime +
        (guideArt.frameEnds[frameIndex] ?? frameIndex + 1) * guideArt.frameDuration
    return {
        start: displayEnd,
        end: displayEnd + guideArt.transitionDuration,
    }
}

export const getGuideArtFrameGroupId = (guideArt: StoredGuideArt, frameIndex: number) =>
    guideArt.kind === 'video' && frameIndex % 2 === 1 ? guideArt.altGroupId : guideArt.groupId

export const getGuideArtFrameBeatRange = (guideArt: StoredGuideArt, frameIndex: number) => {
    const { start, end } = getGuideArtFrameTimeRange(guideArt, frameIndex)
    return {
        start: timeToBeat(guideArt.sourceBpms, start),
        end: timeToBeat(guideArt.sourceBpms, end),
    }
}

export const getGuideArtSegmentBeats = (
    guideArt: StoredGuideArt,
    frameIndex: number,
    rect: StoredGuideArtRect,
) => {
    const { start } = getGuideArtFrameTimeRange(guideArt, frameIndex)
    const duration =
        guideArt.kind === 'image' ? guideArt.exitDuration : guideArt.frameRenderDuration

    return {
        head: timeToBeat(guideArt.sourceBpms, start + rect.bottom * duration),
        tail: timeToBeat(guideArt.sourceBpms, start + (rect.bottom + rect.height) * duration),
    }
}

export const countGuideArtSegments = (guideArts: readonly StoredGuideArt[]) => {
    let count = 0
    for (const guideArt of guideArts) {
        for (const frame of guideArt.frames) count += frame.rects.length
    }
    return count
}
