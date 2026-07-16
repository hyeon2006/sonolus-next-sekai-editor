import type { BaseEntity } from '.'
import type {
    FeverChanceEventObject,
    FeverStartEventObject,
    SkillEventObject,
} from '../../chart/rushEvents'

export type SkillEntity = BaseEntity &
    SkillEventObject & {
        type: 'skill'
    }

export type FeverChanceEntity = BaseEntity &
    FeverChanceEventObject & {
        type: 'feverChance'
    }

export type FeverStartEntity = BaseEntity &
    FeverStartEventObject & {
        type: 'feverStart'
    }

export type RushEventEntity = SkillEntity | FeverChanceEntity | FeverStartEntity

export const toSkillEntity = (object: SkillEventObject): SkillEntity => ({
    type: 'skill',
    hitbox: { lane: -6.5, beat: object.beat, w: 0.5, h: 0.4 },
    ...object,
})

export const toFeverChanceEntity = (object: FeverChanceEventObject): FeverChanceEntity => ({
    type: 'feverChance',
    hitbox: { lane: 6.5, beat: object.beat, w: 0.5, h: 0.4 },
    ...object,
})

export const toFeverStartEntity = (object: FeverStartEventObject): FeverStartEntity => ({
    type: 'feverStart',
    hitbox: { lane: 6.5, beat: object.beat, w: 0.5, h: 0.4 },
    ...object,
})
