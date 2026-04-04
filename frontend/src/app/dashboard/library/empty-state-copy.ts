export type AssetFilterValue = 'all' | 'video' | 'audio'

export type EmptyStateCopy = {
  title: string
  description: string
  cta: string
}

export function getAssetEmptyCopy(
  t: (key: string) => string,
  assetFilter: AssetFilterValue,
): EmptyStateCopy {
  switch (assetFilter) {
    case 'video':
      return {
        title: t('assets.empty.video.title'),
        description: t('assets.empty.video.description'),
        cta: t('assets.empty.video.cta'),
      }
    case 'audio':
      return {
        title: t('assets.empty.audio.title'),
        description: t('assets.empty.audio.description'),
        cta: t('assets.empty.audio.cta'),
      }
    default:
      return {
        title: t('assets.empty.all.title'),
        description: t('assets.empty.all.description'),
        cta: t('assets.empty.all.cta'),
      }
  }
}
