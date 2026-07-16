<script setup lang="ts">
import { i18n } from '../../../i18n'
import MultiBeatField from '../../../modals/form/MultiBeatField.vue'
import MultiToggleField from '../../../modals/form/MultiToggleField.vue'
import PropertiesModal from '../../../modals/form/PropertiesModal.vue'
import type { FeverChanceEntity } from '../../../state/entities/rushEvents'
import { interpolate } from '../../../utils/interpolate'
import { useSelectedEntitiesProperties } from '../../utils/properties'

const { entities, createModel } = useSelectedEntitiesProperties(
    (entity): entity is FeverChanceEntity => entity.type === 'feverChance',
)

const force = createModel('force')
const beat = createModel('beat')
const title = interpolate(
    () => i18n.value.tools.events.modal.title,
    () => i18n.value.events.feverChance,
)
</script>

<template>
    <PropertiesModal :title="title()">
        <MultiToggleField v-model="force" :label="i18n.rush.force" />
        <MultiBeatField v-if="entities.length === 1" v-model="beat" />
    </PropertiesModal>
</template>
