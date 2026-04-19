import { render, screen } from '@testing-library/react'

import { Sidebar } from '../Sidebar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

describe('Sidebar go-live CTA', () => {
  it('marks the go-live link as collapsed when the sidebar is collapsed', () => {
    render(<Sidebar collapsed onToggle={jest.fn()} />)

    expect(screen.getByRole('link', { name: /Почати трансляцію/i })).toHaveClass('is-collapsed')
  })
})
