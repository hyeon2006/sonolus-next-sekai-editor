<script setup lang="ts">
import { SkillEffect } from '../../../chart/rushEvents'
import { i18n } from '../../../i18n'
import MultiBeatField from '../../../modals/form/MultiBeatField.vue'
import MultiNumberField from '../../../modals/form/MultiNumberField.vue'
import MultiSelectField from '../../../modals/form/MultiSelectField.vue'
import PropertiesModal from '../../../modals/form/PropertiesModal.vue'
import type { SkillEntity } from '../../../state/entities/rushEvents'
import { interpolate } from '../../../utils/interpolate'
import { useSelectedEntitiesProperties } from '../../utils/properties'

const { entities, createModel } = useSelectedEntitiesProperties(
    (entity): entity is SkillEntity => entity.type === 'skill',
)

const effect = createModel('effect')
const level = createModel('level')
const value = createModel('value')
const scale = createModel('scale')
const duration = createModel('duration')
const beat = createModel('beat')

const title = interpolate(
    () => i18n.value.tools.events.modal.title,
    () => i18n.value.events.skill,
)
</script>

<template>
    <PropertiesModal :title="title()">
        <MultiSelectField
            v-model="effect"
            :label="i18n.rush.effect"
            :options="[
                [i18n.rush.score, SkillEffect.score],
                [i18n.rush.heal, SkillEffect.heal],
                [i18n.rush.judgment, SkillEffect.judgment],
            ]"
        />
        <MultiNumberField v-model="level" :label="i18n.rush.level" :step="1" />
        <MultiNumberField v-model="value" :label="i18n.rush.value" :step="1" />
        <MultiNumberField v-model="scale" :label="i18n.rush.scale" step="any" />
        <MultiNumberField v-model="duration" :label="i18n.rush.duration" :min="0" step="any" />
        <MultiBeatField v-if="entities.length === 1" v-model="beat" />
    </PropertiesModal>
</template>
