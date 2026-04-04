import { describe, expect, it } from '@jest/globals'

import { getAssetEmptyCopy } from '../empty-state-copy'

const messages: Record<string, string> = {
  'assets.empty.all.title': 'No files yet',
  'assets.empty.all.description': 'Upload your first file to get started',
  'assets.empty.all.cta': 'Upload file',
  'assets.empty.video.title': 'No video yet',
  'assets.empty.video.description': 'Upload your first video file to get started',
  'assets.empty.video.cta': 'Upload video',
  'assets.empty.audio.title': 'No audio yet',
  'assets.empty.audio.description': 'Upload your first audio file to get started',
  'assets.empty.audio.cta': 'Upload audio',
}

describe('getAssetEmptyCopy', () => {
  const t = (key: string) => messages[key] ?? key

  it('returns audio-specific copy for the audio filter', () => {
    expect(getAssetEmptyCopy(t, 'audio')).toEqual({
      title: 'No audio yet',
      description: 'Upload your first audio file to get started',
      cta: 'Upload audio',
    })
  })
})
