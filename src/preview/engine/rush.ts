import { SkillEffect } from '../../chart/rushEvents'
import type { PreviewRenderer, ZKey } from '../gl'
import type { PreviewParticle } from '../particle'
import type { PreviewSkin, Sprite } from '../skin'
import { LAYER_STAGE, getZAlt } from './layer'
import {
    DynamicLayout,
    FIELD_B_FACTOR,
    FIELD_T_FACTOR,
    FIELD_W_FACTOR,
    LANE_B,
    LANE_T,
    Layout,
    approach,
    perspectiveRect,
    tiltDepth,
    tiltWidthFactor,
    transformQuad,
    type StageTransform,
} from './layout'
import {
    identityAffineTransform,
    lerp,
    transformQuadAffine,
    unlerpClamped,
    vec,
    type AffineTransform,
    type Quad,
    type Vec,
} from './math'
import type { PreviewChart, PreviewFever, PreviewSkill } from './model'
import { PARTICLE_LAYER, drawParticleEffect, hashSeed } from './particleDraw'
import type { StageProps } from './stage'

const LAYER_FEVER_GAUGE = LAYER_STAGE - 0.2
const LAYER_FEVER_SIDE = LAYER_STAGE + 0.1
const LAYER_SKILL_JUDGMENT = 4.8
const LAYER_SKILL_BAR = 24
const LAYER_SKILL_ETC = 25

const SKILL_GLYPH_MINUS = 12
const SKILL_GLYPH_L = 13
const SKILL_GLYPH_V = 14
const SKILL_GLYPH_DOT = 15
const SKILL_GLYPH_PERCENT = 16
const SKILL_GLYPH_SECOND = 17

const SKILL_GLYPH_WIDTH_FACTOR = 7
const SKILL_GLYPH_GAP_FACTOR = -4
const SKILL_LV_GAP_FACTOR = -6
const SKILL_DOT_GAP_FACTOR = -8
const SKILL_PERCENT_GAP_FACTOR = -3.75

const SKILL_BAR_BASE_X = -6.7
const SKILL_BAR_GROUP_OFFSET_X = -0.4
const SKILL_PREVIEW_OFFSET_X = 0.7
const SKILL_BAR_GROUP_OFFSET_Y = 0.01
const SKILL_BAR_H = 0.08
const SKILL_BAR_HALF_W = SKILL_BAR_H * 21
const SKILL_EDGE_MARGIN = 0.3
const SKILL_REF_TOP_EDGE = 0.05529

type FeverBoundary = {
    left: number
    right: number
    leftAlpha: number
    rightAlpha: number
    leftAffine: AffineTransform
    rightAffine: AffineTransform
}

export const drawRushEvents = (
    renderer: PreviewRenderer,
    skin: PreviewSkin,
    chart: PreviewChart,
    now: number,
    showEffects: boolean,
    stageProps: StageProps[],
    stageTransforms: StageTransform[],
    stageAffines: AffineTransform[],
    particle?: PreviewParticle,
) => {
    if (!showEffects) return

    const draw = renderer.draw

    for (const skill of chart.skills) {
        const elapsed = now - skill.time
        if (elapsed >= 0 && elapsed < 3) drawSkillBar(draw, skin, skill, elapsed)
        if (skill.effect === SkillEffect.judgment && elapsed >= 0 && elapsed < skill.duration) {
            drawSkillJudgment(
                draw,
                skin,
                chart,
                stageProps,
                stageTransforms,
                stageAffines,
                now,
                elapsed,
                skill.duration,
            )
        }
    }

    const fever = chart.fever
    if (!fever?.force) return

    const boundary = getFeverBoundary(chart, stageProps, stageAffines, now)
    if (!boundary) return

    const percentage = feverPercentageAt(fever, now)
    if (now >= fever.chanceTime && now < fever.startTime) {
        drawFeverGauge(
            draw,
            skin,
            boundary,
            percentage,
            now - fever.chanceTime,
            chart.isDynamicStages,
        )
    }

    if (!particle) return

    const chanceElapsed = now - fever.chanceTime
    const chanceParticleDuration = Math.max(
        particle.fever.chanceText?.duration ?? 0,
        particle.fever.chanceLane?.duration ?? 0,
    )
    if (chanceElapsed >= 0 && chanceElapsed < chanceParticleDuration) {
        drawFeverChanceParticles(draw, particle, boundary, chanceElapsed)
    }

    const startElapsed = now - fever.startTime
    const startPercentage = feverPercentageAt(fever, fever.startTime)
    const startParticleDuration = getFeverStartParticleDuration(particle, startPercentage)
    if (startElapsed >= 0 && startElapsed < startParticleDuration) {
        drawFeverStartParticles(draw, particle, boundary, startPercentage, startElapsed)
    }
}

const getFeverStartParticleDuration = (particle: PreviewParticle, percentage: number) => {
    if (percentage < 0.78) return 0

    const effects =
        percentage >= 0.9
            ? [
                  particle.fever.superFeverText,
                  particle.fever.superFeverLane,
                  particle.fever.superFeverEffect,
                  particle.fever.border,
              ]
            : [particle.fever.feverText, particle.fever.feverLane, particle.fever.border]

    return Math.max(0, ...effects.map((effect) => effect?.duration ?? 0))
}

const fixedLayoutInfo = () => {
    const t = Layout.fieldH * FIELD_T_FACTOR
    return {
        t,
        wScale: Layout.fieldW * FIELD_W_FACTOR,
        hScale: Layout.fieldH * (FIELD_B_FACTOR - FIELD_T_FACTOR),
    }
}

const transformFixedVec = (point: Vec): Vec => {
    const fixed = fixedLayoutInfo()
    return vec(point.x * fixed.wScale, point.y * fixed.hScale + fixed.t)
}

const fixedQuad = (center: Vec, halfWidth: number, halfHeight: number): Quad => ({
    bl: transformFixedVec(vec(center.x - halfWidth, center.y + halfHeight)),
    br: transformFixedVec(vec(center.x + halfWidth, center.y + halfHeight)),
    tl: transformFixedVec(vec(center.x - halfWidth, center.y - halfHeight)),
    tr: transformFixedVec(vec(center.x + halfWidth, center.y - halfHeight)),
})

const drawSkillBar = (
    draw: PreviewRenderer['draw'],
    skin: PreviewSkin,
    skill: PreviewSkill,
    elapsed: number,
) => {
    const enterProgress = unlerpClamped(0, 0.25, elapsed)
    const exitProgress = unlerpClamped(2.75, 3, elapsed)
    const animation = enterProgress - exitProgress

    const fixed = fixedLayoutInfo()
    const screenLeft = -Layout.screenW / 2
    const screenTop = Layout.screenH / 2
    const barCenterX =
        screenLeft / fixed.wScale +
        SKILL_BAR_HALF_W -
        SKILL_EDGE_MARGIN +
        SKILL_BAR_GROUP_OFFSET_X +
        SKILL_PREVIEW_OFFSET_X
    const xRatio = barCenterX - SKILL_BAR_BASE_X
    const yRatio = SKILL_REF_TOP_EDGE - (screenTop - fixed.t) / fixed.hScale

    const barCenter = vec(
        lerp(barCenterX - 0.2, barCenterX, animation),
        0.433 - yRatio + SKILL_BAR_GROUP_OFFSET_Y,
    )
    draw(
        skillBarSprite(skin, skill),
        fixedQuad(barCenter, SKILL_BAR_HALF_W, SKILL_BAR_H),
        getZAlt(LAYER_SKILL_BAR, skill.index),
        animation,
    )

    const iconTarget = vec(-7.5 + xRatio, 0.45 - yRatio + SKILL_BAR_GROUP_OFFSET_Y)
    const iconCenter = vec(lerp(iconTarget.x - 0.2, iconTarget.x, animation), iconTarget.y)
    draw(
        skin.skillIcons[skill.index % skin.skillIcons.length],
        fixedQuad(iconCenter, 0.045 * 7, 0.045),
        getZAlt(LAYER_SKILL_ETC, skill.index * 2),
        animation,
    )

    drawSkillNumber(draw, skin, skill, elapsed, enterProgress, exitProgress, xRatio, yRatio)
}

const skillBarSprite = (skin: PreviewSkin, skill: PreviewSkill): Sprite | undefined => {
    switch (skill.effect) {
        case SkillEffect.score:
            return skin.skillBarScore
        case SkillEffect.heal:
            return skin.skillBarLife
        case SkillEffect.judgment:
            return skin.skillBarJudgment
    }
}

const drawSkillNumber = (
    draw: PreviewRenderer['draw'],
    skin: PreviewSkin,
    skill: PreviewSkill,
    elapsed: number,
    enterProgress: number,
    exitProgress: number,
    xRatio: number,
    yRatio: number,
) => {
    if (!skin.skillNumbers[0]) return

    const target = vec(-5.52 + xRatio, 0.474 - yRatio + SKILL_BAR_GROUP_OFFSET_Y)
    const changing = vec(target.x + 0.1, target.y)
    const start = vec(target.x - 0.2, target.y)
    const midProgress = unlerpClamped(1.5, 1.75, elapsed)

    let currentStart: Vec
    let animation: number
    if (elapsed >= 1.5 && elapsed < 2.75) {
        currentStart = changing
        animation = midProgress
    } else if (elapsed < 1.5) {
        currentStart = start
        animation = enterProgress
    } else {
        currentStart = start
        animation = midProgress - exitProgress
    }
    const center = vec(
        lerp(currentStart.x, target.x, animation),
        lerp(currentStart.y, target.y, animation),
    )

    const glyphs = skillGlyphs(skill, elapsed <= 1.5)
    const h = 0.024
    const halfWidth = h * SKILL_GLYPH_WIDTH_FACTOR
    let totalWidth = glyphs.length * 2 * halfWidth
    for (let i = 0; i < glyphs.length - 1; i++) {
        const left = glyphs[i]
        const right = glyphs[i + 1]
        if (left === undefined || right === undefined) continue
        totalWidth += h * skillGapFactor(left, right)
    }

    let cursorX = center.x + h * 14 - totalWidth
    for (const [i, glyph] of glyphs.entries()) {
        draw(
            skin.skillNumbers[glyph],
            fixedQuad(vec(cursorX + halfWidth, center.y), halfWidth, h),
            getZAlt(LAYER_SKILL_ETC, skill.index * 2 + 1),
            animation,
        )
        cursorX += 2 * halfWidth
        const next = glyphs[i + 1]
        if (next !== undefined) cursorX += h * skillGapFactor(glyph, next)
    }
}

const skillGlyphs = (skill: PreviewSkill, showLevel: boolean): number[] => {
    if (showLevel) {
        return [SKILL_GLYPH_L, SKILL_GLYPH_V, SKILL_GLYPH_DOT, ...integerGlyphs(skill.level)]
    }

    switch (skill.effect) {
        case SkillEffect.score:
            return [...decimalGlyphs(skill.scale * 100), SKILL_GLYPH_PERCENT]
        case SkillEffect.heal:
            return integerGlyphs(skill.value)
        case SkillEffect.judgment:
            return [...decimalGlyphs(skill.duration), SKILL_GLYPH_SECOND]
    }
}

const integerGlyphs = (value: number): number[] => {
    const rounded = Math.trunc(value)
    const sign = rounded < 0 ? [SKILL_GLYPH_MINUS] : []
    const digits = `${Math.abs(rounded)}`.split('').map(Number)
    return [...sign, ...digits]
}

const decimalGlyphs = (value: number): number[] => {
    const scaled = Math.floor(Math.abs(value) * 10 + 0.5)
    const sign = value < 0 ? [SKILL_GLYPH_MINUS] : []
    const integer = Math.floor(scaled / 10)
    const decimal = scaled % 10
    return decimal
        ? [...sign, ...integerGlyphs(integer), SKILL_GLYPH_DOT, decimal]
        : [...sign, ...integerGlyphs(integer)]
}

const skillGapFactor = (left: number, right: number) => {
    if (left === SKILL_GLYPH_L && right === SKILL_GLYPH_V) return SKILL_LV_GAP_FACTOR

    const leftGap = skillGlyphGapFactor(left)
    const rightGap = skillGlyphGapFactor(right)
    return rightGap === SKILL_GLYPH_GAP_FACTOR ? leftGap : rightGap
}

const skillGlyphGapFactor = (glyph: number) =>
    glyph === SKILL_GLYPH_DOT
        ? SKILL_DOT_GAP_FACTOR
        : glyph === SKILL_GLYPH_PERCENT
          ? SKILL_PERCENT_GAP_FACTOR
          : SKILL_GLYPH_GAP_FACTOR

const drawSkillJudgment = (
    draw: PreviewRenderer['draw'],
    skin: PreviewSkin,
    chart: PreviewChart,
    stageProps: StageProps[],
    stageTransforms: StageTransform[],
    stageAffines: AffineTransform[],
    now: number,
    elapsed: number,
    duration: number,
) => {
    const animation =
        unlerpClamped(0, 0.25, elapsed) -
        unlerpClamped(Math.max(0, duration - 0.25), duration, elapsed)

    if (!chart.isDynamicStages) {
        draw(
            skin.skillJudgmentLine,
            skillJudgmentQuad(-6, 6, 0),
            getZAlt(LAYER_SKILL_JUDGMENT, 0),
            animation,
        )
        return
    }

    for (const [index, stage] of chart.stages.entries()) {
        if (now < stage.drawStartTime || now > stage.drawEndTime) continue
        const props = stageProps[index]
        if (!props) continue

        const quad = skillJudgmentQuad(
            props.lane - props.width,
            props.lane + props.width,
            props.yOffset,
        )
        draw(
            skin.skillJudgmentLine,
            transformQuadAffine(stageAffines[index] ?? identityAffineTransform, quad),
            getZAlt(LAYER_SKILL_JUDGMENT, stage.order),
            animation * props.judgeLineAlpha,
        )
    }

    void stageTransforms
}

const skillJudgmentQuad = (left: number, right: number, yOffset: number) => {
    const travel = approach(1 - yOffset)
    return perspectiveRect(left, right, 1 - DynamicLayout.noteH, 1 + DynamicLayout.noteH, travel)
}

const getFeverBoundary = (
    chart: PreviewChart,
    stageProps: StageProps[],
    stageAffines: AffineTransform[],
    now: number,
): FeverBoundary | undefined => {
    if (!chart.isDynamicStages) {
        return {
            left: -6,
            right: 6,
            leftAlpha: 1,
            rightAlpha: 1,
            leftAffine: identityAffineTransform,
            rightAffine: identityAffineTransform,
        }
    }

    let boundary: FeverBoundary | undefined
    for (const [index, stage] of chart.stages.entries()) {
        if (now < stage.drawStartTime || now > stage.drawEndTime) continue
        const props = stageProps[index]
        if (!props || props.laneAlpha <= 0) continue

        const left = props.lane - props.width
        const right = props.lane + props.width
        const affine = stageAffines[index] ?? identityAffineTransform
        if (!boundary) {
            boundary = {
                left,
                right,
                leftAlpha: props.laneAlpha,
                rightAlpha: props.laneAlpha,
                leftAffine: affine,
                rightAffine: affine,
            }
            continue
        }

        if (
            left < boundary.left ||
            (left === boundary.left && props.laneAlpha > boundary.leftAlpha)
        ) {
            boundary.left = left
            boundary.leftAlpha = props.laneAlpha
            boundary.leftAffine = affine
        }
        if (
            right > boundary.right ||
            (right === boundary.right && props.laneAlpha > boundary.rightAlpha)
        ) {
            boundary.right = right
            boundary.rightAlpha = props.laneAlpha
            boundary.rightAffine = affine
        }
    }
    return boundary
}

const feverPercentageAt = (fever: PreviewFever, now: number) => {
    let lo = 0
    let hi = fever.noteTimes.length
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        const time = fever.noteTimes[mid]
        if (time !== undefined && time <= now) lo = mid + 1
        else hi = mid
    }
    if (!fever.noteTimes.length) return 0
    return Math.min(1, lo / Math.max(1, fever.noteTimes.length - 1))
}

const drawFeverGauge = (
    draw: PreviewRenderer['draw'],
    skin: PreviewSkin,
    boundary: FeverBoundary,
    percentage: number,
    elapsed: number,
    isDynamicStages: boolean,
) => {
    const animation = unlerpClamped(0, 0.25, elapsed)
    const top = DynamicLayout.laneT
    const bottom = DynamicLayout.stageLaneB

    const isTablet = Layout.screenH / 2 >= DynamicLayout.t
    const feverStage = isTablet ? skin.sekaiStageFeverTablet : skin.sekaiStageFever
    if (!isDynamicStages && feverStage) {
        draw(
            feverStage,
            isTablet ? layoutSekaiStageTablet() : layoutSekaiStage(),
            getZAlt(LAYER_FEVER_SIDE, 0),
            animation,
        )
    } else {
        const sideSprite = isTablet ? skin.feverGaugeBackgroundTablet : skin.feverGaugeBackground
        draw(
            sideSprite,
            transformQuadAffine(
                boundary.leftAffine,
                perspectiveRect(boundary.left - 0.5, boundary.left, top, bottom),
            ),
            getZAlt(LAYER_FEVER_SIDE, 0),
            animation * boundary.leftAlpha,
        )
        draw(
            sideSprite,
            transformQuadAffine(
                boundary.rightAffine,
                perspectiveRect(boundary.right, boundary.right + 0.5, top, bottom),
            ),
            getZAlt(LAYER_FEVER_SIDE, 0),
            animation * boundary.rightAlpha,
        )

        drawFeverSideLabels(draw, skin, boundary, animation, isTablet)
    }

    const gaugeTop = lerp(LANE_B, LANE_T, percentage)
    const gaugeSprite = percentage >= 0.78 ? skin.feverGaugeRainbow : skin.feverGaugeYellow
    draw(
        gaugeSprite,
        transformQuadAffine(
            boundary.leftAffine,
            perspectiveRect(boundary.left - 0.5, boundary.left, gaugeTop, bottom),
        ),
        getZAlt(LAYER_FEVER_GAUGE, 0),
        0.6 * boundary.leftAlpha,
    )
    draw(
        gaugeSprite,
        transformQuadAffine(
            boundary.rightAffine,
            perspectiveRect(boundary.right, boundary.right + 0.5, gaugeTop, bottom),
        ),
        getZAlt(LAYER_FEVER_GAUGE, 0),
        0.6 * boundary.rightAlpha,
    )
}

const drawFeverSideLabels = (
    draw: PreviewRenderer['draw'],
    skin: PreviewSkin,
    boundary: FeverBoundary,
    animation: number,
    isTablet: boolean,
) => {
    const feverY = lerp(LANE_B, LANE_T, 0.78)
    const superY = lerp(LANE_B, LANE_T, 0.9)
    const feverDepth = tiltDepth(feverY, 1)
    const superDepth = tiltDepth(superY, 1)
    const feverLeft = boundary.right * tiltWidthFactor(feverDepth) - 0.6 * feverDepth
    const superLeft = boundary.right * tiltWidthFactor(superDepth) - 0.7 * superDepth

    draw(
        skin.guides[0],
        transformQuadAffine(
            boundary.leftAffine,
            perspectiveRect(boundary.left - 1, boundary.left, feverY - 0.002, feverY + 0.002),
        ),
        getZAlt(LAYER_FEVER_SIDE, 1),
        animation * boundary.leftAlpha,
    )
    draw(
        skin.guides[0],
        transformQuadAffine(
            boundary.leftAffine,
            perspectiveRect(boundary.left - 1, boundary.left, superY - 0.001, superY + 0.001),
        ),
        getZAlt(LAYER_FEVER_SIDE, 1),
        animation * boundary.leftAlpha,
    )
    draw(
        skin.feverText,
        transformQuadAffine(
            boundary.rightAffine,
            transformQuad(
                rectQuad(feverLeft, feverLeft + 4.5, feverDepth - 0.07, feverDepth + 0.07),
            ),
        ),
        getZAlt(LAYER_FEVER_SIDE, 1),
        animation * boundary.rightAlpha,
    )
    draw(
        isTablet ? skin.superFeverTextTablet : skin.superFeverText,
        transformQuadAffine(
            boundary.rightAffine,
            transformQuad(
                rectQuad(superLeft, superLeft + 2.94, superDepth - 0.053, superDepth + 0.053),
            ),
        ),
        getZAlt(LAYER_FEVER_SIDE, 1),
        animation * boundary.rightAlpha,
    )
}

const layoutSekaiStage = () => {
    const halfWidth = ((2048 / 1420) * 12) / 2
    const height = 1176 / 850
    return transformQuad(rectQuad(-halfWidth, halfWidth, LANE_T, LANE_T + height))
}

const layoutSekaiStageTablet = () => {
    const scaleFactor = 2048 / 1440
    const halfWidth = ((2048 / 1420) * 12) / 2
    const height = (1080 * scaleFactor) / 850
    const top = (47 - (1080 * scaleFactor - 1176) / 2) / 850
    return transformQuad(rectQuad(-halfWidth, halfWidth, top, top + height))
}

const rectQuad = (left: number, right: number, top: number, bottom: number): Quad => ({
    bl: vec(left, bottom),
    br: vec(right, bottom),
    tl: vec(left, top),
    tr: vec(right, top),
})

const drawFeverChanceParticles = (
    draw: PreviewRenderer['draw'],
    particle: PreviewParticle,
    boundary: FeverBoundary,
    elapsed: number,
) => {
    drawFeverParticle(draw, particle.fever.chanceText, feverTextQuad(), elapsed, 101)
    drawFeverParticle(
        draw,
        particle.fever.chanceLane,
        feverLaneQuad(boundary.left - 0.5, 0.5, boundary.leftAffine),
        elapsed,
        102,
    )
    drawFeverParticle(
        draw,
        particle.fever.chanceLane,
        feverLaneQuad(boundary.right + 0.5, 0.5, boundary.rightAffine),
        elapsed,
        103,
    )
}

const drawFeverStartParticles = (
    draw: PreviewRenderer['draw'],
    particle: PreviewParticle,
    boundary: FeverBoundary,
    percentage: number,
    elapsed: number,
) => {
    if (percentage < 0.78) return

    const isSuper = percentage >= 0.9
    drawFeverParticle(
        draw,
        isSuper ? particle.fever.superFeverText : particle.fever.feverText,
        feverTextQuad(),
        elapsed,
        201,
    )
    drawFeverParticle(
        draw,
        isSuper ? particle.fever.superFeverLane : particle.fever.feverLane,
        feverLaneQuad(boundary.left, 1, boundary.leftAffine),
        elapsed,
        202,
    )
    drawFeverParticle(
        draw,
        isSuper ? particle.fever.superFeverLane : particle.fever.feverLane,
        feverLaneQuad(boundary.right, 1, boundary.rightAffine),
        elapsed,
        203,
    )

    if (isSuper) {
        const mid = (DynamicLayout.laneT + DynamicLayout.stageLaneB) / 2
        drawFeverParticle(
            draw,
            particle.fever.superFeverEffect,
            transformQuadAffine(
                boundary.leftAffine,
                perspectiveRect(boundary.left - 0.5, boundary.left + 0.5, mid - 0.05, mid + 0.05),
            ),
            elapsed,
            204,
        )
        drawFeverParticle(
            draw,
            particle.fever.superFeverEffect,
            transformQuadAffine(
                boundary.rightAffine,
                perspectiveRect(boundary.right - 0.5, boundary.right + 0.5, mid - 0.05, mid + 0.05),
            ),
            elapsed,
            205,
        )
    }

    drawFeverParticle(draw, particle.fever.border, screenQuad(), elapsed, 206)
}

const feverTextQuad = () => fixedQuad(vec(0, 0.65), 1.5, 0.2)

const feverLaneQuad = (lane: number, size: number, affine: AffineTransform) =>
    transformQuadAffine(
        affine,
        perspectiveRect(lane - size, lane + size, DynamicLayout.laneT, DynamicLayout.stageLaneB),
    )

const screenQuad = (): Quad =>
    rectQuad(-Layout.screenW / 2, Layout.screenW / 2, Layout.screenH / 2, -Layout.screenH / 2)

const drawFeverParticle = (
    draw: PreviewRenderer['draw'],
    effect: PreviewParticle['fever']['border'],
    quad: Quad,
    progress: number,
    seed: number,
) => {
    if (!effect) return
    const z: ZKey = [PARTICLE_LAYER, seed]
    drawParticleEffect(draw, effect, quad, progress, false, hashSeed(seed), z)
}
