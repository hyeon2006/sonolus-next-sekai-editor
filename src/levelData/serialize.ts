import type { LevelData } from '@sonolus/core'
import type { Groups } from '../chart/groups'
import type { Stages } from '../chart/stages'
import type { Store } from '../state/store'
import {
    serializeToLevelDataEntities,
    serializeToLevelDataJsonEntitiesIterable,
} from './entities/serialize'

export const serializeToLevelData = (
    initialLife: number,
    isDynamicStages: boolean,
    bgmOffset: number,
    store: Store,
    groups: Groups,
    stages: Stages,
): LevelData => ({
    bgmOffset,
    entities: serializeToLevelDataEntities(initialLife, isDynamicStages, store, groups, stages),
})

export const serializeToLevelDataIterable = (
    initialLife: number,
    isDynamicStages: boolean,
    bgmOffset: number,
    store: Store,
    groups: Groups,
    stages: Stages,
) => ({
    bgmOffset,
    entities: serializeToLevelDataJsonEntitiesIterable(
        initialLife,
        isDynamicStages,
        store,
        groups,
        stages,
    ),
})
