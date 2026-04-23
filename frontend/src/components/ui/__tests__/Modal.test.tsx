import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '../Modal'

describe('Modal', () => {
  it('keeps keyboard focus inside the open dialog', async () => {
    const user = userEvent.setup()

    render(
      <>
        <button type="button">Outside action</button>
        <Modal open onClose={jest.fn()} ariaLabel="Test dialog">
          <button type="button">First action</button>
          <button type="button">Second action</button>
        </Modal>
      </>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Test dialog' })
    const firstAction = screen.getByRole('button', { name: 'First action' })
    const secondAction = screen.getByRole('button', { name: 'Second action' })

    await waitFor(() => expect(dialog).toHaveFocus())

    await user.tab()
    expect(firstAction).toHaveFocus()

    await user.tab()
    expect(secondAction).toHaveFocus()

    await user.tab()
    expect(firstAction).toHaveFocus()

    await user.tab({ shift: true })
    expect(secondAction).toHaveFocus()
  })

  it('restores focus to the previously active element after closing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <>
        <button type="button">Open modal</button>
        <Modal open={false} onClose={jest.fn()} ariaLabel="Test dialog">
          <button type="button">Dialog action</button>
        </Modal>
      </>,
    )

    const opener = screen.getByRole('button', { name: 'Open modal' })
    await user.click(opener)

    rerender(
      <>
        <button type="button">Open modal</button>
        <Modal open onClose={jest.fn()} ariaLabel="Test dialog">
          <button type="button">Dialog action</button>
        </Modal>
      </>,
    )

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Test dialog' })).toHaveFocus())

    rerender(
      <>
        <button type="button">Open modal</button>
        <Modal open={false} onClose={jest.fn()} ariaLabel="Test dialog">
          <button type="button">Dialog action</button>
        </Modal>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Open modal' })).toHaveFocus()
  })
})
