import Type from 'typebox'
import { getOptionalValue, getValue, type ParseCtx } from '.'
import { SkillEffect, type SkillEffectValue } from '../../rushEvents'

const skillEffects = new Set<number>(Object.values(SkillEffect))

export const parseRushEventsToChart = ({ chart, entities }: ParseCtx) => {
    for (const entity of entities) {
        switch (entity.archetype) {
            case 'Skill': {
                const effect =
                    getOptionalValue(entity, 'effect', Type.Number()) ?? SkillEffect.score
                if (!skillEffects.has(effect)) {
                    throw new Error(`Invalid level: unsupported Skill effect ${effect}`)
                }

                chart.rushEvents.skills.push({
                    beat: getValue(entity, '#BEAT', Type.Number()),
                    effect: effect as SkillEffectValue,
                    level: getOptionalValue(entity, 'level', Type.Number()) ?? 1,
                    value: getOptionalValue(entity, 'value', Type.Number()) ?? 250,
                    scale: getOptionalValue(entity, 'scale', Type.Number()) ?? 1,
                    duration: getOptionalValue(entity, 'duration', Type.Number()) ?? 6,
                })
                break
            }
            case 'FeverChance':
                chart.rushEvents.feverChances.push({
                    beat: getValue(entity, '#BEAT', Type.Number()),
                    force: (getOptionalValue(entity, 'force', Type.Number()) ?? 0) !== 0,
                })
                break
            case 'FeverStart':
                chart.rushEvents.feverStarts.push({
                    beat: getValue(entity, '#BEAT', Type.Number()),
                })
                break
            case '#BPM_CHANGE':
            case '#TIMESCALE_CHANGE':
            default:
                break
        }
    }

    chart.rushEvents.skills.sort((a, b) => a.beat - b.beat)
    chart.rushEvents.feverChances.sort((a, b) => a.beat - b.beat)
    chart.rushEvents.feverStarts.sort((a, b) => a.beat - b.beat)

    if (chart.rushEvents.feverChances.length > 1) {
        throw new Error('Invalid level: only one FeverChance entity is allowed')
    }
    if (chart.rushEvents.feverStarts.length > 1) {
        throw new Error('Invalid level: only one FeverStart entity is allowed')
    }

    const chance = chart.rushEvents.feverChances[0]
    const start = chart.rushEvents.feverStarts[0]
    if (start && !chance) {
        throw new Error('Invalid level: FeverStart requires a preceding FeverChance')
    }
    if (chance && start && chance.beat >= start.beat) {
        throw new Error('Invalid level: FeverChance must be before FeverStart')
    }
}
