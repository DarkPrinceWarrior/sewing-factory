import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { matchesSearch } from './ui'

function normalizeEntry(entry) {
  if (Array.isArray(entry)) {
    const [key, label, unavailable = false, meta = ''] = entry
    return {
      key,
      label: String(label ?? ''),
      unavailable: Boolean(unavailable),
      meta: String(meta ?? ''),
      searchText: ''
    }
  }
  return {
    key: entry?.key ?? entry?.value ?? '',
    label: String(entry?.label ?? ''),
    unavailable: Boolean(entry?.unavailable ?? entry?.disabled),
    meta: String(entry?.meta ?? entry?.subtitle ?? ''),
    searchText: String(entry?.searchText ?? '')
  }
}

function highlightMatch(text, query) {
  const words = String(query || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length || !text) return text
  const escaped = words
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[её]/gi, '[её]'))
    .filter(Boolean)
  if (!escaped.length) return text
  const regex = new RegExp('(' + escaped.join('|') + ')', 'gi')
  const parts = String(text).split(regex)
  if (parts.length === 1) return text
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="picker-match">{part}</mark> : part))
}

function findNextEnabled(list, start, direction) {
  if (!list.length) return 0
  let i = start
  while (i >= 0 && i < list.length) {
    if (!list[i].unavailable) return i
    i += direction
  }
  return Math.max(0, Math.min(list.length - 1, start))
}

export function SearchPicker({
  entries = [],
  value = '',
  onChange,
  placeholder = 'Выберите…',
  required = false,
  disabled = false,
  clearable = false,
  id,
  className = '',
  'aria-describedby': description
}) {
  const popupId = useId()
  const root = useRef(null)
  const input = useRef(null)
  const popup = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [position, setPosition] = useState(null)

  const normalized = useMemo(() => entries.map(normalizeEntry), [entries])
  const selected = normalized.find(item => String(item.key) === String(value))
  const matches = useMemo(
    () => normalized.filter(item => matchesSearch(query, item.label, item.meta, item.searchText)),
    [normalized, query]
  )
  const safeIndex = Math.max(0, Math.min(index, Math.max(0, matches.length - 1)))
  const highlighted = matches[safeIndex]
  const optionId = offset => popupId + '-' + offset
  const showClear = !disabled && (clearable || !required) && Boolean(selected)

  function expand() {
    if (disabled) return
    setQuery('')
    const selectedIdx = normalized.findIndex(item => String(item.key) === String(value) && !item.unavailable)
    const firstEnabled = normalized.findIndex(item => !item.unavailable)
    setIndex(selectedIdx >= 0 ? selectedIdx : Math.max(0, firstEnabled))
    setOpen(true)
  }

  function closeMenu() {
    setOpen(false)
    setQuery('')
  }

  function choose(key) {
    onChange?.({ target: { value: String(key) } })
    closeMenu()
  }

  useEffect(() => {
    input.current?.setCustomValidity(required && !selected && query ? 'Выберите значение из списка.' : '')
  }, [query, selected, required])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    function place() {
      const anchor = root.current || input.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const margin = 12
      const minW = Math.min(260, window.innerWidth - margin * 2)
      const width = Math.min(Math.max(rect.width, minW), window.innerWidth - margin * 2)
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
      const high = Math.max(56, rect.top - 14)
      const low = Math.max(56, window.innerHeight - rect.bottom - 14)
      const above = low < 180 && high > low
      const maxHeight = Math.min(280, above ? high : low)
      setPosition({
        left,
        width,
        maxHeight,
        ...(above ? { bottom: window.innerHeight - rect.top + 5 } : { top: rect.bottom + 5 })
      })
    }
    function outside(e) {
      if (!root.current?.contains(e.target) && !popup.current?.contains(e.target)) {
        closeMenu()
      }
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', outside, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !popup.current) return
    const activeEl = popup.current.querySelector(`#${CSS.escape(optionId(safeIndex))}`)
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [open, safeIndex, matches.length])

  function keyboard(e) {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      closeMenu()
      return
    }
    if (e.key === 'Tab' && open) {
      closeMenu()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        expand()
        return
      }
      const direction = e.key === 'ArrowDown' ? 1 : -1
      setIndex(i => {
        const next = Math.max(0, Math.min(matches.length - 1, i + direction))
        return findNextEnabled(matches, next, direction)
      })
      return
    }
    if (e.key === 'Home' && open && matches.length) {
      e.preventDefault()
      setIndex(findNextEnabled(matches, 0, 1))
      return
    }
    if (e.key === 'End' && open && matches.length) {
      e.preventDefault()
      setIndex(findNextEnabled(matches, matches.length - 1, -1))
      return
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault()
      if (highlighted && !highlighted.unavailable) choose(highlighted.key)
    }
  }

  return (
    <div
      ref={root}
      className={'search-picker' + (showClear ? ' has-clear' : '') + (className ? ' ' + className : '')}
      data-open={open || undefined}
      data-escape-boundary={open || undefined}
      onBlur={e => {
        if (!root.current?.contains(e.relatedTarget) && !popup.current?.contains(e.relatedTarget)) {
          closeMenu()
        }
      }}
    >
      <input
        ref={input}
        id={id}
        aria-describedby={description}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-activedescendant={open && highlighted ? optionId(safeIndex) : undefined}
        autoComplete="off"
        placeholder={open ? selected?.label || placeholder : placeholder}
        required={required}
        disabled={disabled}
        value={open ? query : selected?.label || ''}
        onClick={() => { if (!open) expand() }}
        onKeyDown={keyboard}
        onChange={e => {
          setQuery(e.target.value)
          setIndex(0)
          setOpen(true)
        }}
      />
      {showClear && (
        <button
          type="button"
          className="picker-clear"
          tabIndex={-1}
          aria-label="Очистить выбор"
          title="Очистить выбор"
          onPointerDown={e => e.preventDefault()}
          onClick={() => {
            onChange?.({ target: { value: '' } })
            closeMenu()
            input.current?.focus()
          }}
        >
          ×
        </button>
      )}
      <button
        type="button"
        className="picker-toggle"
        tabIndex={-1}
        disabled={disabled}
        aria-expanded={open}
        aria-label={open ? 'Скрыть список' : 'Открыть список'}
        onPointerDown={e => e.preventDefault()}
        onClick={() => {
          if (disabled) return
          if (open) closeMenu()
          else {
            expand()
            input.current?.focus()
          }
        }}
      >
        <span aria-hidden="true" className="picker-chevron" />
      </button>
      {open && createPortal(
        <div
          className="picker-menu"
          id={popupId}
          ref={popup}
          role="listbox"
          data-picker-portal="true"
          data-escape-boundary="true"
          style={position || { visibility: 'hidden' }}
        >
          {matches.map((item, i) => {
            const isSelected = String(item.key) === String(value)
            return (
              <div
                key={item.key}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={item.unavailable || undefined}
                className={'picker-option' + (i === safeIndex ? ' highlighted' : '') + (isSelected ? ' is-selected' : '')}
                onMouseMove={() => { if (!item.unavailable && safeIndex !== i) setIndex(i) }}
                onPointerDown={e => e.preventDefault()}
                onClick={() => { if (!item.unavailable) choose(item.key) }}
              >
                <span className="picker-option-text">
                  <span className="picker-label picker-option-label">{highlightMatch(item.label, query)}</span>
                  {item.meta && <small className="picker-meta">{highlightMatch(item.meta, query)}</small>}
                </span>
                {isSelected && (
                  <svg className="picker-check select-check" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m3.5 8.2 3 3 6-6.4" />
                  </svg>
                )}
              </div>
            )
          })}
          {!matches.length && <div className="picker-empty" role="status">Ничего не найдено</div>}
        </div>,
        input.current?.closest('dialog') || document.body
      )}
    </div>
  )
}

export const SearchableSelect = SearchPicker

export function PasswordInput({ className = '', disabled = false, ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className={'password-control' + (className ? ' ' + className : '')}>
      <input {...props} disabled={disabled} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        disabled={disabled}
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        title={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        onPointerDown={e => e.preventDefault()}
        onClick={() => setVisible(v => !v)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
          <circle cx="10" cy="10" r="2.2" />
          {visible && <path d="M3 3l14 14" />}
        </svg>
      </button>
    </div>
  )
}
