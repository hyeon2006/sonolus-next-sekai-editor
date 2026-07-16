import type { LevelDataEntity } from '@sonolus/core'
import { getStoreEntities } from '.'
import type { Store } from '../../../state/store'

export const serializeRushEventsToLevelDataEntities = (store: Store): LevelDataEntity[] => [
    ...[...getStoreEntities(store.grid.skill)].map((event): LevelDataEntity => ({
        archetype: 'Skill',
        data: [
            { name: '#BEAT', value: event.beat },
            { name: 'effect', value: event.effect },
            { name: 'level', value: event.level },
            { name: 'value', value: event.value },
            { name: 'scale', value: event.scale },
            { name: 'duration', value: event.duration },
        ],
    })),
    ...[...getStoreEntities(store.grid.feverChance)].map((event): LevelDataEntity => ({
        archetype: 'FeverChance',
        data: [
            { name: '#BEAT', value: event.beat },
            { name: 'force', value: +event.force },
        ],
    })),
    ...[...getStoreEntities(store.grid.feverStart)].map((event): LevelDataEntity => ({
        archetype: 'FeverStart',
        data: [{ name: '#BEAT', value: event.beat }],
    })),
]
