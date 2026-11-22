import React, { Component, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './style.css'
import {
  AppContext,
  Button,
  Card,
  Dialog,
  ErrorBox,
  Field,
  Loading,
  Page,
  PwaInstallGuide,
  Sheet,
  ToastProvider,
  api,
  go,
  href,
  itemText,
  useAction,
  useClearToasts,
  useRemote,
  useToast
} from './ui'
import { Overview, ReportDetail, ReportList, ReportMovements } from './production'
import { CentralStock, RawMaterial, RegionalRegister, TransactionRoute, WarehouseDetail } from './warehouse'
import { Catalog, Month, Payroll, People, ProductDetail, Settings, StaffDetail } from './directory'
import { PasswordInput } from './pickers'

const menuGroups = [
  {
    key: 'production',
    label: 'Производство',
    items: [
      ['/overview', 'Обзор', 'overview'],
      ['/reports', 'Отчёты за смену', 'reports']
    ]
  },
  {
    key: 'warehouse',
    label: 'Склад и каталог',
    items: [
      ['/stock', 'Склады', 'stock'],
      ['/catalog', 'Изделия и нормы', 'catalog']
    ]
  },
  {
    key: 'finance',
    label: 'Зарплата и люди',
    items: [
      ['/payroll', 'Зарплата', 'payroll'],
      ['/people', 'Сотрудники', 'people'],
      ['/month', 'Итоги месяца', 'month']
    ]
  },
  {
    key: 'system',
    label: 'Система',
    items: [
      ['/settings', 'Настройки', 'settings']
    ]
  }
]

const regionalGroups = (city) => [
  {
    key: 'regional',
    label: city ? 'Склад · ' + city : 'Региональный склад',
    items: [
      ['/regional', 'Остатки', 'stock'],
      ['/receiving', 'Приёмка', 'receiving'],
      ['/sales', 'Продажи', 'sales']
    ]
  },
  {
    key: 'system',
    label: 'Система',
    items: [
      ['/settings', 'Настройки', 'settings']
    ]
  }
]

const active = (path, to) => path === to || path.startsWith(to + '/')
const isCentralWriter = (role) => role === 'admin' || role === 'accountant'
const navActive = (path, to, role) =>
  active(path, to) || (to === '/stock' && isCentralWriter(role) && (path === '/sales' || path.startsWith('/sales/')))
const section = (code) => new RegExp('^/' + code + '/(new|[1-9][0-9]*)$')
const homePath = (user) => (user?.role === 'regional' ? '/regional' : '/overview')

function openPasswordSettingsRoute() {
  go('/settings')
  window.setTimeout(() => {
    const input = document.querySelector('#workspace input[autocomplete="current-password"]')
    input?.focus()
  }, 80)
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function parseHash(raw) {
  const value = String(raw || '')
  const qIndex = value.indexOf('?')
  const rawPath = qIndex >= 0 ? value.slice(0, qIndex) : value
  const query = qIndex >= 0 ? value.slice(qIndex + 1) : ''
  const prefixed = rawPath ? (rawPath.startsWith('/') ? rawPath : '/' + rawPath) : '/'
  const cleanPath = prefixed.replace(/\/+$/, '') || '/'
  return { path: cleanPath, query }
}

function usePath() {
  const get = () => window.location.hash.slice(1) || '/'
  const [path, setPath] = useState(get)
  useEffect(() => {
    const change = () => setPath(get())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  return path
}

const refreshTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow'
})

function RefreshStatus({ at, busy }) {
  return (
    <span className="refresh-status" role="status" aria-live="polite">
      {busy
        ? 'Обновление…'
        : at
          ? <>Обновлено: <time dateTime={at.toISOString()}>{refreshTimeFormat.format(at)}</time></>
          : 'Синхронизация…'}
    </span>
  )
}

function AccessDenied({ home, roleName, message }) {
  return (
    <Page title="Раздел недоступен" subtitle={roleName ? 'Текущая роль: ' + roleName : undefined}>
      <Card className="forbidden-card" title="Нет доступа к этому разделу">
        <p className="muted">
          {message || 'Этот раздел не входит в полномочия вашей учётной записи. Перейдите в доступный рабочий раздел.'}
        </p>
        <div className="left-actions">
          <Button kind="primary" to={home}>
            {home === '/regional' ? 'К остаткам склада' : 'Вернуться в обзор'}
          </Button>
          <Button to="/settings">Настройки профиля</Button>
        </div>
      </Card>
    </Page>
  )
}

function NotFound({ home }) {
  return (
    <Page title="Страница не найдена" subtitle="Проверьте адрес или перейдите в рабочий раздел">
      <Card className="forbidden-card" title="Маршрут не найден">
        <p className="muted">
          Запрошенная страница не существует или ссылка устарела.
        </p>
        <div className="left-actions">
          <Button kind="primary" to={home}>
            {home === '/regional' ? 'К остаткам склада' : 'На главную'}
          </Button>
        </div>
      </Card>
    </Page>
  )
}

class WorkspaceBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    const { home, onReset } = this.props
    return (
      <Page title="Ошибка отображения" subtitle="Не удалось загрузить содержимое раздела">
        <Card className="forbidden-card" title="Не удалось отобразить страницу" role="alert">
          <p className="muted">
            При отрисовке раздела возникла непредвиденная ошибка. Все сохранённые документы и остатки в порядке.
          </p>
          <div className="left-actions">
            <Button
              kind="primary"
              onClick={() => {
                this.setState({ failed: false })
                onReset?.()
                go(home)
              }}
            >
              {home === '/regional' ? 'К остаткам склада' : 'Вернуться в обзор'}
            </Button>
            <Button onClick={() => window.location.reload()}>Обновить страницу</Button>
          </div>
        </Card>
      </Page>
    )
  }
}

function Login({ done, initialError = '' }) {
  const [data, set] = useState({ email: '', password: '' })
  const [help, setHelp] = useState(false)
  const state = useAction()
  const displayedError = state.error || initialError

  return (
    <main className="login">
      <div className="login-half">
        <form
          className="login-form"
          onSubmit={e => {
            e.preventDefault()
            state.run(async () => {
              await api('/login', 'POST', data)
              done()
            })
          }}
        >
          <span className="login-eyebrow">Швейная фабрика</span>
          <h1>Войти в рабочее пространство</h1>
          <Field label="Электронная почта">
            <input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoComplete="username"
              disabled={state.busy}
              value={data.email}
              onChange={e => {
                state.clear()
                set({ ...data, email: e.target.value })
              }}
              placeholder="oksana@factory.local"
            />
          </Field>
          <Field label="Пароль">
            <PasswordInput
              maxLength="128"
              required
              autoComplete="current-password"
              disabled={state.busy}
              value={data.password}
              onChange={e => {
                state.clear()
                set({ ...data, password: e.target.value })
              }}
              placeholder="Введите пароль"
            />
          </Field>
          <ErrorBox error={displayedError} />
          <div className="login-actions">
            <Button type="submit" disabled={state.busy} aria-busy={state.busy} kind="primary">
              {state.busy ? 'Вход…' : 'Войти'}
            </Button>
            <button type="button" className="forgot-link" disabled={state.busy} onClick={() => setHelp(true)}>
              Не помню пароль
            </button>
          </div>
          <p className="login-footer">Локальный учёт производства, складов и сдельной оплаты</p>
        </form>
      </div>
      <div className="login-half login-description">
        <div>
          <span className="login-eyebrow">Производство и склады</span>
          <h2>Учёт производства<br />по факту</h2>
          <p>Рабочее место бухгалтера, мастера смены и регионального склада</p>
          <ol className="login-benefits">
            <li>Выработка за смену и списание сырья</li>
            <li>Пять складов в Иваново и отправка в регионы</li>
            <li>Сдельная зарплата и себестоимость выпуска</li>
          </ol>
        </div>
      </div>
      {help && (
        <Dialog
          title="Восстановление доступа"
          close={() => setHelp(false)}
          footer={<Button kind="primary" onClick={() => setHelp(false)}>Понятно</Button>}
        >
          <p className="modal-description">
            Автоматический сброс пароля не подключён. Обратитесь к администратору фабрики, чтобы получить новый пароль.
          </p>
          <p className="muted">
            После входа вы сможете самостоятельно задать новый пароль в разделе «Настройки».
          </p>
        </Dialog>
      )}
    </main>
  )
}

function ProfileMenu({ user, logout }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const menuRef = useRef(null)
  const pendingFocus = useRef(null)
  const regional = user.role === 'regional'

  function menuItems() {
    return [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
  }

  useEffect(() => {
    if (!open) return
    if (pendingFocus.current !== null) {
      const items = menuItems()
      const target = pendingFocus.current === 'last' ? items.at(-1) : items[0]
      pendingFocus.current = null
      requestAnimationFrame(() => target?.focus({ preventScroll: true }))
    }
    const onPointerDown = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    const onFocusIn = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        containerRef.current?.querySelector('button.profile')?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function onTriggerKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      pendingFocus.current = e.key === 'ArrowUp' ? 'last' : 'first'
      setOpen(true)
    }
  }

  function onMenuKeyDown(e) {
    const items = menuItems()
    if (!items.length) return
    const current = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(current + 1) % items.length]?.focus({ preventScroll: true })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(current <= 0 ? items.length - 1 : current - 1)]?.focus({ preventScroll: true })
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus({ preventScroll: true })
    } else if (e.key === 'End') {
      e.preventDefault()
      items.at(-1)?.focus({ preventScroll: true })
    }
  }

  function openPasswordSettings() {
    setOpen(false)
    openPasswordSettingsRoute()
  }

  return (
    <div className="profile-menu" ref={containerRef}>
      <button
        type="button"
        className="profile"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={'Профиль · ' + user.name}
        onClick={() => {
          pendingFocus.current = null
          setOpen(v => !v)
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span aria-hidden="true" className="avatar">{initials(user.name)}</span>
        <span>
          <strong>{user.name}</strong>
          <small>{regional && user.city ? `${user.role_name} · ${user.city}` : user.role_name}</small>
        </span>
        <svg className="profile-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="profile-popover"
          role="menu"
          aria-label="Меню профиля"
          onKeyDown={onMenuKeyDown}
        >
          <div className="profile-popover-head">
            <span aria-hidden="true" className="avatar">{initials(user.name)}</span>
            <div>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <div className="profile-popover-meta">
            <div>Роль: <strong>{user.role_name}</strong></div>
            {regional && user.warehouse_name && (
              <div>Склад: <strong>{user.warehouse_name}{user.city ? ' · ' + user.city : ''}</strong></div>
            )}
          </div>
          <div className="profile-popover-actions">
            <button
              type="button"
              className="profile-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                go('/settings')
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="7" r="3" />
                <path d="M4.5 16.5a5.5 5.5 0 0 1 11 0" />
              </svg>
              <span>Настройки профиля</span>
            </button>
            <button
              type="button"
              className="profile-menu-item"
              role="menuitem"
              onClick={openPasswordSettings}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="4.5" y="9" width="11" height="7.5" rx="2" />
                <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
              </svg>
              <span>Сменить пароль</span>
            </button>
            <button
              type="button"
              className="profile-menu-item is-danger"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                logout()
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M8 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3M13 14l4-4-4-4M17 10H8" />
              </svg>
              <span>Выйти</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Route({ path, user }) {
  const match = path.split('/').at(-1)
  const id = match === 'new' ? undefined : Number(match)
  const home = homePath(user)

  if (path === '/settings') return <Settings />

  if (user.role === 'regional') {
    if (path === '/regional') return <WarehouseDetail id={user.warehouse_id} regional />
    if (path === '/receiving') return <RegionalRegister kind="transfer" />
    if (path === '/sales') return <RegionalRegister kind="sale" />
    if (/^\/receiving\/[1-9]\d*$/.test(path)) return <TransactionRoute mode="transfer" id={id} />
    if (section('sales').test(path)) return <TransactionRoute mode="sale" id={id} />
    if (/^\/(overview|reports|stock|catalog|people|payroll|month)(\/|$)/.test(path)) {
      return <AccessDenied home={home} roleName={user.role_name} />
    }
    return <NotFound home={home} />
  }

  if (/^\/(regional|receiving)(\/|$)/.test(path)) {
    return <AccessDenied home={home} roleName={user.role_name} />
  }

  if (path === '/sales') {
    return isCentralWriter(user.role)
      ? <CentralStock tab="sales" />
      : <AccessDenied home={home} roleName={user.role_name} />
  }
  if (section('sales').test(path)) {
    return isCentralWriter(user.role)
      ? <TransactionRoute mode="sale" id={id} />
      : <AccessDenied home={home} roleName={user.role_name} />
  }

  if (path === '/overview') return <Overview />
  if (path === '/reports') return <ReportList />
  if (section('reports').test(path)) return <ReportDetail id={id} />
  if (/^\/reports\/[1-9]\d*\/movements$/.test(path)) return <ReportMovements id={Number(path.split('/')[2])} />
  if (path === '/catalog') return <Catalog />
  if (path === '/catalog/new') {
    return ['admin', 'accountant'].includes(user.role)
      ? <ProductDetail />
      : <AccessDenied home={home} roleName={user.role_name} />
  }
  if (/^\/catalog\/[1-9]\d*$/.test(path)) return <ProductDetail id={id} />
  if (/^\/catalog\/[1-9]\d*\/specs\/[1-9]\d*$/.test(path)) {
    return <ProductDetail id={Number(path.split('/')[2])} selected={match} />
  }
  if (path === '/people') return <People />
  if (/^\/people\/[1-9]\d*$/.test(path)) return <StaffDetail id={id} />
  if (path === '/payroll') {
    return user.role !== 'master' ? <Payroll /> : <AccessDenied home={home} roleName={user.role_name} />
  }
  if (path === '/month') {
    return user.role !== 'master' ? <Month /> : <AccessDenied home={home} roleName={user.role_name} />
  }
  if (path === '/stock') return <CentralStock />
  if (/^\/stock\/[1-9]\d*$/.test(path)) {
    if (user.role === 'master' && id > 5) return <AccessDenied home={home} roleName={user.role_name} />
    return <WarehouseDetail id={id} />
  }
  if (/^\/stock\/1\/items\/[1-9]\d*$/.test(path)) return <RawMaterial id={id} />
  if (/^\/stock\/(transfers|sales|access)$/.test(path)) {
    if (match === 'access' && user.role !== 'admin') return <AccessDenied home={home} roleName={user.role_name} />
    if (user.role === 'master') return <AccessDenied home={home} roleName={user.role_name} />
    return <CentralStock tab={match} />
  }
  if (section('stock/transfers').test(path)) {
    return user.role !== 'master'
      ? <TransactionRoute mode="transfer" id={id} />
      : <AccessDenied home={home} roleName={user.role_name} />
  }
  if (section('stock/receipts').test(path)) {
    return user.role !== 'master'
      ? <TransactionRoute mode="receipt" id={id} />
      : <AccessDenied home={home} roleName={user.role_name} />
  }
  if (/^\/stock\/sales\/(new|[1-9]\d*)$/.test(path)) {
    return user.role !== 'master'
      ? <TransactionRoute mode="sale" id={id} />
      : <AccessDenied home={home} roleName={user.role_name} />
  }
  return <NotFound home={home} />
}

function breadcrumbs(path, items, workspace, headingTitle) {
  const { user, warehouses = [], items: catalogItems = [], staff = [] } = workspace
  const regional = user.role === 'regional'
  const root = regional ? ['/regional', 'Склад · ' + user.city] : ['/overview', 'Фабрика']
  const crumbs = [root]

  if (headingTitle === 'Раздел недоступен' || headingTitle === 'Страница не найдена') {
    crumbs.push([path, headingTitle])
    return crumbs
  }

  if (path === root[0]) {
    const currentItem = items.find(([to]) => to === path)
    if (currentItem) crumbs.push([currentItem[0], currentItem[1]])
    return crumbs
  }

  const sectionItem = items.find(([to]) => navActive(path, to, user.role))
  if (sectionItem) {
    crumbs.push([sectionItem[0], sectionItem[1]])
  } else if (path === '/settings') {
    crumbs.push(['/settings', 'Настройки'])
    return crumbs
  } else {
    crumbs.push([path, headingTitle || 'Раздел'])
    return crumbs
  }

  const segments = path.split('/').filter(Boolean)

  if (!regional && segments[0] === 'sales') {
    crumbs.push(['/stock/sales', 'Продажи'])
    if (segments.length > 1) {
      crumbs.push([path, headingTitle || (segments[1] === 'new' ? 'Новая продажа' : 'Документ о продаже')])
    }
    return crumbs
  }

  if (segments.length <= 1) return crumbs

  if (segments[0] === 'stock') {
    const tabLabels = { transfers: 'Перемещения', sales: 'Продажи', receipts: 'Поступления', access: 'Доступ к складам' }
    if (tabLabels[segments[1]]) {
      const parentRoute = segments[1] === 'receipts' ? '/stock/1?tab=receipts' : '/stock/' + segments[1]
      crumbs.push([parentRoute, tabLabels[segments[1]]])
      if (segments.length > 2) {
        const fallback = segments[2] === 'new'
          ? (segments[1] === 'receipts' ? 'Новое поступление' : segments[1] === 'sales' ? 'Новая продажа' : 'Новое перемещение')
          : 'Документ'
        crumbs.push([path, headingTitle || fallback])
      }
      return crumbs
    }

    const wid = Number(segments[1])
    const warehouse = warehouses.find(w => w.id === wid)
    const warehouseTitle = warehouse?.name || (wid === 1 ? 'Склад сырья' : 'Карточка склада')
    crumbs.push(['/stock/' + segments[1], segments.length === 2 && headingTitle ? headingTitle : warehouseTitle])

    if (segments[2] === 'items' && segments[3]) {
      const material = catalogItems.find(i => i.id === Number(segments[3]))
      crumbs.push([path, headingTitle || material?.name || 'Материал'])
    }
    return crumbs
  }

  if (segments[0] === 'reports') {
    if (segments[1] === 'new') {
      crumbs.push([path, headingTitle || 'Новый отчёт за смену'])
    } else if (segments[2] === 'movements') {
      crumbs.push(['/reports/' + segments[1], 'Отчёт #' + segments[1]])
      crumbs.push([path, headingTitle || 'Движения документа'])
    } else {
      crumbs.push([path, headingTitle || 'Отчёт #' + segments[1]])
    }
    return crumbs
  }

  if (segments[0] === 'catalog') {
    if (segments[1] === 'new') {
      crumbs.push([path, headingTitle || 'Новое изделие'])
      return crumbs
    }
    const product = catalogItems.find(i => i.id === Number(segments[1]))
    const productTitle = product ? itemText(product) : 'Изделие'
    if (segments[2] === 'specs' && segments[3]) {
      crumbs.push(['/catalog/' + segments[1], productTitle])
      crumbs.push([path, 'Версия спецификации'])
    } else {
      crumbs.push([path, headingTitle || productTitle])
    }
    return crumbs
  }

  if (segments[0] === 'people') {
    const person = staff.find(p => p.id === Number(segments[1]))
    crumbs.push([path, headingTitle || person?.name || 'Карточка сотрудника'])
    return crumbs
  }

  if (segments[0] === 'receiving') {
    crumbs.push([path, headingTitle || 'Документ приёмки'])
    return crumbs
  }

  if (segments[0] === 'sales') {
    crumbs.push([path, headingTitle || (segments[1] === 'new' ? 'Новая продажа' : 'Документ о продаже')])
    return crumbs
  }

  crumbs.push([path, headingTitle || 'Документ'])
  return crumbs
}

function RegisterBreadcrumbs({ crumbs }) {
  return (
    <nav className="breadcrumbs" aria-label="Хлебные крошки">
      <div className="breadcrumb-track">
        {crumbs.map(([to, title], i) => (
          <React.Fragment key={i + '-' + to}>
            {i > 0 && (
              <svg
                aria-hidden="true"
                className="crumb-arrow"
                viewBox="0 0 16 16"
                width="14"
                height="14"
              >
                <path
                  d="m6 3.5 4.5 4.5L6 12.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" title={title}>{title}</span>
            ) : (
              <a href={href(to)}>{title}</a>
            )}
          </React.Fragment>
        ))}
      </div>
    </nav>
  )
}

function moscowDateIso() {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function isRunningStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || Boolean(window.navigator?.standalone)
}

function useOnlineStatus(onReconnect) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const reconnectRef = useRef(onReconnect)
  reconnectRef.current = onReconnect

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      reconnectRef.current?.()
    }
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}

function usePwaInstall(toast) {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isStandalone, setIsStandalone] = useState(isRunningStandalone)
  const [installOpen, setInstallOpen] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)')
    const syncStandalone = () => setIsStandalone(isRunningStandalone())
    const onBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    const onInstalled = () => {
      setDeferredPrompt(null)
      setInstallOpen(false)
      setIsStandalone(true)
      toast?.success('Приложение установлено')
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    mq?.addEventListener?.('change', syncStandalone)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      mq?.removeEventListener?.('change', syncStandalone)
    }
  }, [toast])

  const openInstallGuide = useCallback(() => setInstallOpen(true), [])
  const closeInstallGuide = useCallback(() => setInstallOpen(false), [])

  const triggerInstall = useCallback(async () => {
    if (!deferredPrompt) {
      setInstallOpen(true)
      return false
    }
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      setDeferredPrompt(null)
      if (choice?.outcome === 'accepted') {
        setInstallOpen(false)
        return true
      }
      return false
    } catch {
      setDeferredPrompt(null)
      setInstallOpen(true)
      return false
    }
  }, [deferredPrompt])

  return {
    deferredPrompt,
    isStandalone,
    canInstallPwa: Boolean(deferredPrompt),
    installOpen,
    openInstallGuide,
    closeInstallGuide,
    triggerInstall
  }
}

function OfflineBanner({ online }) {
  if (online) return null
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M2.5 2.5 17.5 17.5M5.2 12.2a7 7 0 0 1 6.3-1.6M8.1 15a3.5 3.5 0 0 1 3.8 0M2.8 9.2a10.5 10.5 0 0 1 6.1-2.5M13.5 7.2a10.5 10.5 0 0 1 3.7 2" />
      </svg>
      <span>Нет подключения к сети — данные могут быть неактуальны</span>
    </div>
  )
}

function MobileHeader({ workspace, crumbs, home, profileOpen, onOpenProfile }) {
  const { user } = workspace
  const regional = user.role === 'regional'
  const isNested = crumbs.length > 2
  const parent = isNested ? crumbs.at(-2) : null
  const currentCrumb = crumbs.at(-1)

  return (
    <header className={'mobile-header' + (regional ? ' regional' : '')}>
      {isNested && parent ? (
        <>
          <a
            className="mobile-back-btn"
            href={href(parent[0])}
            aria-label={'Назад: ' + parent[1]}
            title={parent[1]}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m12.5 5-5 5 5 5" />
            </svg>
            <span>Назад</span>
          </a>
          <span className="mobile-header-title" title={currentCrumb?.[1]}>
            {currentCrumb?.[1]}
          </span>
        </>
      ) : (
        <a className="mobile-brand" href={href(home)}>
          <span className="sidebar-brand-mark" aria-hidden="true">ШФ</span>
          <span className="sidebar-brand-copy">
            <strong>{workspace.settings?.company || 'Швейная фабрика'}</strong>
            <span>{regional ? 'Склад · ' + user.city : 'Иваново'}</span>
          </span>
        </a>
      )}
      <button
        type="button"
        className="mobile-avatar-btn"
        aria-label={'Профиль · ' + user.name}
        aria-haspopup="dialog"
        aria-expanded={profileOpen}
        onClick={onOpenProfile}
      >
        <span aria-hidden="true" className="avatar">{initials(user.name)}</span>
      </button>
    </header>
  )
}

function BottomNav({ current, user, itemBadge, moreOpen, onOpenMore, onCloseSheets }) {
  const regional = user.role === 'regional'
  const tabs = regional
    ? [
        ['/regional', 'Остатки', 'stock'],
        ['/receiving', 'Приёмка', 'receiving'],
        ['/sales', 'Продажи', 'sales'],
        ['/settings', 'Настройки', 'settings']
      ]
    : [
        ['/overview', 'Обзор', 'overview'],
        ['/reports', 'Отчёты', 'reports'],
        ['/stock', 'Склады', 'stock'],
        ['/catalog', 'Изделия', 'catalog'],
        ['__more__', 'Ещё', 'more']
      ]

  const moreRoutes = user.role === 'master'
    ? ['/people', '/settings']
    : ['/payroll', '/people', '/month', '/settings']

  function handleSelect(to) {
    if (to === '__more__') {
      onOpenMore()
      return
    }
    onCloseSheets?.()
    if (current === to) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    go(to)
  }

  return (
    <nav
      className="bottom-nav"
      aria-label="Мобильная навигация"
      style={{ '--nav-cols': tabs.length }}
    >
      {tabs.map(([to, label, icon]) => {
        const isMore = to === '__more__'
        const isActive = isMore
          ? moreOpen || moreRoutes.some(r => active(current, r))
          : !moreOpen && navActive(current, to, user.role)
        const badge = isMore ? null : itemBadge(to)
        return (
          <button
            key={to}
            type="button"
            className={'bottom-nav-item' + (isActive ? ' is-active' : '')}
            aria-current={!isMore && isActive ? 'page' : undefined}
            aria-expanded={isMore ? moreOpen : undefined}
            aria-haspopup={isMore ? 'dialog' : undefined}
            aria-label={badge ? `${label} (${badge.count})` : label}
            onClick={() => handleSelect(to)}
          >
            <span className="bottom-nav-icon" aria-hidden="true">
              <span
                className="nav-icon"
                style={{ maskImage: `url(/icons/${icon}.svg)`, WebkitMaskImage: `url(/icons/${icon}.svg)` }}
              />
              {badge && (
                <span className="bottom-nav-badge">
                  {badge.count > 99 ? '99+' : badge.count}
                </span>
              )}
            </span>
            <span className="bottom-nav-label">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function MoreSheet({ open, onClose, current, user, logout, isStandalone, onInstallPwa }) {
  const secondaryItems = user.role === 'master'
    ? [
        ['/people', 'Сотрудники', 'people'],
        ['/settings', 'Настройки', 'settings']
      ]
    : [
        ['/payroll', 'Зарплата', 'payroll'],
        ['/people', 'Сотрудники', 'people'],
        ['/month', 'Итоги месяца', 'month'],
        ['/settings', 'Настройки', 'settings']
      ]

  return (
    <Sheet open={open} onClose={onClose} title="Ещё" subtitle={user.role_name}>
      <div className="sheet-menu-list" role="navigation" aria-label="Дополнительные разделы">
        {secondaryItems.map(([to, label, icon]) => {
          const isActive = active(current, to)
          return (
            <a
              key={to}
              className={'sheet-menu-item' + (isActive ? ' is-active' : '')}
              href={href(to)}
              aria-current={isActive ? 'page' : undefined}
              onClick={onClose}
            >
              <span
                aria-hidden="true"
                className="nav-icon"
                style={{ maskImage: `url(/icons/${icon}.svg)`, WebkitMaskImage: `url(/icons/${icon}.svg)` }}
              />
              <span>{label}</span>
              <svg className="sheet-menu-chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m6 3.5 4.5 4.5L6 12.5" />
              </svg>
            </a>
          )
        })}
      </div>
      {!isStandalone && (
        <div className="sheet-menu-list">
          <button
            type="button"
            className="sheet-menu-item"
            onClick={() => {
              onClose()
              onInstallPwa()
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 3v9.5M6.5 9.5 10 13l3.5-3.5M4 16.5h12" />
            </svg>
            <span>Установить приложение</span>
            <svg className="sheet-menu-chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m6 3.5 4.5 4.5L6 12.5" />
            </svg>
          </button>
        </div>
      )}
      <div className="sheet-menu-list">
        <button
          type="button"
          className="sheet-menu-item is-danger"
          onClick={() => {
            onClose()
            logout()
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3M13 14l4-4-4-4M17 10H8" />
          </svg>
          <span>Выйти из аккаунта</span>
        </button>
      </div>
    </Sheet>
  )
}

function ProfileSheet({ open, onClose, user, updatedAt, refreshing, logout, isStandalone, onInstallPwa }) {
  const regional = user.role === 'regional'
  return (
    <Sheet open={open} onClose={onClose} title={user.name} subtitle={user.email}>
      <div className="profile-popover-meta">
        <div>Роль: <strong>{user.role_name}</strong></div>
        {regional && user.warehouse_name && (
          <div>Склад: <strong>{user.warehouse_name}{user.city ? ' · ' + user.city : ''}</strong></div>
        )}
        <div><RefreshStatus at={updatedAt} busy={refreshing} /></div>
      </div>
      <div className="sheet-menu-list">
        <button
          type="button"
          className="sheet-menu-item"
          onClick={() => {
            onClose()
            go('/settings')
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="7" r="3" />
            <path d="M4.5 16.5a5.5 5.5 0 0 1 11 0" />
          </svg>
          <span>Настройки профиля</span>
          <svg className="sheet-menu-chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
        </button>
        <button
          type="button"
          className="sheet-menu-item"
          onClick={() => {
            onClose()
            openPasswordSettingsRoute()
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="4.5" y="9" width="11" height="7.5" rx="2" />
            <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
          </svg>
          <span>Сменить пароль</span>
          <svg className="sheet-menu-chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
        </button>
        {!isStandalone && (
          <button
            type="button"
            className="sheet-menu-item"
            onClick={() => {
              onClose()
              onInstallPwa()
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 3v9.5M6.5 9.5 10 13l3.5-3.5M4 16.5h12" />
            </svg>
            <span>Установить приложение</span>
            <svg className="sheet-menu-chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m6 3.5 4.5 4.5L6 12.5" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="sheet-menu-item is-danger"
          onClick={() => {
            onClose()
            logout()
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3M13 14l4-4-4-4M17 10H8" />
          </svg>
          <span>Выйти</span>
        </button>
      </div>
    </Sheet>
  )
}

function Shell({ path, workspace, refresh, refreshing, updatedAt, online, pwa, logout }) {
  const { user } = workspace
  const regional = user.role === 'regional'
  const home = homePath(user)
  const { path: parsedRoute } = parseHash(path)
  const current = parsedRoute === '/' ? home : parsedRoute
  const registryState = useRef(new Map()).current
  const [heading, setHeading] = useState(null)
  const setPageHeading = useCallback(title => setHeading({ path, title }), [path])
  const [revision, setRevision] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  const [profileSheetOpen, setProfileSheetOpen] = useState(false)
  const calendarDayRef = useRef(moscowDateIso())
  const refreshPage = useCallback(() => setRevision(n => n + 1), [])

  const groups = (regional ? regionalGroups(user.city) : menuGroups)
    .map(group => ({
      ...group,
      items: group.items.filter(([to]) => user.role !== 'master' || !['/month', '/payroll'].includes(to))
    }))
    .filter(group => group.items.length > 0)

  const flatItems = groups.flatMap(group => group.items)
  const headingTitle = heading?.path === path ? heading.title : null
  const crumbs = breadcrumbs(current, flatItems, workspace, headingTitle)

  function itemBadge(to) {
    if (to === '/stock' && workspace.in_transit?.documents > 0) {
      return { count: workspace.in_transit.documents, label: `В пути: ${workspace.in_transit.documents}` }
    }
    if (to === '/receiving' && workspace.in_transit?.documents > 0) {
      return { count: workspace.in_transit.documents, label: `Ожидают приёмки: ${workspace.in_transit.documents}` }
    }
    if (to === '/reports' && workspace.drafts_count > 0) {
      return { count: workspace.drafts_count, label: `Черновиков: ${workspace.drafts_count}` }
    }
    return null
  }

  useEffect(() => {
    setMoreOpen(false)
    setProfileSheetOpen(false)
    window.scrollTo(0, 0)
  }, [current])

  useEffect(() => {
    const syncDayRollover = () => {
      const nextDay = moscowDateIso()
      if (nextDay !== calendarDayRef.current) {
        calendarDayRef.current = nextDay
        refresh()
        refreshPage()
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncDayRollover()
    }
    const timer = window.setInterval(syncDayRollover, 60_000)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh, refreshPage])

  return (
    <AppContext.Provider
      value={{
        ...workspace,
        refresh,
        logout,
        registryState,
        setPageHeading,
        refreshPage,
        openInstallGuide: pwa.openInstallGuide,
        installPwa: pwa.triggerInstall,
        isStandalone: pwa.isStandalone,
        canInstallPwa: pwa.canInstallPwa
      }}
    >
      <div className="shell">
        <OfflineBanner online={online} />
        <a
          className="skip"
          href="#workspace"
          onClick={e => {
            e.preventDefault()
            document.querySelector('main')?.focus()
          }}
        >
          Перейти к содержимому
        </a>
        <aside className="sidebar">
          <div className="sidebar-head">
            <a className="sidebar-brand" href={href(home)}>
              <span className="sidebar-brand-mark" aria-hidden="true">ШФ</span>
              <span className="sidebar-brand-copy">
                <strong>{workspace.settings?.company || 'Швейная фабрика'}</strong>
                <span>{regional ? 'Склад · ' + user.city : 'Иваново'}</span>
              </span>
            </a>
          </div>
          <nav aria-label="Основная навигация">
            {groups.map(group => (
              <div className="nav-group" key={group.key}>
                <span className="nav-group-label">{group.label}</span>
                {group.items.map(([to, name, icon]) => {
                  const badge = itemBadge(to)
                  return (
                    <a
                      key={to}
                      href={href(to)}
                      aria-current={navActive(current, to, user.role) ? 'page' : undefined}
                    >
                      {icon && (
                        <span
                          aria-hidden="true"
                          className="nav-icon"
                          style={{ maskImage: `url(/icons/${icon}.svg)`, WebkitMaskImage: `url(/icons/${icon}.svg)` }}
                        />
                      )}
                      <span>{name}</span>
                      {badge && (
                        <span className="nav-badge" title={badge.label} aria-label={badge.label}>
                          {badge.count}
                        </span>
                      )}
                    </a>
                  )
                })}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button type="button" className="sidebar-logout" onClick={logout}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M8 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3M13 14l4-4-4-4M17 10H8" />
              </svg>
              <span>Выйти</span>
            </button>
          </div>
        </aside>
        <header className={'topbar' + (regional ? ' regional' : '')}>
          <RegisterBreadcrumbs crumbs={crumbs} />
          <div className="topbar-right">
            <RefreshStatus at={updatedAt} busy={refreshing} />
            <ProfileMenu user={user} logout={logout} />
          </div>
        </header>
        <MobileHeader
          workspace={workspace}
          crumbs={crumbs}
          home={home}
          profileOpen={profileSheetOpen}
          onOpenProfile={() => setProfileSheetOpen(true)}
        />
        <main id="workspace" className="content" tabIndex="-1">
          <WorkspaceBoundary
            key={path + '-' + revision}
            home={home}
            onReset={refreshPage}
          >
            <Route key={path + '-' + revision} path={current} user={user} />
          </WorkspaceBoundary>
        </main>
        <BottomNav
          current={current}
          user={user}
          itemBadge={itemBadge}
          moreOpen={moreOpen}
          onOpenMore={() => setMoreOpen(true)}
          onCloseSheets={() => {
            setMoreOpen(false)
            setProfileSheetOpen(false)
          }}
        />
        {!regional && (
          <MoreSheet
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            current={current}
            user={user}
            logout={logout}
            isStandalone={pwa.isStandalone}
            onInstallPwa={pwa.triggerInstall}
          />
        )}
        <ProfileSheet
          open={profileSheetOpen}
          onClose={() => setProfileSheetOpen(false)}
          user={user}
          updatedAt={updatedAt}
          refreshing={refreshing}
          logout={logout}
          isStandalone={pwa.isStandalone}
          onInstallPwa={pwa.triggerInstall}
        />
        <PwaInstallGuide
          open={pwa.installOpen}
          onClose={pwa.closeInstallGuide}
          deferredPrompt={pwa.deferredPrompt}
          onInstall={pwa.triggerInstall}
          isStandalone={pwa.isStandalone}
        />
      </div>
    </AppContext.Provider>
  )
}

function App() {
  const path = usePath()
  const request = useRemote('/workspace')
  const [out, setOut] = useState(false)
  const [logoutError, setLogoutError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const clearToasts = useClearToasts()
  const toast = useToast()
  const online = useOnlineStatus(() => {
    if (request.data) request.refresh()
  })
  const pwa = usePwaInstall(toast)

  useEffect(() => {
    if (request.data && !request.loading) {
      setUpdatedAt(new Date())
    }
  }, [request.data, request.loading])

  useEffect(() => {
    if (!request.data) return
    const check = () => {
      if (document.visibilityState === 'visible') request.refresh()
    }
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [Boolean(request.data), request.refresh])

  async function logout() {
    try {
      await api('/logout', 'POST')
      clearToasts()
      setLogoutError(null)
      setOut(true)
      go('/')
      request.refresh()
    } catch (error) {
      setLogoutError(error)
      toast.error(error.message)
    }
  }

  if (out || request.error?.status === 401 || request.error?.status === 403) {
    return (
      <>
        <OfflineBanner online={online} />
        <Login
          initialError={!out && request.error?.status === 403 ? request.error.message : ''}
          done={() => {
            setOut(false)
            request.refresh()
          }}
        />
      </>
    )
  }

  if (request.error) {
    return (
      <>
        <OfflineBanner online={online} />
        <div className="boot">
          <Card className="forbidden-card" title="Не удалось загрузить рабочее пространство">
            <ErrorBox error={request.error} />
            <div className="left-actions">
              <Button kind="primary" onClick={request.refresh}>Повторить</Button>
            </div>
          </Card>
        </div>
      </>
    )
  }

  if (!request.data) {
    return (
      <div className="boot">
        <Loading />
      </div>
    )
  }

  return (
    <>
      <ErrorBox error={logoutError} />
      <Shell
        path={path}
        workspace={request.data}
        refresh={request.refresh}
        refreshing={request.loading}
        updatedAt={updatedAt}
        online={online}
        pwa={pwa}
        logout={logout}
      />
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <ToastProvider>
    <App />
  </ToastProvider>
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let swRegistration = null
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(reg => { swRegistration = reg })
      .catch(() => {})
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      swRegistration?.update().catch(() => {})
    }
  })
}
