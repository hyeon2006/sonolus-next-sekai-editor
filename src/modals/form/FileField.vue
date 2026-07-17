<script setup lang="ts">
import { i18n } from '../../i18n'
import { pickFile } from '../../utils/file'
import BaseField from './BaseField.vue'

const props = defineProps<{
    label: string
    value: string | undefined
    accept?: string
}>()

const emit = defineEmits<{
    select: [file: File]
}>()

const onClick = async () => {
    const file = await pickFile(props.accept)
    if (!file) return

    emit('select', file)
}
</script>

<template>
    <BaseField :label>
        <input
            class="w-full rounded-full bg-button px-4 py-1 text-left shadow-md transition-colors hover:shadow-accent active:bg-accent active:text-button"
            type="button"
            :value="value ?? i18n.modals.form.file.select"
            @click="onClick"
        />
    </BaseField>
</template>
