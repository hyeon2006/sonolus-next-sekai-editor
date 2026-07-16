import type { AddMutation, RemoveMutation } from '.'
import type {
    FeverChanceEventObject,
    FeverStartEventObject,
    SkillEventObject,
} from '../../chart/rushEvents'
import {
    toFeverChanceEntity,
    toFeverStartEntity,
    toSkillEntity,
    type FeverChanceEntity,
    type FeverStartEntity,
    type SkillEntity,
} from '../entities/rushEvents'
import type { StoreGrid } from '../store/grid'
import { addToStoreGrid, removeFromStoreGrid } from '../store/grid'

export const addSkill: AddMutation<SkillEventObject> = ({ store }, object) => {
    const entity = toSkillEntity(object)
    addToStoreGrid(store.grid, entity, entity.beat)
    return [entity]
}

export const removeSkill: RemoveMutation<SkillEntity> = ({ store }, entity) => {
    removeFromStoreGrid(store.grid, entity, entity.beat)
}

export const getFeverChance = (grid: StoreGrid) => getUniqueEntity(grid.feverChance)

export const getFeverStart = (grid: StoreGrid) => getUniqueEntity(grid.feverStart)

export type FeverPairValidationError = 'multiple' | 'incomplete' | 'order'

export const getFeverPairValidationError = (
    grid: StoreGrid,
): FeverPairValidationError | undefined => {
    const chances = getAllEntities(grid.feverChance)
    const starts = getAllEntities(grid.feverStart)

    if (chances.length > 1 || starts.length > 1) return 'multiple'
    if (chances.length !== starts.length) return 'incomplete'
    if (chances[0] && starts[0] && chances[0].beat >= starts[0].beat) return 'order'
}

export const canPlaceFeverChance = (grid: StoreGrid, beat: number) => {
    const start = getFeverStart(grid)
    return !start || beat < start.beat
}

export const canPlaceFeverStart = (grid: StoreGrid, beat: number) => {
    const chance = getFeverChance(grid)
    return !!chance && beat > chance.beat
}

export const addFeverChance: AddMutation<FeverChanceEventObject> = ({ store }, object) => {
    const current = getFeverChance(store.grid)
    if (!canPlaceFeverChance(store.grid, object.beat)) return current ? [current] : []

    removeAll(store.grid.feverChance, (entity) => {
        removeFromStoreGrid(store.grid, entity, entity.beat)
    })
    const entity = toFeverChanceEntity(object)
    addToStoreGrid(store.grid, entity, entity.beat)
    return [entity]
}

export const removeFeverChance: RemoveMutation<FeverChanceEntity> = ({ store }) => {
    removeAll(store.grid.feverChance, (entity) => {
        removeFromStoreGrid(store.grid, entity, entity.beat)
    })
    removeAll(store.grid.feverStart, (entity) => {
        removeFromStoreGrid(store.grid, entity, entity.beat)
    })
}

export const addFeverStart: AddMutation<FeverStartEventObject> = ({ store }, object) => {
    const current = getFeverStart(store.grid)
    if (!canPlaceFeverStart(store.grid, object.beat)) return current ? [current] : []

    removeAll(store.grid.feverStart, (entity) => {
        removeFromStoreGrid(store.grid, entity, entity.beat)
    })
    const entity = toFeverStartEntity(object)
    addToStoreGrid(store.grid, entity, entity.beat)
    return [entity]
}

export const removeFeverStart: RemoveMutation<FeverStartEntity> = ({ store }) => {
    removeAll(store.grid.feverChance, (entity) => {
        removeFromStoreGrid(store.grid, entity, entity.beat)
    })
    removeAll(store.grid.feverStart, (entity) => {
        removeFromStoreGrid(store.grid, entity, entity.beat)
    })
}

const getUniqueEntity = <T>(map: Map<number, Set<T>>): T | undefined => {
    for (const entities of map.values()) {
        const entity = entities.values().next().value
        if (entity) return entity
    }
}

const getAllEntities = <T>(map: Map<number, Set<T>>): T[] => {
    const result: T[] = []
    for (const entities of map.values()) result.push(...entities)
    return result
}

const removeAll = <T>(map: Map<number, Set<T>>, remove: (entity: T) => void) => {
    const entities = new Set<T>()
    for (const bucket of map.values()) {
        for (const entity of bucket) entities.add(entity)
    }
    for (const entity of entities) remove(entity)
}
