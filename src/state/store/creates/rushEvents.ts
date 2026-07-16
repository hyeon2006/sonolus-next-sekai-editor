import type { Store } from '..'
import type { Chart } from '../../../chart'
import { toFeverChanceEntity, toFeverStartEntity, toSkillEntity } from '../../entities/rushEvents'
import { addToStoreGrid } from '../grid'

export const createStoreRushEvents = (store: Store, chart: Chart) => {
    for (const object of chart.rushEvents.skills) {
        const entity = toSkillEntity(object)
        addToStoreGrid(store.grid, entity, entity.beat)
    }
    for (const object of chart.rushEvents.feverChances) {
        const entity = toFeverChanceEntity(object)
        addToStoreGrid(store.grid, entity, entity.beat)
    }
    for (const object of chart.rushEvents.feverStarts) {
        const entity = toFeverStartEntity(object)
        addToStoreGrid(store.grid, entity, entity.beat)
    }
}
