import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  private files: unknown[] = []

  setOptions = jest.fn()
  removeFile = jest.fn()
  cancelAll = jest.fn()
  upload = jest.fn()
  getFiles = jest.fn(() => this.files)

  seedFiles(files: unknown[]) {
    this.files = [...files]
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    const listeners = this.handlers.get(event) ?? new Set()
    listeners.add(handler)
    this.handlers.set(event, listeners)
  }

  off(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.get(event)?.delete(handler)
  }

  emit(event: string, ...args: unknown[]) {
    if (event === 'file-added' && args[0]) {
      const file = args[0] as { id: string }
      this.files = [...this.files.filter((entry) => (entry as { id?: string }).id !== file.id), file]
    }
    if (event === 'file-removed' && args[0]) {
      const file = args[0] as { id: string }
      this.files = this.files.filter((entry) => (entry as { id?: string }).id !== file.id)
    }
    this.handlers.get(event)?.forEach((handler) => handler(...args))
  }
}

function renderModal(
  uppy: MockUppy,
  uploadStatusOverrides?: Record<string, { status: 'processing' | 'complete' | 'error'; error?: string }>,
  onClose: jest.Mock = jest.fn()
) {
  return {
    onClose,
    ...render(
      <NextIntlClientProvider
        locale="en"
        messages={{ library: enMessages } as unknown as AbstractIntlMessages}
      >
        <UploadModal
          isOpen
          onClose={onClose}
          uppy={uppy as never}
          isProcessingUpload={false}
          uploadStatusOverrides={uploadStatusOverrides}
          folders={[]}
        />
      </NextIntlClientProvider>
    ),
  }
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

  it('re-enables close and item actions after backend finalization fails', async () => {
    const uppy = new MockUppy()
    const onClose = jest.fn()
    const user = userEvent.setup()
    const file = new File(['video'], 'stuck.mp4', { type: 'video/mp4' })
    const fileItem = {
      id: 'file-3',
      name: 'stuck.mp4',
      size: file.size,
      type: file.type,
      data: file,
      meta: { asset_type: 'video' },
    }

    const view = renderModal(uppy, undefined, onClose)

    await act(async () => {
      uppy.emit('file-added', fileItem)
      uppy.emit('complete')
    })

    await waitFor(() => expect(screen.getByText('stuck.mp4')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /close/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /clear/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /remove/i })).toBeDisabled()

    view.rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ library: enMessages } as unknown as AbstractIntlMessages}
      >
        <UploadModal
          isOpen
          onClose={onClose}
          uppy={uppy as never}
          isProcessingUpload={false}
          uploadStatusOverrides={{
            'file-3': {
              status: 'error',
              error: 'Timed out waiting for upload finalization',
            },
          }}
          folders={[]}
        />
      </NextIntlClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toBeEnabled()
      expect(screen.getByRole('button', { name: /clear/i })).toBeEnabled()
      expect(screen.getByRole('button', { name: /remove/i })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hydrates files that were already queued before the modal mounted', async () => {
    const uppy = new MockUppy()
    const file = new File(['video'], 'queued.mp4', { type: 'video/mp4' })
    uppy.seedFiles([
      {
        id: 'file-4',
        name: 'queued.mp4',
        size: file.size,
        type: file.type,
        data: file,
        meta: { asset_type: 'video' },
      },
    ])

    renderModal(uppy)

    await waitFor(() => expect(screen.getByText('queued.mp4')).toBeInTheDocument())
  })
})
