import type { Command } from '.'
import { i18n } from '../../i18n'
import { interpolate } from '../../utils/interpolate'
import { notify } from '../notification'
import { switchToolTo, type ToolName } from '../tools'
import TextIcon from './TextIcon.vue'

const createRushEventCommand = (
    tool: Extract<ToolName, 'skill' | 'feverChance' | 'feverStart'>,
    name: () => string,
    title: string,
    className: string,
): Command => ({
    title: interpolate(() => i18n.value.commands.events.title, name),
    icon: {
        is: TextIcon,
        props: {
            title,
            class: className,
        },
    },
    execute() {
        switchToolTo(tool)
        notify(interpolate(() => i18n.value.commands.events.switched, name))
    },
})

export const skill = createRushEventCommand(
    'skill',
    () => i18n.value.events.skill,
    'SK',
    'text-[#86efac]',
)

export const feverChance = createRushEventCommand(
    'feverChance',
    () => i18n.value.events.feverChance,
    'FC',
    'text-[#67e8f9]',
)

export const feverStart = createRushEventCommand(
    'feverStart',
    () => i18n.value.events.feverStart,
    'FS',
    'text-[#60a5fa]',
)
