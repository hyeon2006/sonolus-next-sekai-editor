import type { LevelData } from '@sonolus/core'
import type { Groups } from '../chart/groups'
import type { Stages } from '../chart/stages'
import { getFeverPairValidationError } from '../state/mutations/rushEvents'
import type { Store } from '../state/store'
import { serializeToLevelDataEntities } from './entities/serialize'

export const serializeToLevelData = (
    initialLife: number,
    isDynamicStages: boolean,
    bgmOffset: number,
    store: Store,
    groups: Groups,
    stages: Stages,
): LevelData => {
    const feverPairError = getFeverPairValidationError(store.grid)
    if (feverPairError) throw new Error(`Invalid fever pair: ${feverPairError}`)

    return {
        bgmOffset,
        entities: serializeToLevelDataEntities(initialLife, isDynamicStages, store, groups, stages),
    }
}
