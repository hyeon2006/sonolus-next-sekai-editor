import type { EntityOfType, EntityType } from '../entities'

export type StoreGrid = {
    [T in EntityType]: Map<number, Set<EntityOfType<T>>>
}

const writableKeys = new WeakMap<object, Set<number>>()

export const beatToKey = (beat: number) => Math.floor(beat)

export const getInStoreGrid = <T extends EntityType>(grid: StoreGrid, type: T, beat: number) => {
    const entities = grid[type].get(Math.floor(beat))
    if (!entities) return

    return [...entities]
}

export const addToStoreGrid = <T extends EntityType>(
    grid: StoreGrid,
    entity: EntityOfType<T>,
    fromBeat: number,
    toBeat = fromBeat,
) => {
    for (let key = Math.floor(fromBeat); key <= Math.floor(toBeat); key++) {
        getWritableEntities(grid[entity.type], key).add(entity)
    }
}

export const removeFromStoreGrid = <T extends EntityType>(
    grid: StoreGrid,
    entity: EntityOfType<T>,
    fromBeat: number,
    toBeat = fromBeat,
) => {
    for (let key = Math.floor(fromBeat); key <= Math.floor(toBeat); key++) {
        const map = grid[entity.type]
        const entities = map.get(key)
        if (!entities) continue

        if (!entities.has(entity)) return

        if (entities.size === 1) {
            map.delete(key)
            getWritableKeys(map).add(key)
        } else {
            getWritableEntities(map, key).delete(entity)
        }
    }
}

const getWritableEntities = <T>(map: Map<number, Set<T>>, key: number): Set<T> => {
    const keys = getWritableKeys(map)
    const entities = map.get(key)
    if (entities && keys.has(key)) return entities

    const writable = new Set(entities)
    map.set(key, writable)
    keys.add(key)
    return writable
}

const getWritableKeys = (map: object) => {
    let keys = writableKeys.get(map)
    if (!keys) {
        keys = new Set()
        writableKeys.set(map, keys)
    }
    return keys
}
