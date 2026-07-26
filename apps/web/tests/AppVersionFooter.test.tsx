// @vitest-environment jsdom
//
// Presentacional puro (recibe el estado del service worker, devuelve un evento). Lo que se protege acá
// es el contrato de HONESTIDAD del pie: que la versión que corre el dispositivo sea siempre visible
// (sin eso, un reporte de "me pasa algo raro" es indepurable) y que ningún estado del chequeo diga "al
// día" cuando no lo está.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import { AppVersionFooter, checkMessage } from '../src/ui/AppVersionFooter'

afterEach(cleanup)

const noop = (): void => {}

describe('checkMessage', () => {
  it('una versión nueva lista gana sobre el relato del chequeo que la encontró', () => {
    expect(checkMessage('uptodate', true)).toBe('Hay una versión nueva lista para instalar.')
    expect(checkMessage('idle', true)).toBe('Hay una versión nueva lista para instalar.')
  })

  it('el estado inicial no ocupa una línea', () => {
    expect(checkMessage('idle', false)).toBeNull()
  })

  it('`installing` no dice "al día": el precache sigue en curso', () => {
    expect(checkMessage('installing', false)).toBe('Descargando la versión nueva…')
    expect(checkMessage('uptodate', false)).toBe('Estás en la última versión.')
  })

  it('sin conexión explica que el chequeo vuelve solo, en vez de culpar al usuario', () => {
    expect(checkMessage('offline', false)).toBe('Sin conexión: se buscará al recuperar la red.')
  })
})

describe('AppVersionFooter', () => {
  it('muestra el identificador del build tal cual, para poder pegarlo en un reporte', () => {
    render(<AppVersionFooter buildId="cbc4328 · 2026-07-26 12:00 UTC" checkState="idle" updateReady={false} onCheck={noop} />)
    expect(screen.getByText('cbc4328 · 2026-07-26 12:00 UTC')).toBeInTheDocument()
  })

  it('el botón dispara el chequeo', async () => {
    const onCheck = vi.fn()
    render(<AppVersionFooter buildId="dev" checkState="idle" updateReady={false} onCheck={onCheck} />)
    const button = screen.getByRole('button', { name: 'Buscar actualizaciones' })
    button.click()
    expect(onCheck).toHaveBeenCalledOnce()
  })

  it('se deshabilita mientras busca (un segundo toque no encola un segundo chequeo)', () => {
    render(<AppVersionFooter buildId="dev" checkState="checking" updateReady={false} onCheck={noop} />)
    expect(screen.getByRole('button', { name: 'Buscar actualizaciones' })).toBeDisabled()
    expect(screen.getByText('Buscando…')).toBeInTheDocument()
  })

  it('el resultado del chequeo se anuncia a lectores de pantalla (aparece sin que el usuario navegue)', () => {
    render(<AppVersionFooter buildId="dev" checkState="uptodate" updateReady={false} onCheck={noop} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Estás en la última versión.')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })
})
