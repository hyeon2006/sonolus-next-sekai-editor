import type { GlobalEventRanges } from './globalEventRanges'
import type { StoreGrid } from './grid'
import type { StoredGuideArt } from './guideArt'
import type { StoreSlides } from './slides'
import type { StageEventRanges } from './stageEventRanges'

export type Store = {
    grid: StoreGrid
    guideArts: StoredGuideArt[]
    globalEventRanges: GlobalEventRanges
    stageEventRanges: StageEventRanges
    slides: StoreSlides
}
