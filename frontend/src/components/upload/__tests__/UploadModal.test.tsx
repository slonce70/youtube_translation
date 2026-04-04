import { act, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'

import enMessages from '@/messages/en/library.json'

import { UploadModal } from '../UploadModal'

jest.mock('mediainfo.js', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({
    analyzeData: jest.fn().mockResolvedValue(JSON.stringify({ media: { track: [] } })),
  }),
}))

jest.mock('mediainfo.js/MediaInfoModule.wasm', () => 'mediainfo.wasm')

class MockUppy {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>()

  setOptions = jest.fn()
  removeFile = jest.fn()
  cancelAll = jest.fn()
  upload = jest.fn()

  on(event: string, handler: (...args: unknown[]) => void) {
    const listeners = this.handlers.get(event) ?? new Set()
    listeners.add(handler)
    this.handlers.set(event, listeners)
  }

  off(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.get(event)?.delete(handler)
  }

  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((handler) => handler(...args))
  }
}

function renderModal(
  uppy: MockUppy,
  uploadStatusOverrides?: Record<string, { status: 'processing' | 'complete' | 'error'; error?: string }>
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ library: enMessages } as unknown as AbstractIntlMessages}
    >
      <UploadModal
        isOpen
        onClose={jest.fn()}
        uppy={uppy as never}
        isProcessingUpload={false}
        uploadStatusOverrides={uploadStatusOverrides}
        folders={[]}
      />
    </NextIntlClientProvider>
  )
}

describe('UploadModal', () => {
  it('applies complete status overrides from backend finalization', async () => {
    const uppy = new MockUppy()
    const file = new File(['video'], 'demo.mp4', { type: 'video/mp4' })
    const fileItem = {
      id: 'file-1',
      name: 'demo.mp4',
      size: file.size,
      type: file.type,
      data: file,
      meta: { asset_type: 'video' },
    }

    const view = renderModal(uppy)

    await act(async () => {
      uppy.emit('file-added', fileItem)
    })
    await waitFor(() => expect(screen.getByText('demo.mp4')).toBeInTheDocument())

    await act(async () => {
      uppy.emit('upload-success', fileItem)
    })

    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ library: enMessages } as unknown as AbstractIntlMessages}
      >
        <UploadModal
          isOpen
          onClose={jest.fn()}
          uppy={uppy as never}
          isProcessingUpload={false}
          uploadStatusOverrides={{ 'file-1': { status: 'complete' } }}
          folders={[]}
        />
      </NextIntlClientProvider>
    )

    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument())
  })

  it('shows backend failure messages for failed finalization', async () => {
    const uppy = new MockUppy()
    const file = new File(['video'], 'demo.mp4', { type: 'video/mp4' })
    const fileItem = {
      id: 'file-2',
      name: 'demo.mp4',
      size: file.size,
      type: file.type,
      data: file,
      meta: { asset_type: 'video' },
    }

    const view = renderModal(uppy)

    await act(async () => {
      uppy.emit('file-added', fileItem)
    })
    await waitFor(() => expect(screen.getByText('demo.mp4')).toBeInTheDocument())

    await act(async () => {
      uppy.emit('upload-success', fileItem)
    })

    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ library: enMessages } as unknown as AbstractIntlMessages}
      >
        <UploadModal
          isOpen
          onClose={jest.fn()}
          uppy={uppy as never}
          isProcessingUpload={false}
          uploadStatusOverrides={{
            'file-2': {
              status: 'error',
              error: 'Backend finalization failed',
            },
          }}
          folders={[]}
        />
      </NextIntlClientProvider>
    )

    await waitFor(() =>
      expect(screen.getByText('Backend finalization failed')).toBeInTheDocument()
    )
  })
})
