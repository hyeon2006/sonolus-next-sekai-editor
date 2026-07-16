import type { Component } from 'vue'
import type { Tool } from '..'
import {
    SkillEffect,
    type FeverChanceEventObject,
    type FeverStartEventObject,
    type SkillEventObject,
} from '../../../chart/rushEvents'
import { pushState, replaceState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import type { Entity } from '../../../state/entities'
import {
    toFeverChanceEntity,
    toFeverStartEntity,
    toSkillEntity,
    type FeverChanceEntity,
    type FeverStartEntity,
    type RushEventEntity,
    type SkillEntity,
} from '../../../state/entities/rushEvents'
import {
    addFeverChance,
    addFeverStart,
    addSkill,
    canPlaceFeverChance,
    canPlaceFeverStart,
    removeFeverChance,
    removeFeverStart,
    removeSkill,
} from '../../../state/mutations/rushEvents'
import { createTransaction, type Transaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { isSidebarVisible } from '../../sidebars'
import { focusViewAtBeat, setViewHover, snapYToBeat, view, yToValidBeat } from '../../view'
import { hitEntitiesAtPoint } from '../utils'
import FeverChancePropertiesModal from './FeverChancePropertiesModal.vue'
import FeverStartPropertiesModal from './FeverStartPropertiesModal.vue'
import SkillPropertiesModal from './SkillPropertiesModal.vue'

type RushEventObject = SkillEventObject | FeverChanceEventObject | FeverStartEventObject

type RushEventConfig = {
    type: RushEventEntity['type']
    name: () => string
    singleton: boolean
    modal: Component
    createDefault: (beat: number) => RushEventObject
    toEntity: (object: RushEventObject) => RushEventEntity
    merge: (entity: RushEventEntity, object: Partial<RushEventObject>) => RushEventObject
    add: (transaction: Transaction, object: RushEventObject) => Entity[]
    remove: (transaction: Transaction, entity: RushEventEntity) => void
    canPlace?: (grid: Transaction['store']['grid'], beat: number) => boolean
    invalidMessage?: () => string
}

const skillConfig: RushEventConfig = {
    type: 'skill',
    name: () => i18n.value.events.skill,
    singleton: false,
    modal: SkillPropertiesModal,
    createDefault: (beat) => ({
        beat,
        effect: SkillEffect.score,
        level: 1,
        value: 250,
        scale: 1,
        duration: 6,
    }),
    toEntity: (object) => toSkillEntity(object as SkillEventObject),
    merge: (entity, object) => {
        const skill = entity as SkillEntity
        const update = object as Partial<SkillEventObject>
        return {
            beat: update.beat ?? skill.beat,
            effect: update.effect ?? skill.effect,
            level: update.level ?? skill.level,
            value: update.value ?? skill.value,
            scale: update.scale ?? skill.scale,
            duration: update.duration ?? skill.duration,
        }
    },
    add: (transaction, object) => addSkill(transaction, object as SkillEventObject),
    remove: (transaction, entity) => {
        removeSkill(transaction, entity as SkillEntity)
    },
}

const feverChanceConfig: RushEventConfig = {
    type: 'feverChance',
    name: () => i18n.value.events.feverChance,
    singleton: true,
    modal: FeverChancePropertiesModal,
    createDefault: (beat) => ({ beat, force: true }),
    toEntity: (object) => toFeverChanceEntity(object as FeverChanceEventObject),
    merge: (entity, object) => {
        const feverChance = entity as FeverChanceEntity
        const update = object as Partial<FeverChanceEventObject>
        return {
            beat: update.beat ?? feverChance.beat,
            force: update.force ?? feverChance.force,
        }
    },
    add: (transaction, object) => addFeverChance(transaction, object as FeverChanceEventObject),
    remove: (transaction, entity) => {
        removeFeverChance(transaction, entity as FeverChanceEntity)
    },
    canPlace: canPlaceFeverChance,
    invalidMessage: () => i18n.value.rush.feverChanceOrder,
}

const feverStartConfig: RushEventConfig = {
    type: 'feverStart',
    name: () => i18n.value.events.feverStart,
    singleton: true,
    modal: FeverStartPropertiesModal,
    createDefault: (beat) => ({ beat }),
    toEntity: (object) => toFeverStartEntity(object),
    merge: (entity, object) => ({
        beat: (object as Partial<FeverStartEventObject>).beat ?? entity.beat,
    }),
    add: (transaction, object) => addFeverStart(transaction, object),
    remove: (transaction, entity) => {
        removeFeverStart(transaction, entity as FeverStartEntity)
    },
    canPlace: canPlaceFeverStart,
    invalidMessage: () => i18n.value.rush.feverStartOrder,
}

let active:
    | {
          type: 'add'
          config: RushEventConfig
      }
    | {
          type: 'move'
          config: RushEventConfig
          entity: RushEventEntity
      }
    | undefined

const createRushEventTool = (config: RushEventConfig): Tool => ({
    title: config.name,

    hover(x, y) {
        const [entity, beat] = tryFind(config, x, y)
        view.entities = entity
            ? { hovered: [entity], creating: [] }
            : { hovered: [], creating: [config.toEntity(config.createDefault(beat))] }
    },

    tap(x, y, modifiers) {
        const [entity, beat] = tryFind(config, x, y)
        if (!entity) {
            if (!add(config, config.createDefault(beat))) return
            focusViewAtBeat(beat)
            void showModal(config.modal, {})
            return
        }

        if (modifiers.ctrl) {
            const selected = selectedEntities.value.filter(
                (selected): selected is RushEventEntity => selected.type === config.type,
            )
            const targets = selected.includes(entity)
                ? selected.filter((selected) => selected !== entity)
                : [...selected, entity]

            replaceState({ ...state.value, selectedEntities: targets })
            clearViewEntities()
            focusViewAtBeat(entity.beat)
            notify(eventMessage('selected', config, targets.length))
            return
        }

        if (selectedEntities.value.includes(entity)) {
            focusViewAtBeat(entity.beat)
            if (!isSidebarVisible.value) void showModal(config.modal, {})
            return
        }

        replaceState({ ...state.value, selectedEntities: [entity] })
        clearViewEntities()
        focusViewAtBeat(entity.beat)
        notify(eventMessage('selected', config, 1))
    },

    dragStart(x, y) {
        const [entity, beat] = tryFind(config, x, y)
        if (entity) {
            replaceState({ ...state.value, selectedEntities: [entity] })
            clearViewEntities()
            focusViewAtBeat(entity.beat)
            notify(eventMessage('moving', config, 1))
            active = { type: 'move', config, entity }
        } else {
            focusViewAtBeat(beat)
            notify(eventMessage('adding', config, 1))
            active = { type: 'add', config }
        }
        return true
    },

    dragUpdate(x, y) {
        if (active?.config !== config) return

        setViewHover(y)
        if (active.type === 'add') {
            const [entity, beat] = tryFind(config, x, y)
            if (entity) {
                view.entities = { hovered: [entity], creating: [] }
                focusViewAtBeat(entity.beat)
            } else {
                view.entities = {
                    hovered: [],
                    creating: [config.toEntity(config.createDefault(beat))],
                }
                focusViewAtBeat(beat)
            }
        } else {
            const beat = snapYToBeat(y, active.entity.beat)
            view.entities = {
                hovered: [],
                creating: [config.toEntity(config.merge(active.entity, { beat }))],
            }
            focusViewAtBeat(beat)
        }
    },

    dragEnd(x, y) {
        if (active?.config !== config) return

        if (active.type === 'add') {
            const [entity, beat] = tryFind(config, x, y)
            if (entity) {
                replaceState({ ...state.value, selectedEntities: [entity] })
                clearViewEntities()
                focusViewAtBeat(entity.beat)
            } else {
                if (add(config, config.createDefault(beat))) {
                    focusViewAtBeat(beat)
                    void showModal(config.modal, {})
                }
            }
        } else {
            const beat = snapYToBeat(y, active.entity.beat)
            const moved = editMoveOrReplace(
                config,
                active.entity,
                config.merge(active.entity, { beat }),
            )
            focusViewAtBeat(moved ? beat : active.entity.beat)
        }

        active = undefined
    },
})

export const skill = createRushEventTool(skillConfig)
export const feverChance = createRushEventTool(feverChanceConfig)
export const feverStart = createRushEventTool(feverStartConfig)

export const editSkill = (entity: SkillEntity, object: Partial<SkillEventObject>) => {
    editMoveOrReplace(skillConfig, entity, skillConfig.merge(entity, object))
}

export const editFeverChance = (
    entity: FeverChanceEntity,
    object: Partial<FeverChanceEventObject>,
) => {
    editMoveOrReplace(feverChanceConfig, entity, feverChanceConfig.merge(entity, object))
}

export const editFeverStart = (
    entity: FeverStartEntity,
    object: Partial<FeverStartEventObject>,
) => {
    editMoveOrReplace(feverStartConfig, entity, feverStartConfig.merge(entity, object))
}

export const editSelectedSkill = (
    transaction: Transaction,
    entity: SkillEntity,
    object: Partial<SkillEventObject>,
) => editSelected(transaction, skillConfig, entity, skillConfig.merge(entity, object))

export const editSelectedFeverChance = (
    transaction: Transaction,
    entity: FeverChanceEntity,
    object: Partial<FeverChanceEventObject>,
) => editSelected(transaction, feverChanceConfig, entity, feverChanceConfig.merge(entity, object))

export const editSelectedFeverStart = (
    transaction: Transaction,
    entity: FeverStartEntity,
    object: Partial<FeverStartEventObject>,
) => editSelected(transaction, feverStartConfig, entity, feverStartConfig.merge(entity, object))

const tryFind = (
    config: RushEventConfig,
    x: number,
    y: number,
): [RushEventEntity] | [undefined, number] => {
    const [hit] = (hitEntitiesAtPoint(config.type, x, y) as RushEventEntity[]).sort(
        (a, b) => +selectedEntities.value.includes(b) - +selectedEntities.value.includes(a),
    )
    if (hit) return [hit]

    const beat = yToValidBeat(y)
    const nearest = findAtBeat(config, state.value.store.grid, beat)
    return nearest ? [nearest] : [undefined, beat]
}

const findAtBeat = (config: RushEventConfig, grid: Transaction['store']['grid'], beat: number) =>
    [...(grid[config.type].get(Math.floor(beat)) ?? [])].find(
        (entity) => entity.type === config.type && entity.beat === beat,
    )

const removeConflicts = (transaction: Transaction, config: RushEventConfig, beat: number) => {
    const conflicts = [findAtBeat(config, transaction.store.grid, beat)].filter(
        (entity): entity is RushEventEntity => entity !== undefined,
    )

    for (const conflict of conflicts) config.remove(transaction, conflict)
}

const update = (
    config: RushEventConfig,
    message: 'added' | 'edited' | 'moved',
    action: (transaction: Transaction) => Entity[],
) => {
    const transaction = createTransaction(state.value)
    const entities = action(transaction)
    const text = eventMessage(message, config, entities.length)
    pushState(text, transaction.commit(entities))
    clearViewEntities()
    notify(text)
}

const add = (config: RushEventConfig, object: RushEventObject) => {
    if (!canPlace(config, state.value.store.grid, object.beat)) return false

    update(config, 'added', (transaction) => {
        if (!config.singleton) removeConflicts(transaction, config, object.beat)
        return config.add(transaction, object)
    })
    return true
}

const editMoveOrReplace = (
    config: RushEventConfig,
    entity: RushEventEntity,
    object: RushEventObject,
) => {
    if (!canPlace(config, state.value.store.grid, object.beat)) return false

    update(config, entity.beat === object.beat ? 'edited' : 'moved', (transaction) => {
        if (!config.singleton) {
            config.remove(transaction, entity)
            removeConflicts(transaction, config, object.beat)
        }
        return config.add(transaction, object)
    })
    return true
}

const editSelected = (
    transaction: Transaction,
    config: RushEventConfig,
    entity: RushEventEntity,
    object: RushEventObject,
) => {
    if (!canPlace(config, transaction.store.grid, object.beat)) return [entity]

    if (!config.singleton) {
        config.remove(transaction, entity)
        removeConflicts(transaction, config, object.beat)
    }
    return config.add(transaction, object)
}

const canPlace = (config: RushEventConfig, grid: Transaction['store']['grid'], beat: number) => {
    if (config.canPlace?.(grid, beat) ?? true) return true
    if (config.invalidMessage) notify(config.invalidMessage)
    clearViewEntities()
    return false
}

const eventMessage = (
    key: 'adding' | 'added' | 'edited' | 'moving' | 'moved' | 'selected',
    config: RushEventConfig,
    count: number,
) => interpolate(() => i18n.value.tools.events[key], `${count}`, config.name)

const clearViewEntities = () => {
    view.entities = { hovered: [], creating: [] }
}
