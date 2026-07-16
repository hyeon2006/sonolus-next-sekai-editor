<script setup lang="ts">
import { i18n } from '../../../i18n'
import MultiBeatField from '../../../modals/form/MultiBeatField.vue'
import PropertiesModal from '../../../modals/form/PropertiesModal.vue'
import type { FeverStartEntity } from '../../../state/entities/rushEvents'
import { interpolate } from '../../../utils/interpolate'
import { useSelectedEntitiesProperties } from '../../utils/properties'

const { entities, createModel } = useSelectedEntitiesProperties(
    (entity): entity is FeverStartEntity => entity.type === 'feverStart',
)

const beat = createModel('beat')
const title = interpolate(
    () => i18n.value.tools.events.modal.title,
    () => i18n.value.events.feverStart,
)
</script>

<template>
    <PropertiesModal :title="title()">
        <MultiBeatField v-if="entities.length === 1" v-model="beat" />
    </PropertiesModal>
</template>
