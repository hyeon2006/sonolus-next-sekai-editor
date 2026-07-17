<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from 'vue'
import { defaultGroupId, groups } from '../../../history/groups'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import type { ConnectorLayer } from '../../../chart/note'
import BaseModal from '../../../modals/BaseModal.vue'
import FileField from '../../../modals/form/FileField.vue'
import NumberField from '../../../modals/form/NumberField.vue'
import SelectField from '../../../modals/form/SelectField.vue'
import ToggleField from '../../../modals/form/ToggleField.vue'
import LoadingModal from '../../../modals/LoadingModal.vue'
import { timeout } from '../../../utils/promise'
import { view } from '../../view'
import {
    disposeGuideMedia,
    GuideArtConversionError,
    loadGuideMedia,
    prepareGuideArt,
    type GuideMediaSource,
} from './media'

const emit = defineEmits<{
    close: [prepared?: Awaited<ReturnType<typeof prepareGuideArt>>]
}>()

const source = shallowRef<GuideMediaSource>()
const widthLanes = ref(12)
const columns = ref(16)
const layer = ref<ConnectorLayer>('over')
const fps = ref(12)
const start = ref(0)
const end = ref(0)
const compatibility = ref(false)
const compatibilityNoteSpeed = ref(6)
const entranceDuration = ref(0.5)
const holdDuration = ref(1)
const exitDuration = ref(0.5)
const progress = ref('')

const rows = computed(() =>
    source.value
        ? Math.max(
              1,
              Math.round((Math.round(columns.value) * source.value.height) / source.value.width),
          )
        : 0,
)

const groupName = computed(() => groups.value.get(view.groupId ?? defaultGroupId.value)?.name ?? '')

const fileDescription = computed(() => {
    const value = source.value
    if (!value) return

    const duration = value.kind === 'video' ? ` · ${formatTime(value.duration)}` : ''
    return `${value.name} · ${value.width}x${value.height}${duration}`
})

const onSelect = async (file: File) => {
    let loaded: GuideMediaSource | undefined

    await showModal(LoadingModal, {
        title: () => i18n.value.utilities.guideArt.title,
        async *task() {
            yield () => i18n.value.utilities.guideArt.loading
            await timeout(50)

            try {
                loaded = await loadGuideMedia(file)
            } catch (error) {
                throw localizedError(error)
            }
        },
    })

    if (!loaded) return

    disposeGuideMedia(source.value)
    source.value = loaded

    if (loaded.kind === 'video') {
        start.value = 0
        end.value = loaded.duration
    }
}

const onGenerate = async () => {
    const value = source.value
    if (!value) return

    let prepared: Awaited<ReturnType<typeof prepareGuideArt>> | undefined

    await showModal(LoadingModal, {
        title: () => i18n.value.utilities.guideArt.title,
        async *task() {
            yield () => i18n.value.utilities.guideArt.converting
            await timeout(50)

            try {
                prepared = await prepareGuideArt(value, {
                    widthLanes: widthLanes.value,
                    columns: columns.value,
                    layer: layer.value,
                    fps: fps.value,
                    start: start.value,
                    end: end.value,
                    compatibility: compatibility.value,
                    compatibilityNoteSpeed: compatibilityNoteSpeed.value,
                    entranceDuration: entranceDuration.value,
                    holdDuration: holdDuration.value,
                    exitDuration: exitDuration.value,
                    onProgress(current, total) {
                        progress.value = i18n.value.utilities.guideArt.progress
                            .replace('{0}', `${current}`)
                            .replace('{1}', `${total}`)
                    },
                })
            } catch (error) {
                throw localizedError(error)
            }

            yield () => progress.value || i18n.value.utilities.guideArt.converting
        },
    })

    if (!prepared) return

    emit('close', prepared)
}

const localizedError = (error: unknown) => {
    if (!(error instanceof GuideArtConversionError)) return error

    return new Error(i18n.value.utilities.guideArt[error.code])
}

const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    const milliseconds = Math.floor((time % 1) * 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
}

onUnmounted(() => {
    disposeGuideMedia(source.value)
})
</script>

<template>
    <BaseModal :title="i18n.utilities.guideArt.title" @close="$emit('close')">
        <div class="flex flex-col gap-2">
            <FileField
                :label="i18n.utilities.guideArt.file"
                :value="fileDescription"
                accept="image/*,video/*"
                @select="onSelect"
            />

            <template v-if="source">
                <div class="flex max-h-48 justify-center overflow-hidden rounded-lg bg-bg/50 p-2">
                    <img
                        v-if="source.kind === 'image'"
                        class="max-h-44 max-w-full object-contain"
                        :src="source.url"
                    />
                    <video v-else class="max-h-44 max-w-full" :src="source.url" controls muted />
                </div>

                <NumberField
                    v-model="widthLanes"
                    :label="i18n.utilities.guideArt.widthLanes"
                    :min="0.25"
                    :max="64"
                    step="any"
                />
                <NumberField
                    v-model="columns"
                    :label="i18n.utilities.guideArt.columns"
                    :min="2"
                    :max="128"
                    :step="1"
                />
                <div class="px-4 text-sm text-fg/75">
                    {{
                        i18n.utilities.guideArt.resolution
                            .replace('{0}', `${columns}`)
                            .replace('{1}', `${rows}`)
                    }}
                </div>

                <SelectField
                    v-model="layer"
                    :label="i18n.modals.form.connectorLayer.label"
                    :options="[
                        [i18n.modals.form.connectorLayer.top, 'top'],
                        [i18n.modals.form.connectorLayer.bottom, 'bottom'],
                        [i18n.modals.form.connectorLayer.under, 'under'],
                        [i18n.modals.form.connectorLayer.over, 'over'],
                    ]"
                />

                <template v-if="source.kind === 'video'">
                    <NumberField
                        v-model="fps"
                        :label="i18n.utilities.guideArt.fps"
                        :min="1"
                        :max="25"
                        step="any"
                    />
                    <NumberField
                        v-model="start"
                        :label="i18n.utilities.guideArt.start"
                        :min="0"
                        :max="source.duration"
                        step="any"
                    />
                    <NumberField
                        v-model="end"
                        :label="i18n.utilities.guideArt.end"
                        :min="0"
                        :max="source.duration"
                        step="any"
                    />
                    <ToggleField
                        v-model="compatibility"
                        :label="i18n.utilities.guideArt.compatibility"
                    />
                    <NumberField
                        v-if="compatibility"
                        v-model="compatibilityNoteSpeed"
                        :label="i18n.utilities.guideArt.compatibilityNoteSpeed"
                        :min="1"
                        :max="12"
                        step="any"
                    />
                </template>
                <template v-else>
                    <NumberField
                        v-model="entranceDuration"
                        :label="i18n.utilities.guideArt.entranceDuration"
                        :min="0"
                        step="any"
                    />
                    <NumberField
                        v-model="holdDuration"
                        :label="i18n.utilities.guideArt.holdDuration"
                        :min="0"
                        step="any"
                    />
                    <NumberField
                        v-model="exitDuration"
                        :label="i18n.utilities.guideArt.exitDuration"
                        :min="0"
                        step="any"
                    />
                </template>

                <div class="rounded-lg bg-bg/50 p-3 text-sm">
                    <div>{{ i18n.utilities.guideArt.targetGroup.replace('{0}', groupName) }}</div>
                    <div>{{ i18n.utilities.guideArt.anchorHelp }}</div>
                    <div>{{ i18n.utilities.guideArt.fitHelp }}</div>
                    <template v-if="source.kind === 'video'">
                        <div>{{ i18n.utilities.guideArt.videoHelp }}</div>
                        <div>{{ i18n.utilities.guideArt.compatibilityHelp }}</div>
                    </template>
                    <div v-else>{{ i18n.utilities.guideArt.imageTimingHelp }}</div>
                </div>
            </template>
        </div>

        <div class="flex justify-end">
            <button
                class="w-32 rounded-full bg-accent px-4 py-1 shadow-md transition-colors hover:shadow-accent active:bg-button active:text-accent disabled:opacity-50"
                :disabled="!source"
                @click="onGenerate"
            >
                {{ i18n.utilities.guideArt.convert }}
            </button>
        </div>
    </BaseModal>
</template>
