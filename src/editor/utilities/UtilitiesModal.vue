<script setup lang="ts">
import { i18n } from '../../i18n'
import { showModal } from '../../modals'
import BaseModal from '../../modals/BaseModal.vue'
import { notify } from '../notification'
import { switchToolTo } from '../tools'
import { prepareGuideArtPlacement } from '../tools/guideArt'
import CoverEditorModal from './coverEditor/CoverEditorModal.vue'
import GuideArtModal from './guideArt/GuideArtModal.vue'
import PreviewEditorModal from './previewEditor/PreviewEditorModal.vue'

const emit = defineEmits<{
    close: []
}>()

const utilities = {
    coverEditor: CoverEditorModal,
    previewEditor: PreviewEditorModal,
}

const openGuideArt = async () => {
    const prepared = await showModal(GuideArtModal, {})
    if (!prepared) return

    prepareGuideArtPlacement(prepared)
    emit('close')
    switchToolTo('guideArt')
    notify(() => i18n.value.utilities.guideArt.ready)
}
</script>

<template>
    <BaseModal :title="i18n.utilities.title">
        <div class="flex flex-col gap-2">
            <button
                class="rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent active:bg-accent active:text-button"
                @click="openGuideArt"
            >
                {{ i18n.utilities.guideArt.title }}
            </button>
            <button
                v-for="(modal, name) in utilities"
                :key="name"
                class="rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent active:bg-accent active:text-button"
                @click="showModal(modal, {})"
            >
                {{ i18n.utilities[name].title }}
            </button>
        </div>
    </BaseModal>
</template>
