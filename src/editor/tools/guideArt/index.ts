import type { Tool } from '..'
import { switchToolTo } from '..'
import { addToGroups, type GroupId, type GroupObject } from '../../../chart/groups'
import { pushState, state } from '../../../history'
import { bpms } from '../../../history/bpms'
import { defaultGroupId } from '../../../history/groups'
import { defaultStageId } from '../../../history/stages'
import { i18n } from '../../../i18n'
import {
    APPROACH_SCALE,
    FIELD_B_FACTOR,
    FIELD_T_FACTOR,
    FIELD_W_FACTOR,
    TARGET_ASPECT_RATIO,
} from '../../../preview/engine/layout'
import { preemptTime } from '../../../preview/engine/timescale'
import { settings } from '../../../settings'
import type { TimeScaleEntity } from '../../../state/entities/timeScale'
import { findIntegral } from '../../../state/integrals'
import { beatToTime, timeToBeat } from '../../../state/integrals/bpms'
import { addTimeScale } from '../../../state/mutations/timeScale'
import type { StoredGuideArt } from '../../../state/store/guideArt'
import { createTransaction, type Transaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import { clamp, lerp, unlerp } from '../../../utils/math'
import { notify } from '../../notification'
import type { PreparedGuideArt } from '../../utilities/guideArt/media'
import { view, xToValidLane, yToValidBeat } from '../../view'

const VIDEO_FRAME_TRANSITION_DURATION = 1 / 240
const VIDEO_FRAME_SCALED_ADVANCE_PREEMPT_FACTOR = 1.1
const VIDEO_FRAME_SWEEP_OVERSHOOT_FACTOR = 1.05
const IMAGE_INSTANT_TRANSITION_DURATION = 1 / 1000

let prepared: PreparedGuideArt | undefined

export const prepareGuideArtPlacement = (value: PreparedGuideArt) => {
    prepared = value
}

export const guideArt: Tool = {
    title: () => i18n.value.tools.guideArt.title,

    tap(x, y) {
        if (!prepared) {
            switchToolTo('select')
            return
        }

        const groupId = view.groupId ?? defaultGroupId.value
        const placement = getGuideArtPlacement(prepared)
        const videoFrameDuration = prepared.frameDuration ?? 0
        if (prepared.kind === 'video' && !(videoFrameDuration > 0))
            throw new Error('Unexpected missing Guide art frame duration')

        const videoFrameEnds = prepared.frameEnds ?? []
        if (prepared.kind === 'video' && videoFrameEnds.length !== prepared.frames.length)
            throw new Error('Unexpected missing Guide art frame ends')
        const videoTotalFrames = videoFrameEnds.at(-1) ?? 0

        const anchorBeat = yToValidBeat(y)
        const anchorTime = beatToTime(bpms.value, anchorBeat)
        const anchorLane = xToValidLane(x) - placement.widthLanes / 2
        const entranceDuration = prepared.kind === 'image' ? (prepared.entranceDuration ?? 0) : 0
        const holdDuration = prepared.kind === 'image' ? (prepared.holdDuration ?? 0) : 0
        const exitDuration =
            prepared.kind === 'image'
                ? Math.max(prepared.exitDuration ?? 0, IMAGE_INSTANT_TRANSITION_DURATION)
                : 0
        const videoTransitionDuration = Math.min(
            videoFrameDuration / 4,
            VIDEO_FRAME_TRANSITION_DURATION,
        )
        const endTime =
            prepared.kind === 'image'
                ? anchorTime + entranceDuration + holdDuration + exitDuration
                : anchorTime + videoTotalFrames * videoFrameDuration + videoTransitionDuration

        if (hasOverlappingTimeScale(groupId, anchorBeat, endTime)) {
            notify(() => i18n.value.tools.guideArt.overlappingTimeScale)
            return
        }

        const videoCompatibility = prepared.kind === 'video' && (prepared.compatibility ?? false)

        let altGroupId: GroupId | undefined
        let altGroupObject: GroupObject | undefined
        if (prepared.kind === 'video') {
            if (videoCompatibility) {
                altGroupId = groupId
            } else {
                const probe = new Map(state.value.groups)
                ;[altGroupId] = addToGroups(probe, undefined, {
                    forceNoteSpeed: placement.forceNoteSpeed,
                })
                altGroupObject = probe.get(altGroupId)
            }
        }

        const transaction = createTransaction(state.value)
        const stageId = view.stageId ?? defaultStageId.value
        const segmentCount = prepared.frames.reduce((count, frame) => count + frame.rects.length, 0)
        let storedGuideArt: StoredGuideArt

        if (prepared.kind === 'image') {
            const exitStart = anchorTime + entranceDuration + holdDuration

            storedGuideArt = {
                kind: 'image',
                groupId,
                stageId,
                anchorLane,
                widthLanes: placement.widthLanes,
                layer: prepared.layer,
                sourceBpms: bpms.value,
                frames: prepared.frames,
                exitStartTime: exitStart,
                exitDuration,
            }
        } else {
            if (altGroupId === undefined) throw new Error('Unexpected missing Guide art alt group')

            const frameDuration = videoFrameDuration
            const transitionDuration = videoTransitionDuration
            // Each frame's segments are laid out by a sweep right after its display
            // span, while its group is hidden and the other group shows the next
            // frame, so no transition state is ever rendered. Compatibility mode uses
            // neither hiding nor skips: one visible sweep covers the whole advance,
            // scrolling the outgoing frame off and the next frame in.
            const sweepScaled = placement.scaledFrameDuration * VIDEO_FRAME_SWEEP_OVERSHOOT_FACTOR
            const skipScaled = placement.preempt * VIDEO_FRAME_SCALED_ADVANCE_PREEMPT_FACTOR
            const videoSweepScaled = videoCompatibility ? sweepScaled + skipScaled : sweepScaled
            const videoSkipScaled = videoCompatibility ? 0 : skipScaled
            const frameRenderDuration =
                transitionDuration * (placement.scaledFrameDuration / videoSweepScaled)

            storedGuideArt = {
                kind: 'video',
                groupId,
                altGroupId,
                stageId,
                anchorLane,
                widthLanes: placement.widthLanes,
                layer: prepared.layer,
                sourceBpms: bpms.value,
                frames: prepared.frames,
                anchorTime,
                frameDuration,
                frameEnds: videoFrameEnds,
                transitionDuration,
                frameRenderDuration,
            }

            addVideoGuideArtTimeScales(
                transaction,
                groupId,
                altGroupId,
                videoCompatibility,
                anchorLane,
                anchorBeat,
                anchorTime,
                endTime,
                videoFrameEnds,
                frameDuration,
                transitionDuration,
                videoSweepScaled,
                videoSkipScaled,
            )
        }

        if (prepared.kind === 'image')
            addImageGuideArtTimeScales(
                transaction,
                groupId,
                anchorLane,
                anchorBeat,
                anchorTime,
                endTime,
                entranceDuration,
                exitDuration,
                placement.preempt,
                placement.scaledFrameDuration,
            )

        const committed = transaction.commit([])
        const groups = new Map(committed.groups)
        const group = groups.get(groupId)
        if (!group) throw new Error('Unexpected missing Guide art group')

        if (placement.forceNoteSpeed > 0) {
            groups.set(groupId, {
                ...group,
                forceNoteSpeed: placement.forceNoteSpeed,
            })
        }
        if (altGroupId !== undefined && altGroupObject) {
            groups.set(altGroupId, altGroupObject)
        }

        pushState(() => i18n.value.tools.guideArt.placed, {
            ...committed,
            store: {
                ...committed.store,
                guideArts: [...committed.store.guideArts, storedGuideArt],
            },
            groups,
        })

        const heightBeats = timeToBeat(bpms.value, endTime) - anchorBeat
        notify(
            interpolate(
                () => i18n.value.tools.guideArt.placedSegments,
                `${segmentCount}`,
                formatMetric(placement.widthLanes),
                formatMetric(heightBeats),
                formatMetric(placement.noteSpeed),
            ),
        )

        prepared = undefined
        switchToolTo('select')
    },
}

const hasOverlappingTimeScale = (groupId: GroupId, anchorBeat: number, endTime: number) => {
    const endBeat = timeToBeat(bpms.value, endTime)
    const epsilon = 1e-6

    return getGroupTimeScales(groupId).some(
        ({ beat }) => beat >= anchorBeat - epsilon && beat <= endBeat + epsilon,
    )
}

const addImageGuideArtTimeScales = (
    transaction: Transaction,
    groupId: GroupId,
    editorLane: number,
    anchorBeat: number,
    anchorTime: number,
    endTime: number,
    entranceDuration: number,
    exitDuration: number,
    preempt: number,
    scaledFrameDuration: number,
) => {
    const changes = getGroupTimeScales(groupId).sort((a, b) => a.beat - b.beat)
    const previous = [...changes].reverse().find(({ beat }) => beat < anchorBeat)

    if (previous?.timeScaleEase === 'linear') {
        const guardBeat = Math.max(
            previous.beat + (anchorBeat - previous.beat) / 2,
            anchorBeat - 1 / 480,
        )
        const guard = getOriginalTimeScaleAt(changes, guardBeat)

        addTimeScale(transaction, {
            groupId,
            beat: guardBeat,
            editorLane,
            timeScale: guard.timeScale,
            skip: 0,
            timeScaleEase: 'none',
            hideNotes: guard.hideNotes,
        })
    }

    if (entranceDuration > 0) {
        addTimeScale(transaction, {
            groupId,
            beat: anchorBeat,
            editorLane,
            timeScale: preempt / entranceDuration,
            skip: 0,
            timeScaleEase: 'none',
            hideNotes: false,
        })
    } else {
        const secondsPerBeat = findIntegral(bpms.value, 'x', Math.max(0, anchorBeat)).s

        addTimeScale(transaction, {
            groupId,
            beat: anchorBeat,
            editorLane,
            timeScale: 0,
            skip: preempt / secondsPerBeat,
            timeScaleEase: 'none',
            hideNotes: false,
        })
    }

    const holdStartTime = anchorTime + entranceDuration

    addTimeScale(transaction, {
        groupId,
        beat: timeToBeat(bpms.value, holdStartTime),
        editorLane,
        timeScale: 0,
        skip: 0,
        timeScaleEase: 'none',
        hideNotes: false,
    })

    const exitStartTime = endTime - exitDuration

    addTimeScale(transaction, {
        groupId,
        beat: timeToBeat(bpms.value, exitStartTime),
        editorLane,
        timeScale: scaledFrameDuration / exitDuration,
        skip: 0,
        timeScaleEase: 'none',
        hideNotes: false,
    })

    const endBeat = timeToBeat(bpms.value, endTime)
    const restore = getOriginalTimeScaleAt(changes, endBeat)

    addTimeScale(transaction, {
        groupId,
        beat: endBeat,
        editorLane,
        timeScale: restore.timeScale,
        skip: 0,
        timeScaleEase: restore.timeScaleEase,
        hideNotes: restore.hideNotes,
    })
}

const addVideoGuideArtTimeScales = (
    transaction: Transaction,
    groupId: GroupId,
    altGroupId: GroupId,
    compatibility: boolean,
    editorLane: number,
    anchorBeat: number,
    anchorTime: number,
    endTime: number,
    frameEnds: number[],
    frameDuration: number,
    transitionDuration: number,
    sweepScaled: number,
    skipScaled: number,
) => {
    const changes = getGroupTimeScales(groupId).sort((a, b) => a.beat - b.beat)
    const previous = [...changes].reverse().find(({ beat }) => beat < anchorBeat)

    if (previous?.timeScaleEase === 'linear') {
        const guardBeat = Math.max(
            previous.beat + (anchorBeat - previous.beat) / 2,
            anchorBeat - 1 / 480,
        )
        const guard = getOriginalTimeScaleAt(changes, guardBeat)

        addTimeScale(transaction, {
            groupId,
            beat: guardBeat,
            editorLane,
            timeScale: guard.timeScale,
            skip: 0,
            timeScaleEase: 'none',
            hideNotes: guard.hideNotes,
        })
    }

    addTimeScale(transaction, {
        groupId,
        beat: anchorBeat,
        editorLane,
        timeScale: 0,
        skip: 0,
        timeScaleEase: 'none',
        hideNotes: false,
    })
    if (!compatibility) {
        addTimeScale(transaction, {
            groupId: altGroupId,
            beat: anchorBeat,
            editorLane,
            timeScale: 0,
            skip: 0,
            timeScaleEase: 'none',
            hideNotes: true,
        })
    }

    const transitionTimeScale = sweepScaled / transitionDuration
    const skipAt = (beat: number) => skipScaled / findIntegral(bpms.value, 'x', Math.max(0, beat)).s
    const groupAt = (frameIndex: number) => (frameIndex % 2 === 1 ? altGroupId : groupId)

    for (const [frameIndex, frameEndOffset] of frameEnds.entries()) {
        const displayEnd = anchorTime + frameEndOffset * frameDuration
        const displayEndBeat = timeToBeat(bpms.value, displayEnd)

        // The frame's group lays its segments out right after its display span. In
        // dual group mode it hides meanwhile and the other group shows the next
        // frame, so no transition state is ever visible; in compatibility mode the
        // sweep stays visible, scrolling the outgoing frame off and the next frame
        // in.
        addTimeScale(transaction, {
            groupId: groupAt(frameIndex),
            beat: displayEndBeat,
            editorLane,
            timeScale: transitionTimeScale,
            skip: 0,
            timeScaleEase: 'none',
            hideNotes: !compatibility,
        })

        if (frameIndex + 1 < frameEnds.length) {
            if (compatibility) {
                const sweepEndBeat = timeToBeat(bpms.value, displayEnd + transitionDuration)

                addTimeScale(transaction, {
                    groupId,
                    beat: sweepEndBeat,
                    editorLane,
                    timeScale: 0,
                    skip: skipAt(sweepEndBeat),
                    timeScaleEase: 'none',
                    hideNotes: false,
                })
            } else {
                addTimeScale(transaction, {
                    groupId: groupAt(frameIndex),
                    beat: timeToBeat(bpms.value, displayEnd + transitionDuration),
                    editorLane,
                    timeScale: 0,
                    skip: 0,
                    timeScaleEase: 'none',
                    hideNotes: true,
                })
                addTimeScale(transaction, {
                    groupId: groupAt(frameIndex + 1),
                    beat: displayEndBeat,
                    editorLane,
                    timeScale: 0,
                    skip: skipAt(displayEndBeat),
                    timeScaleEase: 'none',
                    hideNotes: false,
                })
            }
        }
    }

    const endBeat = timeToBeat(bpms.value, endTime)
    const restore = getOriginalTimeScaleAt(changes, endBeat)

    addTimeScale(transaction, {
        groupId,
        beat: endBeat,
        editorLane,
        timeScale: restore.timeScale,
        skip: 0,
        timeScaleEase: restore.timeScaleEase,
        hideNotes: restore.hideNotes,
    })
    if (!compatibility) {
        addTimeScale(transaction, {
            groupId: altGroupId,
            beat: endBeat,
            editorLane,
            timeScale: 1,
            skip: 0,
            timeScaleEase: 'none',
            hideNotes: false,
        })
    }
}

const getGuideArtPlacement = (value: PreparedGuideArt) => {
    const aspectRatio = value.aspectRatio
    const fieldWidth = 2 * TARGET_ASPECT_RATIO
    const fieldHeight = 2
    const laneScreenWidth = fieldWidth * FIELD_W_FACTOR
    const travelScreenHeight = fieldHeight * (FIELD_T_FACTOR - FIELD_B_FACTOR)
    const widthLanes = value.widthLanes

    // The stage narrows toward the horizon, so comparing the image height with its
    // bottom width makes wide art consume the entire approach range. Match the source
    // ratio against the projected width at the image's vertical center instead.
    const targetHeightAtCenter = widthLanes * laneScreenWidth * aspectRatio
    const centerDepth =
        (Math.sqrt(targetHeightAtCenter ** 2 + 4 * travelScreenHeight ** 2) -
            targetHeightAtCenter) /
        (2 * travelScreenHeight)
    const topDepth = clamp(centerDepth ** 2, APPROACH_SCALE, 1)
    const progressSpan = Math.max(1e-6, Math.log(topDepth) / Math.log(APPROACH_SCALE))

    const editorFrameDuration =
        value.kind === 'image'
            ? (widthLanes * view.w * aspectRatio) / settings.width / settings.pps
            : (value.frameDuration ?? 0)
    if (!(editorFrameDuration > 0)) throw new Error('Unexpected invalid Guide art duration')

    const defaultPreempt = preemptTime(6, 6)

    // Compatibility mode leaves the group's note speed untouched and fits the art
    // for the entered reference speed instead, so it displays correctly when played
    // at that speed.
    const isCompatibility = value.kind === 'video' && (value.compatibility ?? false)
    const noteSpeed = isCompatibility
        ? clamp(value.compatibilityNoteSpeed ?? 6, 1, 12)
        : preemptToNoteSpeed(Math.max(defaultPreempt, editorFrameDuration / progressSpan))
    const forceNoteSpeed = isCompatibility ? 0 : noteSpeed
    const preempt = preemptTime(noteSpeed, 0)
    const scaledFrameDuration = preempt * progressSpan

    return {
        widthLanes,
        editorFrameDuration,
        noteSpeed,
        forceNoteSpeed,
        preempt,
        scaledFrameDuration,
    }
}

const preemptToNoteSpeed = (preempt: number) => {
    const normalized = clamp((preempt - 0.35) / (4 - 0.35), 0, 1)
    const speed = 12 - 11 * normalized ** (1 / 1.31)
    return Math.round(clamp(speed, 1, 12) * 1000) / 1000
}

const formatMetric = (value: number) => `${Math.round(value * 100) / 100}`

const getOriginalTimeScaleAt = (changes: TimeScaleEntity[], beat: number) => {
    let previousIndex = -1
    for (let i = changes.length - 1; i >= 0; i--) {
        if ((changes[i]?.beat ?? Number.POSITIVE_INFINITY) > beat) continue
        previousIndex = i
        break
    }
    const previous = changes[previousIndex]
    if (!previous)
        return {
            timeScale: 1,
            timeScaleEase: 'none' as const,
            hideNotes: false,
        }

    const next = changes[previousIndex + 1]
    const timeScale =
        previous.timeScaleEase === 'linear' && next
            ? lerp(
                  previous.timeScale,
                  next.timeScale,
                  unlerp(
                      beatToTime(bpms.value, previous.beat),
                      beatToTime(bpms.value, next.beat),
                      beatToTime(bpms.value, beat),
                  ),
              )
            : previous.timeScale

    return {
        timeScale,
        timeScaleEase: previous.timeScaleEase,
        hideNotes: previous.hideNotes,
    }
}

const getGroupTimeScales = (groupId: GroupId) => {
    const result = new Set<TimeScaleEntity>()

    for (const entities of state.value.store.grid.timeScale.values()) {
        for (const entity of entities) {
            if (entity.groupId === groupId) result.add(entity)
        }
    }

    return [...result]
}
