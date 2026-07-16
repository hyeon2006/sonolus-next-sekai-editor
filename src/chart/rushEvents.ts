export const SkillEffect = {
    score: 0,
    heal: 1,
    judgment: 2,
} as const

export type SkillEffectValue = (typeof SkillEffect)[keyof typeof SkillEffect]

export type SkillEventObject = {
    beat: number
    effect: SkillEffectValue
    level: number
    value: number
    scale: number
    duration: number
}

export type FeverChanceEventObject = {
    beat: number
    force: boolean
}

export type FeverStartEventObject = {
    beat: number
}

export type RushEvents = {
    skills: SkillEventObject[]
    feverChances: FeverChanceEventObject[]
    feverStarts: FeverStartEventObject[]
}

export const createRushEvents = (): RushEvents => ({
    skills: [],
    feverChances: [],
    feverStarts: [],
})
