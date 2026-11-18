import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export const AppContext = createContext(null)
export const useWorkspace = () => useContext(AppContext)

export const stages = { cut: 'Раскрой', sew: 'Пошив', pack: 'Упаковка', warehouse: 'Склад', office: 'Управление' }
export const shifts = { day: 'Дневная', evening: 'Вечерняя', night: 'Ночная' }
export const payments = { card: 'Банковская карта', cash: 'Наличные', transfer: 'Безналичный перевод' }
export const statuses = {
  draft: 'Черновик',
  posted: 'Проведён',
  in_transit: 'В пути',
  received: 'Получено',
  corrected: 'Исправлен',
  inactive: 'Не работает'
}

export const roleCanWrite = (user) => Boolean(user && ['admin', 'accountant'].includes(user.role))

const num = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })
const rubWhole = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const rubFrac = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })
const shortTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })

export const number = (x = 0) => {
  const v = Number(x ?? 0)
  return num.format(Number.isFinite(v) ? v : 0)
}

export const money = (x = 0) => {
  const v = Number(x ?? 0)
  if (!Number.isFinite(v)) return '—'
  const rounded = Math.round(v)
  return (rounded % 100 === 0 ? rubWhole : rubFrac).format(rounded / 100)
}

export const qty = (x = 0) => {
  const v = Number(x ?? 0)
  return number(Number.isFinite(v) ? v / 1000 : 0)
}

export const dayText = (s) => {
  if (!s) return '—'
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00+03:00')
  return Number.isNaN(d.getTime()) ? '—' : shortDate.format(d).replace(' г.', '')
}

export const timeText = (s) => {
  if (!s) return '—'
  const str = String(s)
  const d = new Date(str.length === 19 ? str + '+03:00' : str)
  return Number.isNaN(d.getTime()) ? '—' : shortTime.format(d)
}

export const dateTime = (s) => s ? dayText(s) + ' · ' + timeText(s) : '—'

export const monthText = (value) => {
  if (!value) return ''
  const d = new Date(String(value).slice(0, 7) + '-01T12:00:00+03:00')
  if (Number.isNaN(d.getTime())) return ''
  return monthFormatter.format(d).replace(' г.', '').replace(/^./, c => c.toUpperCase())
}

export const itemText = (item) => [item?.name, item?.size].filter(Boolean).join(' · ')
export const href = (path) => '#' + path

export function routeWith(path, filters) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v != null))
  return path + (params.size ? '?' + params : '')
}

export const normalizeText = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е')

export const matchesSearch = (search, ...columns) => {
  const values = columns.map(normalizeText)
  return normalizeText(search).trim().split(/\s+/).filter(Boolean).every(word => values.some(value => value.includes(word)))
}

export const go = (path) => { window.location.hash = path }

export const link = (path, options = {}) => {
  const clean = Object.entries(options).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return '/api' + path + (clean.length ? '?' + new URLSearchParams(clean) : '')
}

export async function api(path, method = 'GET', body, signal) {
  const response = await fetch('/api' + path, {
    method,
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (response.ok) return response.json()
  const result = await response.json().catch(() => null)
  const message = typeof result?.detail === 'string'
    ? result.detail
    : response.status === 422
      ? 'Проверьте обязательные поля, дату и допустимые значения.'
      : 'Не удалось выполнить действие.'
  const error = new Error(message)
  error.status = response.status
  throw error
}

export function useRemote(path, options) {
  const url = path ? link(path, options).slice(4) : ''
  const [revision, refresh] = useState(0)
  const [result, setResult] = useState({ url: '', revision: -1 })
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    api(url, 'GET', undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ url, revision, data })
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ url, revision, error })
    })
    return () => controller.abort()
  }, [url, revision])
  const view = result.url === url ? result : {}
  const reload = useCallback(() => refresh(n => n + 1), [])
  return { ...view, loading: Boolean(url) && view.revision !== revision, refresh: reload }
}

export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const lock = useRef(false)
  async function run(action) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try { await action() } catch (err) { setError(err) }
    finally { lock.current = false; setBusy(false) }
  }
  return { busy, error, run, clear: () => setError(null) }
}

/* --- Toast Notifications --- */
const noopToast = Object.assign(() => {}, {
  notify: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  dismiss: () => {},
  clear: () => {}
})
const ToastContext = createContext(noopToast)
export function useToast() { return useContext(ToastContext) }
export function useClearToasts() { return useContext(ToastContext).clear }

function ToastCard({ toast, onDismiss }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(() => (typeof document !== 'undefined' ? document.hidden : false))
  const isError = toast.kind === 'error' || Boolean(toast.error)
  const isInfo = toast.kind === 'info'
  const remaining = useRef(isError ? 10000 : 5500)

  useEffect(() => {
    const change = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])

  useEffect(() => {
    if (hovered || focused || hidden) return
    const started = performance.now()
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (performance.now() - started))
    }
  }, [toast.id, hovered, focused, hidden, onDismiss])

  return (
    <div
      className={'toast-card ' + (isError ? 'toast-error' : isInfo ? 'toast-info' : 'toast-success')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false) }}
    >
      <svg className="toast-icon" viewBox="0 0 20 20" aria-hidden="true">
        {isError ? (
          <>
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6v4.5M10 13.5h.01" />
          </>
        ) : isInfo ? (
          <>
            <circle cx="10" cy="10" r="8" />
            <path d="M10 9v5M10 6.2h.01" />
          </>
        ) : (
          <>
            <circle cx="10" cy="10" r="8" />
            <path d="m6.8 10.2 2.2 2.2 4.4-4.6" />
          </>
        )}
      </svg>
      <p className="toast-body" role={isError ? 'alert' : 'status'} aria-atomic="true">{toast.text}</p>
      <button type="button" className="toast-close" aria-label="Закрыть уведомление" onClick={() => onDismiss(toast.id)}>×</button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const seq = useRef(0)
  const dismiss = useCallback(id => setItems(prev => prev.filter(item => item.id !== id)), [])
  const clear = useCallback(() => setItems([]), [])
  const push = useCallback(msg => {
    const payload = typeof msg === 'string' ? { text: msg, kind: 'success' } : msg
    if (!payload?.text) return
    const isErr = payload.kind === 'error' || Boolean(payload.error)
    const kind = isErr ? 'error' : payload.kind === 'info' ? 'info' : 'success'
    const toast = {
      ...payload,
      kind,
      id: payload.id || `toast-${++seq.current}`,
      revision: ++seq.current
    }
    setItems(prev => [
      ...prev.filter(item => item.id !== toast.id && !(item.text === toast.text && item.kind === toast.kind)),
      toast
    ].slice(-3))
  }, [])

  const value = useMemo(() => {
    const fn = (msg) => push(msg)
    fn.notify = push
    fn.success = (text) => push({ text, kind: 'success' })
    fn.error = (text) => push({ text, kind: 'error', error: true })
    fn.info = (text) => push({ text, kind: 'info' })
    fn.dismiss = dismiss
    fn.clear = clear
    return fn
  }, [push, dismiss, clear])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' && items.length > 0 && createPortal(
        <div
          className="toast-viewport"
          onPointerDown={e => e.stopPropagation()}
          role="region"
          aria-label="Уведомления"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {items.map(t => <ToastCard key={`${t.id}-${t.revision}`} toast={t} onDismiss={dismiss} />)}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export const Toasts = ToastProvider

export function ToastMessage({ message, error = true }) {
  const toast = useToast()
  const id = useId()
  useEffect(() => {
    if (!message) return
    toast.notify({ text: message, kind: error ? 'error' : 'success', error, id })
    return () => toast.dismiss(id)
  }, [message, error, id, toast])
  return null
}

/* --- Layout & Core UI --- */
export function Button({ children, kind = 'secondary', size = '', to, className = '', ...props }) {
  const classes = ['button', kind, size, className].filter(Boolean).join(' ')
  return to
    ? <a className={classes} href={href(to)} {...props}>{children}</a>
    : <button type="button" className={classes} {...props}>{children}</button>
}

export function Download({ path, options = {}, children = 'Скачать Excel', disabled = false, className = '' }) {
  const action = useAction()
  const toast = useToast()
  async function save() {
    const response = await fetch(link(path, { ...options, xlsx: true }))
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(typeof error?.detail === 'string' ? error.detail : 'Не удалось подготовить Excel. Повторите попытку.')
    }
    const header = response.headers.get('Content-Disposition') || ''
    const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    const name = encoded ? decodeURIComponent(encoded) : (header.match(/filename="([^"]+)"/i)?.[1] || 'Выгрузка.xlsx')
    const url = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    toast.success('Файл Excel скачан')
  }
  return (
    <div className={'download-control' + (className ? ' ' + className : '')}>
      <Button disabled={disabled || action.busy} aria-busy={action.busy} onClick={() => action.run(save)}>
        <span aria-hidden="true" className="spreadsheet">XLSX</span>
        {action.busy ? 'Подготовка…' : children}
      </Button>
      <ErrorBox error={action.error} />
    </div>
  )
}

export function Page({ title, subtitle, actions, children }) {
  const ws = useWorkspace()
  const setPageHeading = ws?.setPageHeading
  useLayoutEffect(() => { setPageHeading?.(title) }, [setPageHeading, title])
  return (
    <>
      <header className="page-title">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </>
  )
}

export function Card({ title, subtitle, actions, className = '', children }) {
  return (
    <section className={'card' + (className ? ' ' + className : '')}>
      {(title || actions) && (
        <header className="card-title">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function ErrorBox({ error }) {
  return error ? <div className="notice error" role="alert">{typeof error === 'string' ? error : error.message}</div> : null
}

export function Loading({ text = 'Загрузка…' }) {
  return <div className="loading" role="status">{text}</div>
}

export function Guard({ request, children }) {
  if (request.error) return <ErrorBox error={request.error} />
  if (request.data === undefined) return <Loading />
  return children(request.data)
}

export function Field({ label, wide = false, className = '', children, help }) {
  const id = useId()
  return (
    <div className={'field' + (wide ? ' wide' : '') + (className ? ' ' + className : '')}>
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id, 'aria-describedby': help ? id + '-hint' : undefined })}
      {help && <small id={id + '-hint'}>{help}</small>}
    </div>
  )
}

function findEnabledSelectIndex(list, start, direction) {
  if (!list.length) return 0
  let i = Math.max(0, Math.min(list.length - 1, start))
  while (i >= 0 && i < list.length) {
    if (!list[i].disabled) return i
    i += direction
  }
  return Math.max(0, Math.min(list.length - 1, start))
}

export function Select({
  entries = [],
  placeholder,
  value,
  onChange,
  name,
  id,
  disabled = false,
  required = false,
  className = '',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  ...props
}) {
  const menuId = useId()
  const generatedId = useId()
  const controlId = id || generatedId
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState(null)

  const currentStr = value === undefined || value === null ? '' : String(value)

  const options = useMemo(() => {
    const list = entries.map(entry => {
      const [val, label, optDisabled = false] = Array.isArray(entry) ? entry : [entry, entry, false]
      return { value: String(val ?? ''), label: String(label ?? ''), disabled: Boolean(optDisabled), isClear: false }
    })
    if (placeholder && !required && !list.some(o => o.value === '')) {
      return [{ value: '', label: String(placeholder), disabled: false, isClear: true }, ...list]
    }
    return list
  }, [entries, placeholder, required])

  const selectedIndex = options.findIndex(o => o.value === currentStr)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null
  const safeIndex = Math.max(0, Math.min(activeIndex, Math.max(0, options.length - 1)))
  const displayLabel = selected ? selected.label : (placeholder || options[0]?.label || 'Выберите…')
  const isPlaceholder = !selected || selected.isClear

  function openMenu() {
    if (disabled || !options.length) return
    const start = selectedIndex >= 0 && !options[selectedIndex].disabled
      ? selectedIndex
      : findEnabledSelectIndex(options, 0, 1)
    setActiveIndex(start)
    setOpen(true)
  }

  function choose(val) {
    onChange?.({ target: { name, value: val } })
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    function place() {
      const anchor = triggerRef.current || rootRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const margin = 10
      const estHeight = Math.min(280, Math.max(48, options.length * 38 + 14))
      const spaceBelow = window.innerHeight - rect.bottom - margin
      const spaceAbove = rect.top - margin
      const openAbove = spaceBelow < Math.min(estHeight, 160) && spaceAbove > spaceBelow
      const maxHeight = Math.max(96, Math.min(280, openAbove ? spaceAbove : spaceBelow))
      const menuWidth = menuRef.current?.offsetWidth || 0
      const minWidth = Math.max(rect.width, className.includes('calendar-month-select') ? 148 : 0)
      const effectiveWidth = Math.max(minWidth, menuWidth)
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - effectiveWidth - margin))
      setPosition({
        left,
        minWidth,
        maxWidth: window.innerWidth - margin * 2,
        maxHeight,
        ...(openAbove ? { bottom: window.innerHeight - rect.top + 5 } : { top: rect.bottom + 5 })
      })
    }
    function outside(e) {
      if (!rootRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) {
        setOpen(false)
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus({ preventScroll: true })
      }
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, options.length, className])

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    const activeEl = menuRef.current.querySelector(`#${CSS.escape(`${menuId}-${safeIndex}`)}`)
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [open, safeIndex, options.length, menuId])

  function handleKeyDown(e) {
    if (disabled) return
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      return
    }
    if (e.key === 'Tab' && open) {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex(i => {
        const next = Math.max(0, Math.min(options.length - 1, i + dir))
        return findEnabledSelectIndex(options, next, dir)
      })
      return
    }
    if (e.key === 'Home' && open && options.length) {
      e.preventDefault()
      setActiveIndex(findEnabledSelectIndex(options, 0, 1))
      return
    }
    if (e.key === 'End' && open && options.length) {
      e.preventDefault()
      setActiveIndex(findEnabledSelectIndex(options, options.length - 1, -1))
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) {
        openMenu()
      } else {
        const opt = options[safeIndex]
        if (opt && !opt.disabled) choose(opt.value)
      }
      return
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ch = normalizeText(e.key)
      const start = open ? (safeIndex + 1) % options.length : 0
      const ordered = [...options.slice(start), ...options.slice(0, start)]
      const hit = ordered.find(o => !o.disabled && normalizeText(o.label).startsWith(ch))
      if (hit) {
        const idx = options.indexOf(hit)
        if (!open) openMenu()
        setActiveIndex(idx)
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={'select-root' + (disabled ? ' is-disabled' : '') + (className ? ' ' + className : '')}
      data-open={open || undefined}
      data-escape-boundary={open || undefined}
    >
      <button
        {...props}
        id={controlId}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open && options[safeIndex] ? `${menuId}-${safeIndex}` : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        className={'select-trigger' + (isPlaceholder ? ' is-placeholder' : '')}
        onClick={() => { if (!disabled) open ? setOpen(false) : openMenu() }}
        onKeyDown={handleKeyDown}
      >
        <span className="select-value">{displayLabel}</span>
        <svg className="select-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {!disabled && (
        <input
          className="select-validation-input"
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          value={currentStr}
          required={required}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1, minHeight: 0, padding: 0, border: 0 }}
          onChange={() => {}}
          onInvalid={e => {
            e.preventDefault()
            triggerRef.current?.focus()
            openMenu()
          }}
        />
      )}
      {open && createPortal(
        <div
          id={menuId}
          ref={menuRef}
          className="select-menu"
          role="listbox"
          aria-label={ariaLabel || placeholder || 'Список'}
          data-picker-portal="true"
          data-select-portal="true"
          data-escape-boundary="true"
          style={position || { visibility: 'hidden' }}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === currentStr
            const isActive = i === safeIndex
            return (
              <div
                key={opt.value + '-' + i}
                id={`${menuId}-${i}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled || undefined}
                className={'select-option' + (isSelected ? ' is-selected' : '') + (isActive ? ' is-active' : '') + (opt.disabled ? ' is-disabled' : '')}
                onMouseMove={() => { if (!opt.disabled && safeIndex !== i) setActiveIndex(i) }}
                onPointerDown={e => e.preventDefault()}
                onClick={() => { if (!opt.disabled) choose(opt.value) }}
              >
                <span className="select-option-label">{opt.label}</span>
                {isSelected && (
                  <svg className="select-check" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m3.5 8.2 3 3 6-6.4" />
                  </svg>
                )}
              </div>
            )
          })}
          {!options.length && <div className="picker-empty" role="status">Нет вариантов</div>}
        </div>,
        triggerRef.current?.closest('dialog') || document.body
      )}
    </div>
  )
}

/* --- Localized Calendar & DateRange --- */
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

function shiftIsoDate(iso, days) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

function shiftMonth(ym, delta) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ''
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1))
  return dt.toISOString().slice(0, 7)
}

function buildCalendarDays(viewYm) {
  const [y, m] = viewYm.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const mondayOffset = (first.getUTCDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1, 1 - mondayOffset + i))
    return {
      iso: dt.toISOString().slice(0, 10),
      day: dt.getUTCDate(),
      ym: dt.toISOString().slice(0, 7)
    }
  })
}

function currentMoscowToday() {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export function DateControl({
  value = '',
  month = false,
  inline = false,
  min,
  max,
  required = false,
  disabled = false,
  readOnly = false,
  onChange,
  name,
  id,
  className = '',
  placeholder,
  ...props
}) {
  const ws = useWorkspace()
  const today = ws?.today || currentMoscowToday()
  const panelId = useId()
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)

  const minBound = min ? String(min).slice(0, month ? 7 : 10) : ''
  const maxBound = max ? String(max).slice(0, month ? 7 : 10) : ''
  const normalizedValue = value ? String(value).slice(0, month ? 7 : 10) : ''

  function clampInitialYm() {
    if (normalizedValue && /^\d{4}-\d{2}/.test(normalizedValue)) return normalizedValue.slice(0, 7)
    const todayYm = today.slice(0, 7)
    if (minBound && todayYm < minBound.slice(0, 7)) return minBound.slice(0, 7)
    if (maxBound && todayYm > maxBound.slice(0, 7)) return maxBound.slice(0, 7)
    return todayYm
  }

  const [viewYm, setViewYm] = useState(clampInitialYm)
  const [focusDay, setFocusDay] = useState(() => normalizedValue || today)
  const keyboardMoved = useRef(false)

  useEffect(() => {
    if (open) {
      const nextYm = clampInitialYm()
      setViewYm(nextYm)
      setFocusDay(normalizedValue || (minBound && today < minBound ? minBound : maxBound && today > maxBound ? maxBound : today))
    }
  }, [open, normalizedValue])

  const isDayAllowed = useCallback((iso) => {
    if (!iso || iso.length !== 10) return false
    if (minBound && iso < minBound) return false
    if (maxBound && iso > maxBound) return false
    return true
  }, [minBound, maxBound])

  const isMonthAllowed = useCallback((ym) => {
    if (!ym || ym.length !== 7) return false
    if (minBound && ym < minBound.slice(0, 7)) return false
    if (maxBound && ym > maxBound.slice(0, 7)) return false
    return true
  }, [minBound, maxBound])

  function choose(next) {
    onChange?.({ target: { name, value: next } })
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    function place() {
      const anchor = triggerRef.current || rootRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const margin = 12
      const width = month ? 256 : 292
      const estHeight = month ? 270 : 340
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
      const spaceBelow = window.innerHeight - rect.bottom - margin
      const spaceAbove = rect.top - margin
      const above = spaceBelow < estHeight && spaceAbove > spaceBelow
      const maxHeight = Math.max(200, Math.min(390, above ? spaceAbove : spaceBelow))
      setPosition({
        left,
        width,
        maxHeight,
        ...(above ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 })
      })
    }
    function outside(e) {
      if (!rootRef.current?.contains(e.target) && !popoverRef.current?.contains(e.target) && !e.target.closest?.('[data-select-portal]')) {
        setOpen(false)
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        if (popoverRef.current?.querySelector('[aria-expanded="true"]')) return
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus({ preventScroll: true })
      }
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, month])

  useEffect(() => {
    if (!open || !keyboardMoved.current || !popoverRef.current) return
    keyboardMoved.current = false
    const btn = popoverRef.current.querySelector(`[data-iso="${focusDay}"]`)
    btn?.focus({ preventScroll: true })
  }, [open, focusDay, viewYm])

  function handleGridKey(e, iso) {
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (!(e.key in deltas)) return
    e.preventDefault()
    const next = shiftIsoDate(iso, deltas[e.key])
    if (!next) return
    keyboardMoved.current = true
    setViewYm(next.slice(0, 7))
    setFocusDay(next)
  }

  const display = normalizedValue
    ? (month ? monthText(normalizedValue) : dayText(normalizedValue))
    : (placeholder || (month ? 'Выберите месяц' : 'Выберите дату'))

  const viewYear = Number(viewYm.slice(0, 4)) || Number(today.slice(0, 4))
  const viewMonthIndex = (Number(viewYm.slice(5, 7)) || 1) - 1
  const days = useMemo(() => (month ? [] : buildCalendarDays(viewYm)), [month, viewYm])
  const todayAllowed = month ? isMonthAllowed(today.slice(0, 7)) : isDayAllowed(today)

  return (
    <span
      ref={rootRef}
      className={'date-control' + (inline ? ' date-inline' : '') + (disabled ? ' is-disabled' : '') + (className ? ' ' + className : '')}
      data-open={open || undefined}
      data-escape-boundary={open || undefined}
    >
      <button
        {...props}
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={'date-trigger' + (inline ? ' is-inline' : '') + (!normalizedValue ? ' is-empty' : '')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => { if (!disabled && !readOnly) setOpen(o => !o) }}
      >
        <span className="date-trigger-text">{display}</span>
        {!inline && (
          <svg className="date-icon" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="3" y="4.5" width="14" height="12.5" rx="2.2" />
            <path d="M3 8.5h14M7 2.8v3M13 2.8v3" />
          </svg>
        )}
        {inline && <i aria-hidden="true" />}
      </button>
      {!disabled && !readOnly && (
        <input
          className="date-validation"
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          value={normalizedValue}
          required={required}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1, minHeight: 0, padding: 0, border: 0 }}
          onChange={() => {}}
          onInvalid={e => {
            e.preventDefault()
            triggerRef.current?.focus()
            setOpen(true)
          }}
        />
      )}
      {open && createPortal(
        <div
          id={panelId}
          ref={popoverRef}
          className="calendar-popover"
          role="dialog"
          aria-modal="false"
          aria-label={month ? 'Выбор месяца' : 'Выбор даты'}
          data-picker-portal="true"
          data-escape-boundary="true"
          style={position || { visibility: 'hidden' }}
        >
          <div className="calendar-nav">
            <button
              type="button"
              className="calendar-nav-btn"
              aria-label={month ? 'Предыдущий год' : 'Предыдущий месяц'}
              onClick={() => setViewYm(shiftMonth(viewYm, month ? -12 : -1))}
            >
              ‹
            </button>
            <div className="calendar-title-controls">
              {!month && (
                <Select
                  className="calendar-month-select"
                  aria-label="Месяц"
                  value={String(viewMonthIndex + 1)}
                  entries={MONTHS_FULL.map((mName, idx) => [String(idx + 1), mName])}
                  onChange={e => setViewYm(`${String(viewYear).padStart(4, '0')}-${String(e.target.value).padStart(2, '0')}`)}
                />
              )}
              <input
                type="number"
                className="calendar-year calendar-year-input"
                aria-label="Год"
                min="2000"
                max="2099"
                step="1"
                value={viewYear}
                onChange={e => {
                  const y = Number(e.target.value)
                  if (Number.isInteger(y) && y >= 2000 && y <= 2099) {
                    setViewYm(`${y}-${String(viewMonthIndex + 1).padStart(2, '0')}`)
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="calendar-nav-btn"
              aria-label={month ? 'Следующий год' : 'Следующий месяц'}
              onClick={() => setViewYm(shiftMonth(viewYm, month ? 12 : 1))}
            >
              ›
            </button>
          </div>
          {month ? (
            <div className="calendar-months" role="group" aria-label="Месяцы">
              {MONTHS_SHORT.map((label, idx) => {
                const ym = `${String(viewYear).padStart(4, '0')}-${String(idx + 1).padStart(2, '0')}`
                const allowed = isMonthAllowed(ym)
                const selected = normalizedValue === ym
                const current = today.slice(0, 7) === ym
                return (
                  <button
                    key={ym}
                    type="button"
                    disabled={!allowed}
                    className={'calendar-month-btn' + (selected ? ' is-selected' : '') + (current ? ' is-today' : '')}
                    aria-pressed={selected}
                    onClick={() => choose(ym)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ) : (
            <table className="calendar-grid" role="grid" aria-label={`${MONTHS_FULL[viewMonthIndex]} ${viewYear}`}>
              <thead>
                <tr>{WEEKDAYS.map(w => <th key={w} scope="col">{w}</th>)}</tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }, (_, week) => (
                  <tr key={week}>
                    {days.slice(week * 7, week * 7 + 7).map(cell => {
                      const allowed = isDayAllowed(cell.iso)
                      const selected = normalizedValue === cell.iso
                      const isToday = cell.iso === today
                      const outside = cell.ym !== viewYm
                      return (
                        <td key={cell.iso}>
                          <button
                            type="button"
                            data-iso={cell.iso}
                            disabled={!allowed}
                            aria-selected={selected}
                            aria-current={isToday ? 'date' : undefined}
                            className={'calendar-day' + (outside ? ' outside-month' : '') + (selected ? ' is-selected' : '') + (isToday ? ' is-today' : '')}
                            onKeyDown={e => handleGridKey(e, cell.iso)}
                            onClick={() => choose(cell.iso)}
                          >
                            {cell.day}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="calendar-footer">
            <button
              type="button"
              className="text-button"
              disabled={!todayAllowed}
              onClick={() => choose(month ? today.slice(0, 7) : today)}
            >
              {month ? 'Текущий месяц' : 'Сегодня'}
            </button>
            {!required && normalizedValue && (
              <button type="button" className="text-button" onClick={() => choose('')}>
                Очистить
              </button>
            )}
          </div>
        </div>,
        triggerRef.current?.closest('dialog') || document.body
      )}
    </span>
  )
}

export function DateRange({ filters, change, presets = true, allowClear = true, onRangeChange }) {
  const ws = useWorkspace()
  const today = ws?.today || currentMoscowToday()
  const openMonth = ws?.settings?.open_month

  const presetList = useMemo(() => {
    const list = [
      { id: 'today', label: 'Сегодня', start: today, end: today },
      { id: 'week', label: 'Неделя', start: shiftIsoDate(today, -6), end: today },
      { id: 'month', label: 'Месяц', start: today.slice(0, 7) + '-01', end: today }
    ]
    if (openMonth) {
      const openStart = openMonth + '-01'
      if (openStart !== today.slice(0, 7) + '-01') {
        list.push({ id: 'open', label: 'Открытый период', start: openStart, end: today })
      } else {
        list.push({ id: 'open', label: 'Открытый период', start: openStart, end: today })
      }
    }
    if (allowClear) {
      list.push({ id: 'all', label: 'Весь период', start: '', end: '' })
    }
    return list
  }, [today, openMonth, allowClear])

  function applyRange(start, end) {
    if (onRangeChange) {
      onRangeChange(start, end)
      return
    }
    change('start', start)
    change('end', end)
  }

  return (
    <>
      {presets && (
        <div className="field wide">
          <span className="date-presets-label">Быстрый период</span>
          <div className="date-presets" role="group" aria-label="Быстрый выбор периода">
            {presetList.map(p => {
              const active = (filters.start || '') === p.start && (filters.end || '') === p.end
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  className={'date-preset' + (active ? ' is-active' : '')}
                  onClick={() => applyRange(p.start, p.end)}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <Field label="С даты">
        <DateControl
          value={filters.start || ''}
          max={filters.end || undefined}
          onChange={e => change('start', e.target.value)}
        />
      </Field>
      <Field label="По дату">
        <DateControl
          value={filters.end || ''}
          min={filters.start || undefined}
          onChange={e => change('end', e.target.value)}
        />
      </Field>
    </>
  )
}

/* --- Tabs, Status, Tables, EmptyState, Pagination --- */
export function Tabs({ items, value, onChange, label = 'Вкладки', style = 'pills' }) {
  return (
    <nav className={'tabs ' + style} aria-label={label}>
      {items.map(([id, name]) => (
        <button key={id} type="button" aria-current={value === id ? 'page' : undefined} onClick={() => onChange(id)}>
          {name}
        </button>
      ))}
    </nav>
  )
}

export function Status({ value, label }) {
  return <span className={'status ' + value}>{label || statuses[value] || value}</span>
}

export function EmptyState({ icon, title = 'Записей пока нет', description, action, className = '' }) {
  return (
    <div className={'empty-state' + (className ? ' ' + className : '')}>
      {icon !== false && (
        <span className="empty-state-icon" aria-hidden="true">
          {icon || (
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
          )}
        </span>
      )}
      <strong className="empty-state-title">{title}</strong>
      {description && <p className="empty-state-text">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}

export function Table({
  columns,
  rows,
  empty = 'Записей пока нет',
  label = 'Таблица',
  rowKey,
  hasPager = false,
  footer = null,
  className = '',
  onRowClick
}) {
  return (
    <div className={'table-frame' + (hasPager ? ' has-pagination' : '') + (className ? ' ' + className : '')}>
      <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
        <table aria-label={label}>
          <colgroup>
            {columns.map((column, i) => <col key={i} style={column.width ? { width: column.width } : undefined} />)}
          </colgroup>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th scope="col" key={i} className={[col.align, col.className].filter(Boolean).join(' ')}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={rowKey?.(row) ?? row.id ?? row.item_id ?? i}
                className={onRowClick ? 'is-clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              >
                {columns.map((col, j) => (
                  <td key={j} className={[col.align, col.className].filter(Boolean).join(' ')}>
                    {col.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length} className="empty">
                  {typeof empty === 'string' ? <EmptyState title={empty} /> : empty}
                </td>
              </tr>
            )}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
    </div>
  )
}

export function Pager({ page, size = 15, total, change, onSizeChange, pageSizes = [15, 30, 50] }) {
  const end = Math.max(1, Math.ceil(total / size))
  if (!total) return null
  const safePage = Math.max(1, Math.min(page, end))
  const from = (safePage - 1) * size + 1
  const to = Math.min(total, safePage * size)

  return (
    <div className="pager">
      <div className="pager-info">
        <span role="status">
          {total <= size && !onSizeChange
            ? 'Показано: ' + number(total)
            : 'Показано ' + number(from) + '–' + number(to) + ' из ' + number(total)}
        </span>
        {onSizeChange && (
          <label className="pager-size">
            <span>На странице</span>
            <Select
              aria-label="Записей на странице"
              value={String(size)}
              entries={pageSizes.map(n => [String(n), String(n)])}
              onChange={e => onSizeChange(Number(e.target.value))}
            />
          </label>
        )}
      </div>
      {end > 1 && (
        <div className="actions">
          {end > 2 && (
            <Button className="pager-btn" aria-label="Первая страница" disabled={safePage <= 1} onClick={() => change(1)}>
              «
            </Button>
          )}
          <Button className="pager-btn" aria-label="Предыдущая страница" disabled={safePage <= 1} onClick={() => change(safePage - 1)}>
            Назад
          </Button>
          <span className="pager-pages">Страница {number(safePage)} из {number(end)}</span>
          <Button className="pager-btn" aria-label="Следующая страница" disabled={safePage >= end} onClick={() => change(safePage + 1)}>
            Далее
          </Button>
          {end > 2 && (
            <Button className="pager-btn" aria-label="Последняя страница" disabled={safePage >= end} onClick={() => change(end)}>
              »
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export const TablePagination = Pager

/* --- Filters, QuickFilters, RegistryTools --- */
export function useFilters(scope, initial = {}) {
  const ws = useWorkspace()
  const registryState = ws?.registryState
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const overrides = Object.fromEntries(Object.keys(initial).flatMap(key => {
    if (!params.has(key)) return []
    const value = params.get(key)
    if (key === 'month' && !/^20\d\d-(0[1-9]|1[0-2])$/.test(value)) return []
    if (['start', 'end', 'day'].includes(key) && value) {
      const parsed = new Date(value + 'T00:00:00Z')
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return []
    }
    return [[key, value]]
  }))
  const key = scope + '?' + new URLSearchParams(overrides)
  const [entry, setEntry] = useState(() => registryState?.get(key) ?? { filters: { ...initial, ...overrides }, page: 1 })
  const { filters, page } = entry
  const hasFilters = Object.keys(initial).some(k => k !== 'search' && filters[k] !== initial[k])

  useEffect(() => {
    if (!registryState) return
    registryState.set(key, entry)
    registryState.set(scope + '?', entry)
  }, [registryState, key, scope, entry])

  const setPage = useCallback(nextPage => setEntry(prev => ({ ...prev, page: nextPage })), [])
  const change = useCallback((k, value) => setEntry(prev => ({ filters: { ...prev.filters, [k]: value }, page: 1 })), [])
  const update = useCallback((patch) => setEntry(prev => ({ filters: { ...prev.filters, ...patch }, page: 1 })), [])
  const clearFilter = useCallback((keys) => {
    const list = Array.isArray(keys) ? keys : [keys]
    setEntry(prev => {
      const next = { ...prev.filters }
      for (const k of list) next[k] = initial[k] ?? ''
      return { filters: next, page: 1 }
    })
  }, [initial])
  const reset = useCallback(() => setEntry(prev => ({
    filters: { ...initial, ...('search' in prev.filters ? { search: prev.filters.search } : {}) },
    page: 1
  })), [initial])

  return { filters, page, hasFilters, initial, setPage, change, update, clearFilter, reset }
}

export function useSearchOptions(filters) {
  const search = filters.search || ''
  const [ready, setReady] = useState(search)
  useEffect(() => {
    const timeout = setTimeout(() => setReady(search), 220)
    return () => clearTimeout(timeout)
  }, [search])
  return { options: { ...filters, ...('search' in filters ? { search: ready } : {}) }, pending: ready !== search }
}

function popupContains(root, target) {
  if (!root || !target) return false
  if (root.contains(target)) return true
  if (target.closest?.('[data-picker-portal]')) return true
  return [...root.querySelectorAll('[aria-controls]')].some(control =>
    (control.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean).some(id =>
      root.ownerDocument.getElementById(id)?.contains(target)))
}

export function QuickFilters({ active = false, activeCount = 0, label = 'Быстрые фильтры', onReset, hasActive, className = '', children }) {
  const panelId = useId()
  const disclosure = useRef(null)
  const panelRef = useRef(null)
  const [alignRight, setAlignRight] = useState(false)

  function closePanel() {
    if (disclosure.current?.open) {
      disclosure.current.open = false
      disclosure.current.querySelector('summary')?.focus({ preventScroll: true })
    }
  }

  const placePanel = useCallback(() => {
    const el = disclosure.current
    const panel = panelRef.current
    if (!el || !el.open || !panel) return
    const triggerRect = el.getBoundingClientRect()
    const panelWidth = panel.offsetWidth || 360
    const overflowsRight = triggerRect.left + panelWidth > window.innerWidth - 16
    const fitsRightAligned = triggerRect.right - panelWidth >= 16
    setAlignRight(overflowsRight && fitsRightAligned)
  }, [])

  useEffect(() => {
    const element = disclosure.current
    if (!element) return
    const outside = event => {
      if (element.open && !popupContains(element, event.target)) element.open = false
    }
    const escape = event => {
      if (!element.open || event.key !== 'Escape' || event.defaultPrevented) return
      if (element.querySelector('[role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"]')) return
      const shouldFocusSummary = popupContains(element, event.target)
      event.preventDefault()
      element.open = false
      if (shouldFocusSummary) element.querySelector('summary')?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', placePanel)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', placePanel)
    }
  }, [placePanel])

  const count = activeCount > 0 ? activeCount : (active ? 1 : 0)

  return (
    <details
      ref={disclosure}
      className={'quick-filters' + (className ? ' ' + className : '')}
      onToggle={e => { if (e.currentTarget.open) placePanel() }}
    >
      <summary className="button secondary" aria-controls={panelId}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14l-5.5 6.5v4L8.5 16v-5.5L3 4Z" /></svg>
        <span>{label}</span>
        {count > 0 && <span className="filter-count" aria-label="Применены фильтры">{activeCount > 0 ? activeCount : ''}</span>}
      </summary>
      <div id={panelId} ref={panelRef} className={'quick-panel' + (alignRight ? ' quick-panel-right' : '')}>
        {children}
        <div className="quick-panel-actions">
          {onReset && (
            <Button kind="ghost" size="small" disabled={!hasActive} onClick={onReset}>
              Сбросить
            </Button>
          )}
          <Button kind="secondary" size="small" onClick={closePanel}>
            Готово
          </Button>
        </div>
      </div>
    </details>
  )
}

export function RegistryTools({ state, placeholder, periodLabel = false, total, filterLabels, children }) {
  const { filters, initial = {}, change, update, hasFilters, reset } = state
  const ws = useWorkspace()
  const items = ws?.items || []
  const warehouses = ws?.warehouses || []

  const place = warehouses.find(w => String(w.id) === String(filters.warehouse))?.city
  const product = items.find(i => String(i.id) === String(filters.item))
  const status = statuses[filters.status] || ({ '1': 'Работает', '0': 'Не работает' }[filters.status])

  const dateCaption = filters.start && filters.end
    ? (filters.start === filters.end ? dayText(filters.start) : dayText(filters.start) + ' — ' + dayText(filters.end))
    : filters.start
      ? 'С ' + dayText(filters.start)
      : filters.end
        ? 'По ' + dayText(filters.end)
        : 'Весь период'

  const clearKeys = (keys) => {
    const patch = Object.fromEntries(keys.map(k => [k, initial[k] ?? '']))
    if (update) update(patch)
    else keys.forEach(k => change(k, initial[k] ?? ''))
  }

  const chips = []
  const hasDateFilter = Boolean(filters.start || filters.end)
  const dateChanged = (filters.start || '') !== (initial.start || '') || (filters.end || '') !== (initial.end || '')
  if (periodLabel || hasDateFilter) {
    const canRemoveDate = dateChanged || (hasDateFilter && !initial.start && !initial.end)
    chips.push({
      key: 'period',
      label: 'Период',
      value: dateCaption,
      removable: canRemoveDate,
      onRemove: () => clearKeys(['start', 'end'])
    })
  }

  const knownFormatters = {
    stage: { label: 'Этап', format: v => stages[v] || v },
    status: { label: 'Статус', format: v => statuses[v] || ({ '1': 'Работает', '0': 'Не работает' }[v]) || v },
    size: { label: 'Размер', format: v => v },
    category: { label: 'Категория', format: v => v },
    warehouse: { label: 'Склад', format: v => place || v },
    item: { label: 'Товар', format: v => (product ? itemText(product) : v) }
  }

  for (const [key, val] of Object.entries(filters)) {
    if (['search', 'start', 'end', 'tab', 'page', 'day', 'month'].includes(key)) continue
    if (val === '' || val == null) continue
    if (key in initial && val === initial[key] && !val) continue
    const custom = filterLabels?.[key]
    const known = knownFormatters[key]
    const labelText = typeof custom === 'string' ? custom : custom?.label || known?.label || key
    const formatted = typeof custom === 'object' && custom?.format
      ? custom.format(val)
      : known
        ? known.format(val)
        : String(val)
    if (!formatted) continue
    chips.push({
      key,
      label: labelText,
      value: formatted,
      removable: val !== (initial[key] ?? ''),
      onRemove: () => clearKeys([key])
    })
  }

  const activeCount = (dateChanged ? 1 : 0) + chips.filter(c => c.key !== 'period' && c.removable).length

  return (
    <div className="registry-controls">
      <div className="registry-toolbar">
        {placeholder && (
          <div className="registry-search">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5" />
              <path d="m12.2 12.2 4 4" />
            </svg>
            <input
              type="search"
              aria-label="Поиск"
              placeholder={placeholder}
              value={filters.search || ''}
              maxLength={100}
              onKeyDown={e => {
                if (e.key === 'Escape' && filters.search) {
                  e.preventDefault()
                  e.stopPropagation()
                  change('search', '')
                }
              }}
              onChange={e => change('search', e.target.value)}
            />
            {filters.search && (
              <button
                type="button"
                aria-label="Очистить поиск"
                onClick={e => {
                  e.currentTarget.parentElement.querySelector('input').focus()
                  change('search', '')
                }}
              >
                ×
              </button>
            )}
          </div>
        )}
        {children && <QuickFilters active={hasFilters} activeCount={activeCount} hasActive={hasFilters} onReset={reset}>{children}</QuickFilters>}
        {total !== undefined && total !== null && (
          <span className="registry-result-count" role="status">Найдено: {number(total)}</span>
        )}
      </div>
      {(chips.length > 0 || hasFilters) && (
        <div className="registry-filter-row">
          <div className="filter-chips">
            {chips.map(chip =>
              chip.removable ? (
                <button
                  key={chip.key}
                  type="button"
                  className="filter-chip"
                  aria-label={`Снять фильтр: ${chip.label} — ${chip.value}`}
                  onClick={chip.onRemove}
                >
                  <span className="filter-chip-label">{chip.label}: <strong>{chip.value}</strong></span>
                  <span className="filter-chip-x" aria-hidden="true">×</span>
                </button>
              ) : (
                <span key={chip.key} className="filter-chip static">
                  <span className="filter-chip-label">{chip.label}: <strong>{chip.value}</strong></span>
                </span>
              )
            )}
          </div>
          {hasFilters && <Button kind="ghost" className="filter-reset" onClick={reset}>Сбросить фильтры</Button>}
        </div>
      )}
    </div>
  )
}

/* --- Modals & Dialogs --- */
let openDialogCount = 0
let savedBodyOverflow = ''

export function Dialog({ title, close, children, footer = null, closeDisabled = false, className = '' }) {
  const ref = useRef(null)
  const contentRef = useRef(null)
  const backdropDown = useRef(false)
  const id = useId()

  useEffect(() => {
    const el = ref.current
    const opener = document.activeElement
    if (openDialogCount === 0) {
      savedBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    openDialogCount += 1

    if (el && !el.open) el.showModal()

    const focusTarget = contentRef.current?.querySelector(
      '[autofocus], input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled])'
    )
    if (focusTarget) focusTarget.focus({ preventScroll: true })

    return () => {
      if (el?.open) el.close()
      openDialogCount = Math.max(0, openDialogCount - 1)
      if (openDialogCount === 0) {
        document.body.style.overflow = savedBodyOverflow
      }
      if (opener && opener.isConnected && opener !== document.body && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true })
      }
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={className || undefined}
      onCancel={e => {
        e.preventDefault()
        if (closeDisabled) return
        if (document.querySelector('[data-picker-portal]')) return
        close?.()
      }}
      onPointerDown={e => { backdropDown.current = (e.target === e.currentTarget) }}
      onClick={e => {
        if (!closeDisabled && backdropDown.current && e.target === e.currentTarget) close?.()
        backdropDown.current = false
      }}
    >
      <section className="dialog-body dialog-layout dialog-shell">
        <header className="card-title dialog-head">
          <h2 id={id}>{title}</h2>
          <Button
            className="icon-only"
            aria-label="Закрыть"
            disabled={closeDisabled}
            onClick={() => { if (!closeDisabled) close?.() }}
          >
            ×
          </Button>
        </header>
        <div ref={contentRef} className="dialog-content dialog-scroll">
          {children}
        </div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </section>
    </dialog>
  )
}

export function FormActions({ busy, cancel, submit = 'Сохранить', form }) {
  return (
    <div className="form-actions dialog-footer">
      <Button disabled={busy} onClick={cancel}>Отмена</Button>
      <Button type="submit" form={form} kind="primary" disabled={busy}>{busy ? 'Сохранение…' : submit}</Button>
    </div>
  )
}

export function Confirm({ title, text, close, action, submit = 'Подтвердить', kind = 'primary' }) {
  const state = useAction()
  return (
    <Dialog title={title} closeDisabled={state.busy} close={() => { if (!state.busy) close() }}>
      <form onSubmit={e => { e.preventDefault(); state.run(action) }}>
        <p className="modal-description">{text}</p>
        <ErrorBox error={state.error} />
        <div className="form-actions dialog-footer">
          <Button disabled={state.busy} onClick={close}>Отмена</Button>
          <Button type="submit" kind={kind} disabled={state.busy}>{state.busy ? 'Выполнение…' : submit}</Button>
        </div>
      </form>
    </Dialog>
  )
}

export function ActionRow({ children }) { return <div className="action-row">{children}</div> }

export function Details({ values }) {
  return (
    <dl className="details">
      {values.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value ?? '—'}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}
