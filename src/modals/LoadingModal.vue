<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { i18n } from '../i18n'
import BaseModal from './BaseModal.vue'

const props = defineProps<{
    title: () => string
    task: () => AsyncIterable<() => string> | Iterable<() => string>
    progress?: () => { current: number; total: number } | undefined
}>()

const emit = defineEmits<{
    close: []
}>()

const message = ref(() => i18n.value.modals.loading.loading)
const progressValue = computed(() => {
    const progress = props.progress?.()
    if (!progress || progress.total <= 0) return

    const current = Math.min(Math.max(progress.current, 0), progress.total)
    return {
        current,
        total: progress.total,
        percentage: Math.round((current / progress.total) * 100),
    }
})

let isAborted = false
onMounted(async () => {
    try {
        for await (message.value of props.task()) {
            if (isAborted) return
        }

        emit('close')
    } catch (error) {
        console.error(error)

        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        message.value = () => `${error}`
    }
})

const onClose = () => {
    isAborted = true
    emit('close')
}
</script>

<template>
    <BaseModal :title="title()" @close="onClose">
        <span class="whitespace-break-spaces">{{ message() }}</span>
        <div v-if="progressValue" class="flex flex-col gap-1.5">
            <div class="flex justify-between text-sm tabular-nums">
                <span>{{ progressValue.current }} / {{ progressValue.total }}</span>
                <span>{{ progressValue.percentage }}%</span>
            </div>
            <div
                class="h-2.5 overflow-hidden rounded-full bg-bg/50"
                role="progressbar"
                :aria-valuenow="progressValue.current"
                aria-valuemin="0"
                :aria-valuemax="progressValue.total"
            >
                <div
                    class="h-full rounded-full bg-accent transition-[width] duration-150"
                    :style="{ width: `${progressValue.percentage}%` }"
                />
            </div>
        </div>
    </BaseModal>
</template>
