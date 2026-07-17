import type { Command } from '..'
import { i18n } from '../../../i18n'
import { showModal } from '../../../modals'
import GuideArtModal from '../../utilities/guideArt/GuideArtModal.vue'
import UtilitiesIcon from '../utilities/UtilitiesIcon.vue'

export const guideArt: Command = {
    title: () => i18n.value.tools.guideArt.title,
    icon: {
        is: UtilitiesIcon,
    },

    execute() {
        void showModal(GuideArtModal, {})
    },
}
