import type { LevelDataEntity } from '@sonolus/core'
import type { Groups } from '../../../chart/groups'
import type { Stages } from '../../../chart/stages'
import type { Store } from '../../../state/store'
import { serializeBpmsToLevelDataEntities } from './bpm'
import { serializeCameraEventsToLevelDataEntities } from './events/camera'
import { serializeStageMaskEventsToLevelDataEntities } from './events/stage/mask'
import { serializeStagePivotEventsToLevelDataEntities } from './events/stage/pivot'
import { serializeStageStyleEventsToLevelDataEntities } from './events/stage/style'
import { serializeStageTransformEventsToLevelDataEntities } from './events/stage/transform'
import { serializeGroupsToLevelDataEntities } from './group'
import {
    serializeGuideArtsToLevelDataEntities,
    serializeGuideArtsToLevelDataJson,
    serializeSlidesToLevelDataEntities,
} from './slide'
import { serializeStagesToLevelDataEntities } from './stage'
import { serializeTimeScalesToLevelDataEntities } from './timeScale'

export const serializeToLevelDataEntities = (
    initialLife: number,
    isDynamicStages: boolean,
    store: Store,
    groups: Groups,
    stages: Stages,
) => [...serializeToLevelDataEntitiesIterable(initialLife, isDynamicStages, store, groups, stages)]

export const serializeToLevelDataEntitiesIterable = (
    initialLife: number,
    isDynamicStages: boolean,
    store: Store,
    groups: Groups,
    stages: Stages,
): Iterable<LevelDataEntity> =>
    serializeToLevelDataEntitiesWithGuideArt(
        initialLife,
        isDynamicStages,
        store,
        groups,
        stages,
        false,
    ) as Iterable<LevelDataEntity>

export const serializeToLevelDataJsonEntitiesIterable = (
    initialLife: number,
    isDynamicStages: boolean,
    store: Store,
    groups: Groups,
    stages: Stages,
): Iterable<LevelDataEntity | string> =>
    serializeToLevelDataEntitiesWithGuideArt(
        initialLife,
        isDynamicStages,
        store,
        groups,
        stages,
        true,
    )

const serializeToLevelDataEntitiesWithGuideArt = (
    initialLife: number,
    isDynamicStages: boolean,
    store: Store,
    groups: Groups,
    stages: Stages,
    guideArtAsJson: boolean,
): Iterable<LevelDataEntity | string> => {
    let id = 0
    const getName = () => (id++).toString(16)

    const initialization = {
        archetype: 'Initialization',
        data: [
            {
                name: 'initialLife',
                value: initialLife,
            },
        ],
    }

    const bpmEntities = serializeBpmsToLevelDataEntities(store)

    const groupEntities = serializeGroupsToLevelDataEntities(groups)

    const stageEntities = serializeStagesToLevelDataEntities(isDynamicStages, stages)

    const cameraEventEntities = serializeCameraEventsToLevelDataEntities(
        isDynamicStages,
        initialization,
        store,
        getName,
    )

    const stageMaskEventEntities = serializeStageMaskEventsToLevelDataEntities(
        isDynamicStages,
        stageEntities,
        store,
        getName,
    )
    const stagePivotEventEntities = serializeStagePivotEventsToLevelDataEntities(
        isDynamicStages,
        stageEntities,
        store,
        getName,
    )
    const stageStyleEventEntities = serializeStageStyleEventsToLevelDataEntities(
        isDynamicStages,
        stageEntities,
        store,
        getName,
    )
    const stageTransformEventEntities = serializeStageTransformEventsToLevelDataEntities(
        isDynamicStages,
        stageEntities,
        store,
        getName,
    )

    const timeScaleEntities = serializeTimeScalesToLevelDataEntities(groupEntities, store, getName)

    const slideEntities = serializeSlidesToLevelDataEntities(
        groupEntities,
        stageEntities,
        store,
        stages,
        getName,
    )
    const guideArtEntities = guideArtAsJson
        ? serializeGuideArtsToLevelDataJson(groupEntities, stageEntities, store, getName)
        : serializeGuideArtsToLevelDataEntities(groupEntities, stageEntities, store, getName)

    for (const guideArt of store.guideArts) {
        const group = groupEntities.get(guideArt.groupId)
        if (!group) throw new Error('Unexpected missing Guide art group')
        group.name ??= getName()

        if (guideArt.kind === 'video') {
            const altGroup = groupEntities.get(guideArt.altGroupId)
            if (!altGroup) throw new Error('Unexpected missing Guide art group')
            altGroup.name ??= getName()
        }

        if (!stageEntities) continue
        const stage = stageEntities.get(guideArt.stageId)
        if (!stage) throw new Error('Unexpected missing Guide art stage')
        stage.name ??= getName()
    }

    return {
        *[Symbol.iterator]() {
            yield initialization
            yield* bpmEntities
            yield* groupEntities.values()
            yield* stageEntities?.values() ?? []
            yield* cameraEventEntities
            yield* stageMaskEventEntities
            yield* stagePivotEventEntities
            yield* stageStyleEventEntities
            yield* stageTransformEventEntities
            yield* timeScaleEntities
            yield* slideEntities
            yield* guideArtEntities
        },
    }
}

export const getStoreEntities = <T>(map: Map<number, Set<T>>) => {
    const entities = new Set<T>()

    for (const set of map.values()) {
        for (const entity of set) {
            entities.add(entity)
        }
    }

    return entities
}
