import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createFakeBarRepository } from '../../../test/fake-bar-repository'
import { BarRepositoryProvider, useBarRepository } from './repository-context'

describe('BarRepositoryProvider / useBarRepository', () => {
  it('delivers the repository instance passed to the provider', () => {
    const repository = createFakeBarRepository()
    let received: unknown

    function Probe() {
      received = useBarRepository()
      return null
    }

    render(
      <BarRepositoryProvider repository={repository}>
        <Probe />
      </BarRepositoryProvider>,
    )

    expect(received).toBe(repository)
  })

  it('throws a clear error when used outside the provider', () => {
    function Probe() {
      useBarRepository()
      return null
    }

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Probe />)).toThrow(/useBarRepository/)

    consoleErrorSpy.mockRestore()
  })
})
