import { render, screen } from '@testing-library/react'

import { StreamPreviewPanel } from '../StreamPreviewPanel'

describe('StreamPreviewPanel', () => {
  it('sandboxes embedded previews while preserving playback capabilities', () => {
    render(
      <StreamPreviewPanel
        state="ready"
        title="Live preview"
        badge="Preview"
        latencyHint="A short delay is expected"
        pendingTitle="Waiting for preview"
        pendingDescription="YouTube is preparing the preview"
        embedUrl="https://www.youtube.com/embed/example"
      />,
    )

    expect(screen.getByTitle('Live preview')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-presentation',
    )
  })
})
