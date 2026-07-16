<script setup lang="ts">
import { computed } from 'vue'
import { SkillEffect } from '../../chart/rushEvents'
import { bpms } from '../../history/bpms'
import type { RushEventEntity } from '../../state/entities/rushEvents'
import { beatToTime } from '../../state/integrals/bpms'
import { ups } from '../view'

const props = defineProps<{
    entity: RushEventEntity
    isHighlighted: boolean
}>()

const y = computed(() => beatToTime(bpms.value, props.entity.beat) * ups.value)
const color = computed(() =>
    props.entity.type === 'skill' ? '#0f8' : props.entity.type === 'feverChance' ? '#0ff' : '#48f',
)
const x = computed(() => (props.entity.type === 'skill' ? -6.5 : 6.5))
const labelX = computed(() => (props.entity.type === 'skill' ? -6.7 : 6.7))
const labelAnchor = computed(() => (props.entity.type === 'skill' ? 'end' : 'start'))
const label = computed(() => {
    switch (props.entity.type) {
        case 'skill': {
            const effect =
                props.entity.effect === SkillEffect.heal
                    ? 'H'
                    : props.entity.effect === SkillEffect.judgment
                      ? 'J'
                      : 'S'
            return `SK ${effect}${props.entity.level}`
        }
        case 'feverChance':
            return props.entity.force ? 'FC!' : 'FC'
        case 'feverStart':
            return 'FS'
    }
})
</script>

<template>
    <g>
        <line :x1="-6" :x2="6" :y1="y" :y2="y" :stroke="color" stroke-opacity="0.35" />
        <circle :cx="x" :cy="y" r="0.11" stroke="#fff" :fill="color" />
        <text
            :x="labelX"
            :y
            :text-anchor="labelAnchor"
            dominant-baseline="middle"
            :fill="color"
            font-size="0.36"
        >
            {{ label }}
        </text>
    </g>
</template>
