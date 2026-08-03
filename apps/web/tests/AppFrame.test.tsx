// @vitest-environment jsdom
//
// Tests de componente del marco de navegación.
//
// El test que fija la REGRESIÓN DE ORIGEN es el primero: ninguna ruta —incluida una que no existe—
// puede quedarse sin salida ni sin destinos. El marco nació porque la `TopBar` la montaban las
// vistas y cuatro pantallas se quedaron sin ninguna; con el marco alrededor del router, olvidarse
// dejó de ser posible, y esto es lo que lo mantiene así.
//
// Lo que este archivo NO puede verificar: jsdom no aplica CSS ni calcula layout, así que la métrica
// real del problema ("0 anclas en el viewport inicial, 1196px hasta la salida") es la verificación
// en Chrome, no un test. Acá se afirma la única mitad que sí es verificable sin layout — que los
// nodos EXISTEN en el DOM en toda ruta.
//
// Cleanup POR-ARCHIVO: la config de vitest no usa `globals: true`, así que el auto-cleanup de
// testing-library no dispara solo (ver `NewGameForm.test.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import { Router } from 'preact-router'
import type { RoutableProps } from 'preact-router'
import { AppFrame } from '../src/ui/AppFrame'
import { NAV_DESTINATIONS } from '../src/ui/navDestinations'
import { useNavigationGuard } from '../src/ui/navigationGuard'

// `vi.hoisted` y no un `let` suelto: los `vi.mock` se izan por encima de todo el módulo, así que la
// factory necesita un objeto que ya exista cuando corre.
const mocks = vi.hoisted(() => ({
  session: { user: null as { email: string; image?: string | null } | null, pending: false },
  signInWithGoogle: vi.fn(),
}))

// Se mockea el MÓDULO de sesión, no el fetch: `useSession` se suscribe al cliente de better-auth,
// que dispara un GET a /api/auth/get-session — en jsdom eso queda colgado en `pending: true` para
// siempre y el badge de sesión no se renderiza nunca.
vi.mock('../src/cloud/useSession', () => ({ useSession: () => mocks.session }))
vi.mock('../src/cloud/authClient', () => ({
  signInWithGoogle: mocks.signInWithGoogle,
  signOut: vi.fn(),
  authClient: {},
}))

function Pantalla({ nombre }: { nombre: string } & RoutableProps) {
  return <p>{nombre}</p>
}

/** Monta el marco alrededor de un router real, en la ruta pedida. Fiel a `ModeApp`: el marco es el
 * ANCESTRO del `<Router>`, que es lo que obliga a que lea la ruta por suscripción. */
function renderEn(path: string, contenido?: preact.ComponentChildren): void {
  window.history.replaceState(null, '', path)
  render(
    <AppFrame>
      <Router>
        <Pantalla path="/" default nombre="menú" />
        <Pantalla path="/jugar" nombre="jugar" />
        <Pantalla path="/analizar" nombre="analizar" />
        <Pantalla path="/partidas" nombre="partidas" />
        {contenido}
      </Router>
    </AppFrame>,
  )
}

beforeEach(() => {
  mocks.session = { user: null, pending: false }
  mocks.signInWithGoogle.mockClear()
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('el marco está en TODA ruta', () => {
  const RUTAS = ['/', '/jugar', '/analizar', '/partidas', '/ruta-que-no-existe']

  it.each(RUTAS)('%s tiene marca y los tres destinos', (path) => {
    renderEn(path)
    expect(screen.getByRole('button', { name: 'tengen' })).toBeInTheDocument()
    for (const d of NAV_DESTINATIONS) {
      expect(screen.getAllByRole('button', { name: d.label }).length).toBeGreaterThan(0)
    }
  })

  it.each(RUTAS)('%s renderiza cada destino en las DOS formas del marco', (path) => {
    // El conmutador de arriba y la barra de abajo se renderizan siempre y el CSS apaga la que sobra
    // según la forma del viewport. No es un detalle de estilo: `useBoundedBoardSize` mide el alto de
    // `.appbar` para no tapar el contenido, y con la barra renderizada condicionalmente por JS esa
    // medición daría 0 en el viewport donde la barra sí existe.
    renderEn(path)
    for (const d of NAV_DESTINATIONS) {
      expect(screen.getAllByRole('button', { name: d.label })).toHaveLength(2)
    }
  })
})

describe('ubicación y destino activo', () => {
  it('marca con aria-current el destino donde estás', () => {
    renderEn('/analizar')
    for (const b of screen.getAllByRole('button', { name: 'Analizar' })) {
      expect(b).toHaveAttribute('aria-current', 'page')
    }
    for (const b of screen.getAllByRole('button', { name: 'Jugar' })) {
      expect(b).not.toHaveAttribute('aria-current')
    }
  })

  it('no marca ninguno en el menú', () => {
    renderEn('/')
    expect(screen.getByText('Inicio')).toBeInTheDocument()
    for (const d of NAV_DESTINATIONS) {
      for (const b of screen.getAllByRole('button', { name: d.label })) {
        expect(b).not.toHaveAttribute('aria-current')
      }
    }
  })

  it('dice dónde estás junto a la marca', () => {
    renderEn('/partidas')
    // "Mis partidas" aparece además en los dos botones de destino: lo que se busca es el `<span>` de
    // ubicación, que no es interactivo.
    const ubicacion = screen.getAllByText('Mis partidas').find((n) => n.tagName === 'SPAN')
    expect(ubicacion).toBeDefined()
  })
})

describe('estado de sesión', () => {
  it('sin sesión ofrece iniciarla — es lo que arregla el problema', () => {
    // Sin sesión la partida no se guarda en la nube y hasta ahora nada lo decía fuera del menú.
    renderEn('/jugar')
    const boton = screen.getByRole('button', { name: 'Iniciar sesión' })
    fireEvent.click(boton)
    expect(mocks.signInWithGoogle).toHaveBeenCalledOnce()
  })

  it('con sesión muestra quién eres, sin ofrecer cerrarla', () => {
    mocks.session = { user: { email: 'edgar@example.com', image: null }, pending: false }
    renderEn('/jugar')
    expect(screen.getByText('edgar@example.com')).toBeInTheDocument()
    // "Cerrar sesión" vive en el menú a propósito: un toque accidental sobre el chrome no puede
    // desconectarte a mitad de una partida.
    expect(screen.queryByRole('button', { name: /Cerrar sesión/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).toBeNull()
  })

  it('no afirma nada mientras el get-session está en vuelo', () => {
    mocks.session = { user: null, pending: true }
    renderEn('/jugar')
    expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).toBeNull()
  })
})

describe('navegación', () => {
  it('ir a un destino cambia la ruta', () => {
    renderEn('/')
    fireEvent.click(screen.getAllByRole('button', { name: 'Jugar' })[0]!)
    expect(window.location.pathname).toBe('/jugar')
    expect(screen.getByText('jugar')).toBeInTheDocument()
  })

  it('la marca vuelve al menú', () => {
    renderEn('/jugar')
    fireEvent.click(screen.getByRole('button', { name: 'tengen' }))
    expect(window.location.pathname).toBe('/')
  })

  it('corre el guard de la vista ANTES de navegar, con la vista aún montada', () => {
    // El enganche delicado del rediseño: `AnalyzeView` dispara el backup a Drive al salir. Movida la
    // navegación al marco, esto es lo que conserva ese hilo — y tiene que correr con el componente
    // montado, porque un cleanup de desmontaje encontraría el `GameSync` ya dispuesto.
    const orden: string[] = []
    function VistaConGuard(_props: RoutableProps) {
      useNavigationGuard(() => orden.push('guard'))
      return <p>vista</p>
    }
    window.history.replaceState(null, '', '/analizar')
    render(
      <AppFrame>
        <Router>
          <Pantalla path="/" default nombre="menú" />
          <Pantalla path="/jugar" nombre="jugar" />
          <VistaConGuard path="/analizar" />
        </Router>
      </AppFrame>,
    )
    expect(screen.getByText('vista')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Jugar' })[0]!)
    orden.push('navegado')

    expect(orden).toEqual(['guard', 'navegado'])
    expect(window.location.pathname).toBe('/jugar')
  })

  it('un guard que lanza no encierra al usuario en la pantalla', () => {
    function VistaRota(_props: RoutableProps) {
      useNavigationGuard(() => {
        throw new Error('backup falló')
      })
      return <p>rota</p>
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.replaceState(null, '', '/analizar')
    render(
      <AppFrame>
        <Router>
          <Pantalla path="/" default nombre="menú" />
          <Pantalla path="/jugar" nombre="jugar" />
          <VistaRota path="/analizar" />
        </Router>
      </AppFrame>,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Jugar' })[0]!)

    expect(window.location.pathname).toBe('/jugar')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('el guard se da de baja al desmontarse la vista', () => {
    // Sin baja, el `cloud.finish()` de una sesión de análisis ya cerrada seguiría corriendo en cada
    // navegación posterior, sobre un `GameSync` dispuesto.
    let veces = 0
    function VistaConGuard(_props: RoutableProps) {
      useNavigationGuard(() => {
        veces += 1
      })
      return <p>vista</p>
    }
    window.history.replaceState(null, '', '/analizar')
    render(
      <AppFrame>
        <Router>
          <Pantalla path="/" default nombre="menú" />
          <Pantalla path="/jugar" nombre="jugar" />
          <VistaConGuard path="/analizar" />
        </Router>
      </AppFrame>,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Jugar' })[0]!)
    expect(veces).toBe(1)

    // Ya fuera de /analizar: la vista se desmontó y su guard no debería seguir registrado.
    fireEvent.click(screen.getAllByRole('button', { name: 'Analizar' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Jugar' })[0]!)
    expect(veces).toBe(2)
  })
})
