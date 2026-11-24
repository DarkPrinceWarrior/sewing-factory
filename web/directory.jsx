import React, { useEffect, useId, useMemo, useState } from 'react'
import {
  ActionRow, Button, DateControl, DateRange, Details, Dialog, Download, ErrorBox,
  Field, FormActions, Guard, MetricStrip, Page, Pager, RegistryTools, Section, Select,
  Status, Table, Tabs, Toggle, api, dayText, duration, go, href, itemText, matchesSearch,
  money, monthText, number, qty, roleCanWrite, routeWith, stages, useAction, useFilters,
  useRemote, useToast, useWorkspace
} from './ui'
import { PasswordInput, SearchPicker } from './pickers'

const production = Object.entries(stages).slice(0, 3)

const MATERIAL_UNITS = [
  ['м', 'м (метры)'],
  ['шт.', 'шт. (штуки)'],
  ['кг', 'кг (килограммы)'],
  ['рул.', 'рул. (рулоны)'],
  ['уп.', 'уп. (упаковки)'],
  ['компл.', 'компл. (комплекты)']
]

const edit = (set, key, numeric = false) => e =>
  set(v => ({ ...v, [key]: numeric ? Number(e.target.value) : e.target.value }))

const isFractionalUnit = unit => unit === 'м' || unit === 'кг'

function toRubInput(kopecks) {
  if (kopecks == null || kopecks === 0) return '0'
  return String(Math.round(kopecks) / 100)
}

function parseRubToKopecks(value) {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) : 0
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function specTitle(ver) {
  if (!ver) return '—'
  const raw = (ver.name || '').trim()
  if (!raw) return 'Спецификация ' + ver.version
  if (raw.toLowerCase().startsWith('спецификация')) return raw
  return 'Спецификация ' + ver.version + ' · ' + raw
}

function specOptionLabel(ver, isLatest) {
  return specTitle(ver) + ' · ' + dayText(ver.effective) + (isLatest ? ' (актуальная)' : '')
}

function monthBounds(ym) {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  const lastDay = String(new Date(y, m, 0).getDate()).padStart(2, '0')
  return [`${ym}-01`, `${ym}-${lastDay}`]
}

function shiftMonthYm(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}

function formatSignedQty(delta, unit) {
  if (!delta) return 'Без изменений'
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${qty(Math.abs(delta))} ${unit}`
}

function formatSignedMoney(delta) {
  if (!delta) return 'Без изменений'
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${money(Math.abs(delta))}`
}

function LocalPager({ rows, columns, page, setPage, label, empty, footer, mobileSummary, rowKey, rowHref, flush = false, className = '' }) {
  const [size, setSize] = useState(15)
  const maxPage = Math.max(1, Math.ceil(rows.length / size))
  const safePage = Math.min(page, maxPage)
  return (
    <>
      <Table
        columns={columns}
        rows={rows.slice((safePage - 1) * size, safePage * size)}
        label={label}
        empty={empty}
        footer={footer}
        mobileSummary={mobileSummary}
        rowKey={rowKey}
        rowHref={rowHref}
        flush={flush}
        className={className}
        hasPager={rows.length > 0}
      />
      <Pager
        page={safePage}
        change={setPage}
        total={rows.length}
        size={size}
        onSizeChange={next => {
          setSize(next)
          setPage(1)
        }}
      />
    </>
  )
}

/* --- Каталог и спецификации --- */
export function Catalog() {
  const { items, specs = [], user } = useWorkspace()
  const state = useFilters('catalog', { search: '', category: '', size: '' })
  const { filters, page, setPage, change } = state
  const products = useMemo(() => items.filter(i => i.kind === 'product'), [items])
  const specsByProduct = useMemo(() => {
    const map = new Map()
    for (const s of specs) {
      const list = map.get(s.product_id) || []
      list.push(s)
      map.set(s.product_id, list)
    }
    return map
  }, [specs])
  const categories = useMemo(() => [...new Set(products.map(i => i.category).filter(Boolean))], [products])
  const sizes = useMemo(() => [...new Set(products.map(i => i.size).filter(Boolean))], [products])
  const rows = products.filter(
    i =>
      matchesSearch(filters.search, i.name, i.size, i.sku, i.category) &&
      (!filters.category || i.category === filters.category) &&
      (!filters.size || i.size === filters.size)
  )

  return (
    <Page
      title="Изделия и нормы"
      subtitle="Модели, размеры, спецификации материалов и сдельные расценки"
      actions={roleCanWrite(user) && <Button kind="primary" to="/catalog/new">Добавить изделие</Button>}
    >
      <RegistryTools state={state} total={rows.length} placeholder="Модель, артикул или размер">
        {categories.length > 1 && (
          <Field label="Категория" wide>
            <Select
              placeholder="Все категории"
              entries={categories}
              value={filters.category}
              onChange={e => change('category', e.target.value)}
            />
          </Field>
        )}
        <Field label="Размер" wide>
          <Select
            placeholder="Все размеры"
            entries={sizes}
            value={filters.size}
            onChange={e => change('size', e.target.value)}
          />
        </Field>
      </RegistryTools>
      <LocalPager
        page={page}
        setPage={setPage}
        label="Изделия и нормы"
        empty="Изделия по этому запросу не найдены"
        rows={rows}
        rowHref={r => '/catalog/' + r.id}
        columns={[
          {
            label: 'Изделие',
            primary: true,
            cell: r => (
              <>
                <a href={href('/catalog/' + r.id)}>{r.name}</a>
                {r.category && <small className="cell-secondary">{r.category}</small>}
              </>
            )
          },
          { label: 'Размер', cell: r => r.size },
          { label: 'Артикул', cell: r => r.sku },
          {
            label: 'Спецификация',
            mobileFull: true,
            cell: r => {
              const list = specsByProduct.get(r.id) || []
              const latest = list[0]
              if (!latest) return r.version ? 'Спецификация ' + r.version : '—'
              return (
                <>
                  <span>{specTitle(latest)}</span>
                  {list.length > 1 && <small className="spec-tag">Всего версий: {list.length}</small>}
                </>
              )
            }
          },
          { label: 'Цена продажи', align: 'right', mobileAccent: true, cell: r => money(r.price) },
          {
            label: 'Статус',
            align: 'after-number',
            mobileHide: true,
            cell: () => <Status value="posted" label="Действует" />
          }
        ]}
      />
    </Page>
  )
}

function NewMaterialDialog({ close, done }) {
  const toast = useToast()
  const formId = useId()
  const state = useAction()
  const [data, setData] = useState({ name: '', unit: 'м', category: 'Сырьё', sku: '' })

  return (
    <Dialog
      title="Новый материал"
      close={close}
      closeDisabled={state.busy}
      footer={<FormActions form={formId} busy={state.busy} cancel={close} submit="Создать материал" />}
    >
      <form
        id={formId}
        onSubmit={e => {
          e.preventDefault()
          state.run(async () => {
            const payload = {
              name: data.name.trim(),
              unit: data.unit,
              category: data.category.trim() || 'Сырьё',
              sku: data.sku.trim()
            }
            const created = await api('/materials', 'POST', payload)
            toast.success('Материал «' + created.name + '» добавлен')
            done(created)
          })
        }}
      >
        <div className="form-grid">
          <Field label="Название материала" wide>
            <input
              required
              maxLength="180"
              placeholder="Например: Флизелин клеевой или Нитки №40"
              value={data.name}
              onChange={edit(setData, 'name')}
            />
          </Field>
          <Field label="Единица измерения">
            <Select value={data.unit} entries={MATERIAL_UNITS} onChange={edit(setData, 'unit')} />
          </Field>
          <Field label="Категория">
            <input
              required
              maxLength="180"
              placeholder="Ткани, Нитки, Фурнитура, Упаковка"
              value={data.category}
              onChange={edit(setData, 'category')}
            />
          </Field>
          <Field label="Артикул (необязательно)" wide help="Если оставить пустым, артикул сформируется автоматически">
            <input
              maxLength="180"
              placeholder="Например: МТ-015"
              value={data.sku}
              onChange={edit(setData, 'sku')}
            />
          </Field>
        </div>
        <ErrorBox error={state.error} />
      </form>
    </Dialog>
  )
}

function SpecEditor({ detail, close, done }) {
  const ws = useWorkspace()
  const toast = useToast()
  const state = useAction()
  const formId = useId()
  const latest = detail?.versions[0]

  const [details, setDetails] = useState({
    name: '',
    sku: '',
    size: '',
    category: 'Постельное бельё',
    price: ''
  })
  const [specName, setSpecName] = useState('')
  const [rates, setRates] = useState(() =>
    Object.fromEntries(production.map(([s]) => [s, latest?.rates[s] != null ? latest.rates[s] / 100 : '']))
  )
  const [norms, setNorms] = useState(() =>
    latest
      ? latest.norms.map((n, i) => ({
          key: i,
          item_id: n.item_id,
          stage: n.stage,
          quantity: n.quantity / 1000
        }))
      : []
  )
  const [createdMaterials, setCreatedMaterials] = useState([])
  const [newMaterialOpen, setNewMaterialOpen] = useState(false)

  const rawItems = useMemo(() => {
    const map = new Map()
    for (const item of ws.items) {
      if (item.kind === 'raw') map.set(item.id, item)
    }
    for (const item of createdMaterials) {
      map.set(item.id, item)
    }
    return [...map.values()]
  }, [ws.items, createdMaterials])

  function patch(key, change) {
    setNorms(list => list.map(n => (n.key === key ? { ...n, ...change } : n)))
  }

  function addNorm(stage = 'cut', itemId = '') {
    setNorms(list => [
      ...list,
      { key: Math.max(-1, ...list.map(n => n.key)) + 1, item_id: itemId, stage, quantity: 1 }
    ])
  }

  function handleMaterialCreated(created) {
    setCreatedMaterials(list => [...list, created])
    ws.refresh()
    setNorms(list => {
      const emptyIdx = list.findIndex(n => !n.item_id)
      if (emptyIdx >= 0) {
        return list.map((n, idx) => (idx === emptyIdx ? { ...n, item_id: created.id } : n))
      }
      const nextKey = Math.max(-1, ...list.map(n => n.key)) + 1
      return [...list, { key: nextKey, item_id: created.id, stage: 'cut', quantity: 1 }]
    })
    setNewMaterialOpen(false)
  }

  const form = (
    <form
      id={formId}
      className="spec-form"
      onSubmit={e => {
        e.preventDefault()
        state.run(async () => {
          if (norms.some(n => !n.item_id)) {
            throw new Error('Выберите материал в каждой добавленной строке или удалите пустую строку.')
          }
          const data = {
            ...rates,
            spec_name: specName.trim(),
            norms: norms.map(({ key, ...n }) => ({
              item_id: Number(n.item_id),
              stage: n.stage,
              quantity: n.quantity
            })),
            ...(detail ? {} : details)
          }
          const result = await api('/catalog' + (detail ? '/' + detail.item.id + '/versions' : ''), 'POST', data)
          toast.success(detail ? 'Новая спецификация сохранена' : 'Изделие и спецификация созданы')
          done(result)
        })
      }}
    >
      {!detail && (
        <div className="form-grid">
          <Field label="Название изделия">
            <input required maxLength="180" value={details.name} onChange={edit(setDetails, 'name')} />
          </Field>
          <Field label="Размер">
            <input required maxLength="180" value={details.size} onChange={edit(setDetails, 'size')} />
          </Field>
          <Field label="Артикул">
            <input required maxLength="180" value={details.sku} onChange={edit(setDetails, 'sku')} />
          </Field>
          <Field label="Категория">
            <input required maxLength="180" value={details.category} onChange={edit(setDetails, 'category')} />
          </Field>
          <Field label="Цена продажи, ₽">
            <input
              required
              min=".01"
              max="20000000"
              step=".01"
              type="number"
              inputMode="decimal"
              value={details.price}
              onChange={edit(setDetails, 'price')}
            />
          </Field>
        </div>
      )}

      <div className={detail ? 'spec-form' : 'spec-form form-flat-section'}>
        <h3>Спецификация</h3>
        <Field
          label="Название спецификации"
          wide
          help="Если оставить пустым, присвоится «Спецификация №…»"
        >
          <input
            maxLength="120"
            placeholder={detail ? 'Например: Без полиэстера' : 'Например: Стандарт'}
            value={specName}
            onChange={e => setSpecName(e.target.value)}
          />
        </Field>

        {norms.length === 0 ? (
          <p className="muted">
            Материалы не указаны — списание сырья не выполняется. Можно добавить сколько угодно материалов на любой этап или сохранить спецификацию без сырья.
          </p>
        ) : (
          <div className="spec-lines">
            {norms.map(n => {
              const unit = rawItems.find(i => i.id === n.item_id)?.unit
              const fractional = isFractionalUnit(unit)
              const availableEntries = rawItems
                .filter(i => i.id === n.item_id || !norms.some(o => o.stage === n.stage && o.item_id === i.id))
                .map(i => [i.id, i.name, false, [i.sku, i.unit].filter(Boolean).join(' · ')])
              return (
                <div className="spec-line" key={n.key}>
                  <Field label="Этап">
                    <Select
                      value={n.stage}
                      entries={production}
                      onChange={e => patch(n.key, { stage: e.target.value, item_id: '' })}
                    />
                  </Field>
                  <Field label="Материал">
                    <SearchPicker
                      required
                      value={n.item_id}
                      placeholder="Выберите материал"
                      entries={availableEntries}
                      onChange={e => patch(n.key, { item_id: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label={'На комплект' + (unit ? ', ' + unit : '')}>
                    <input
                      required
                      min={fractional ? '.001' : '1'}
                      max="100000"
                      step={fractional ? '.001' : '1'}
                      type="number"
                      inputMode={fractional ? 'decimal' : 'numeric'}
                      value={n.quantity}
                      onChange={e => patch(n.key, { quantity: e.target.value })}
                    />
                  </Field>
                  <Button
                    kind="quiet-danger"
                    className="icon-only"
                    aria-label="Убрать материал"
                    onClick={() => setNorms(list => list.filter(o => o.key !== n.key))}
                  >
                    ×
                  </Button>
                </div>
              )
            })}
          </div>
        )}

        <div className="action-pair">
          <Button kind="secondary" onClick={() => addNorm('cut')}>Добавить материал</Button>
          <Button kind="secondary" onClick={() => setNewMaterialOpen(true)}>
            Новый материал
          </Button>
        </div>
      </div>

      <div className="spec-form form-flat-section">
        <h3>Сдельные расценки</h3>
        <div className="toolbar">
          {production.map(([s, label]) => (
            <Field key={s} label={label + ', ₽ / компл.'}>
              <input
                required
                type="number"
                inputMode="decimal"
                min="0"
                max="20000000"
                step=".01"
                value={rates[s]}
                onChange={edit(setRates, s)}
              />
            </Field>
          ))}
        </div>
      </div>
      <ErrorBox error={state.error} />
      {!detail && (
        <div className="desktop-form-actions">
          <FormActions busy={state.busy} cancel={close} submit="Создать изделие" />
        </div>
      )}
    </form>
  )

  const parsedPrice = Number(details.price)
  const pricePreview = Number.isFinite(parsedPrice) && parsedPrice > 0 ? money(Math.round(parsedPrice * 100)) : ''

  return (
    <>
      {detail ? (
        <Dialog
          title="Добавить спецификацию"
          close={close}
          closeDisabled={state.busy}
          footer={<FormActions form={formId} busy={state.busy} cancel={close} submit="Сохранить спецификацию" />}
        >
          {form}
        </Dialog>
      ) : (
        <>
          {form}
          <div className="mobile-sticky-bar">
            <div className="mobile-sticky-summary">
              <span>Позиций сырья: {number(norms.length)}</span>
              <strong>{pricePreview || 'Новое изделие'}</strong>
            </div>
            <div className="mobile-sticky-actions">
              <Button type="submit" form={formId} kind="primary" disabled={state.busy}>
                {state.busy ? 'Сохранение…' : 'Создать изделие'}
              </Button>
            </div>
          </div>
        </>
      )}
      {newMaterialOpen && (
        <NewMaterialDialog
          close={() => setNewMaterialOpen(false)}
          done={handleMaterialCreated}
        />
      )}
    </>
  )
}

function ProductView({ detail, selected, refresh }) {
  const { user } = useWorkspace()
  const { item, versions } = detail
  const [version, setVersion] = useState(selected || '')
  const [compareId, setCompareId] = useState('')
  const [tab, setTab] = useState('materials')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setVersion(selected || '')
    setCompareId('')
  }, [selected, item.id])

  const v = versions.find(ver => String(ver.id) === String(version)) || versions[0]
  const vIndex = versions.findIndex(ver => ver.id === v?.id)
  const isLatest = Boolean(v && versions[0] && v.id === versions[0].id)
  const olderVersion = vIndex >= 0 && vIndex + 1 < versions.length ? versions[vIndex + 1] : null
  const newerVersion = vIndex > 0 ? versions[vIndex - 1] : null
  const compareTarget = versions.find(ver => String(ver.id) === String(compareId) && ver.id !== v?.id) || null
  const totalRates = v ? Object.values(v.rates).reduce((a, b) => a + b, 0) : 0
  const compareTotalRates = compareTarget ? Object.values(compareTarget.rates).reduce((a, b) => a + b, 0) : 0

  const actionLabels = { cut: 'Раскроить комплект', sew: 'Сшить комплект', pack: 'Упаковать комплект' }

  const normMap = useMemo(() => {
    if (!compareTarget) return new Map()
    return new Map(compareTarget.norms.map(n => [`${n.stage}:${n.item_id}`, n]))
  }, [compareTarget])

  const removedNorms = useMemo(() => {
    if (!compareTarget || !v) return []
    const currentKeys = new Set(v.norms.map(n => `${n.stage}:${n.item_id}`))
    return compareTarget.norms.filter(n => !currentKeys.has(`${n.stage}:${n.item_id}`))
  }, [compareTarget, v])

  const materialColumns = [
    { label: 'Этап', mobileSubtitle: true, cell: r => stages[r.stage] },
    { label: 'Материал', primary: true, cell: r => <a href={href('/stock/1/items/' + r.item_id)}>{r.name}</a> },
    { label: 'Количество', align: 'right', mobileAccent: true, cell: r => <strong>{qty(r.quantity)}</strong> },
    { label: 'Единица', cell: r => r.unit },
    ...(compareTarget
      ? [
          {
            label: 'Было (' + specTitle(compareTarget) + ')',
            align: 'right',
            cell: r => {
              const prev = normMap.get(`${r.stage}:${r.item_id}`)
              return prev ? qty(prev.quantity) : '—'
            }
          },
          {
            label: 'Изменение',
            align: 'right',
            cell: r => {
              const prev = normMap.get(`${r.stage}:${r.item_id}`)
              if (!prev) return <span className="diff-up">Новая позиция</span>
              const delta = r.quantity - prev.quantity
              return (
                <span className={delta > 0 ? 'diff-up' : delta < 0 ? 'diff-down' : 'muted'}>
                  {formatSignedQty(delta, r.unit)}
                </span>
              )
            }
          }
        ]
      : []),
    { label: 'Склад', align: compareTarget ? 'after-number' : undefined, cell: () => 'Сырьё' }
  ]

  const rateRows = production.map(([code, label]) => ({ id: code, label }))
  const rateColumns = [
    { label: 'Этап', primary: true, cell: r => r.label },
    { label: 'Операция', mobileSubtitle: true, cell: r => actionLabels[r.id] },
    { label: 'Единица выработки', mobileHide: true, cell: () => 'компл.' },
    { label: 'Расценка', align: 'right', mobileAccent: true, cell: r => <strong>{money(v?.rates[r.id] || 0)}</strong> },
    ...(compareTarget
      ? [
          {
            label: 'Было (' + specTitle(compareTarget) + ')',
            align: 'right',
            cell: r => money(compareTarget.rates[r.id] || 0)
          },
          {
            label: 'Разница',
            align: 'right',
            cell: r => {
              const delta = (v?.rates[r.id] || 0) - (compareTarget.rates[r.id] || 0)
              return (
                <span className={delta > 0 ? 'diff-up' : delta < 0 ? 'diff-down' : 'muted'}>
                  {formatSignedMoney(delta)}
                </span>
              )
            }
          }
        ]
      : [])
  ]

  return (
    <Page
      title={itemText(item)}
      subtitle={
        [item.category, item.sku, v ? specTitle(v) + ' от ' + dayText(v.effective) : '']
          .filter(Boolean)
          .join(' · ')
      }
      actions={roleCanWrite(user) && <Button kind="primary" onClick={() => setOpen(true)}>Добавить спецификацию</Button>}
    >
      <MetricStrip
        items={[
          { label: 'Цена продажи', value: money(item.price), meta: [item.category, item.size].filter(Boolean).join(' · ') },
          {
            label: 'Спецификация',
            value: v ? 'Версия ' + v.version : '—',
            meta: v
              ? [v.name || '', isLatest ? 'актуальная' : 'архивная', 'с ' + dayText(v.effective)].filter(Boolean).join(' · ')
              : 'Не задана'
          },
          { label: 'Сдельные начисления', value: v ? money(totalRates) : '—', meta: 'За полный цикл (3 этапа)' }
        ]}
      />

      <div className="toolbar spec-toolbar">
        <Field label="Спецификация" className="spec-version-field">
          <Select
            value={v?.id || ''}
            onChange={e => {
              setVersion(e.target.value)
              if (String(compareId) === String(e.target.value)) setCompareId('')
            }}
            entries={versions.map((ver, idx) => [ver.id, specOptionLabel(ver, idx === 0)])}
          />
        </Field>
        {versions.length > 1 && (
          <>
            <div className="action-pair">
              <Button
                disabled={!olderVersion}
                onClick={() => {
                  if (olderVersion) setVersion(String(olderVersion.id))
                }}
              >
                ← Предыдущая
              </Button>
              <Button
                disabled={!newerVersion}
                onClick={() => {
                  if (newerVersion) setVersion(String(newerVersion.id))
                }}
              >
                Следующая →
              </Button>
            </div>
            <Field label="Сравнить со спецификацией" className="spec-version-field">
              <Select
                placeholder="Без сравнения"
                value={compareTarget ? String(compareTarget.id) : ''}
                onChange={e => setCompareId(e.target.value)}
                entries={versions
                  .filter(ver => ver.id !== v?.id)
                  .map(ver => [ver.id, specOptionLabel(ver, ver.id === versions[0].id)])}
              />
            </Field>
          </>
        )}
      </div>

      {v && !isLatest && (
        <div className="inline-note info version-banner">
          <span>
            Вы просматриваете {specTitle(v)} (действует с {dayText(v.effective)}).
          </span>
          <Button size="small" onClick={() => setVersion(String(versions[0].id))}>
            Перейти к актуальной ({specTitle(versions[0])})
          </Button>
        </div>
      )}

      <Tabs
        items={[
          ['materials', 'Спецификация'],
          ['rates', 'Технологическая карта']
        ]}
        value={tab}
        onChange={setTab}
      />

      {v && tab === 'materials' && (
        <Section
          title="Спецификация"
          subtitle="Проведённые отчёты сохраняют нормы выбранной спецификации"
        >
          <Table
            label="Спецификация материалов"
            rows={v.norms}
            empty="Материалы не указаны — списание сырья для этой спецификации не выполняется"
            rowKey={r => r.stage + '-' + r.item_id}
            rowHref={r => '/stock/1/items/' + r.item_id}
            columns={materialColumns}
          />
          {compareTarget && removedNorms.length > 0 && (
            <div className="inline-note">
              Исключены по сравнению с «{specTitle(compareTarget)}»:{' '}
              {removedNorms.map(n => `${stages[n.stage]} — ${n.name} (${qty(n.quantity)} ${n.unit})`).join(', ')}.
            </div>
          )}
        </Section>
      )}

      {v && tab === 'rates' && (
        <Section title="Технологическая карта и расценки">
          <Table
            label="Технологическая карта и расценки"
            rows={rateRows}
            columns={rateColumns}
            mobileSummary={{
              title: 'Сдельные начисления на полный цикл',
              rows: [
                { label: 'Итого за 1 компл.', value: money(totalRates), strong: true },
                ...(compareTarget
                  ? [
                      { label: 'Было (' + specTitle(compareTarget) + ')', value: money(compareTotalRates), muted: true },
                      {
                        label: 'Разница',
                        value: (
                          <span
                            className={
                              totalRates - compareTotalRates > 0
                                ? 'diff-up'
                                : totalRates - compareTotalRates < 0
                                  ? 'diff-down'
                                  : 'muted'
                            }
                          >
                            {formatSignedMoney(totalRates - compareTotalRates)}
                          </span>
                        )
                      }
                    ]
                  : [])
              ]
            }}
            footer={
              <tr>
                <th scope="row" colSpan={3}>
                  Сдельные начисления на полный цикл (за 1 компл.)
                </th>
                <td className="right" data-label="Расценка">
                  <strong>{money(totalRates)}</strong>
                </td>
                {compareTarget && (
                  <>
                    <td className="right" data-label={'Было (' + specTitle(compareTarget) + ')'}>
                      {money(compareTotalRates)}
                    </td>
                    <td className="right" data-label="Разница">
                      <span
                        className={
                          totalRates - compareTotalRates > 0
                            ? 'diff-up'
                            : totalRates - compareTotalRates < 0
                              ? 'diff-down'
                              : 'muted'
                        }
                      >
                        {formatSignedMoney(totalRates - compareTotalRates)}
                      </span>
                    </td>
                  </>
                )}
              </tr>
            }
          />
        </Section>
      )}

      {open && roleCanWrite(user) && (
        <SpecEditor
          detail={detail}
          close={() => setOpen(false)}
          done={() => {
            setOpen(false)
            setVersion('')
            setCompareId('')
            refresh()
          }}
        />
      )}
    </Page>
  )
}

export function ProductDetail({ id, selected }) {
  const ws = useWorkspace()
  const request = useRemote(id ? '/catalog/' + id : null)
  if (!id) {
    return roleCanWrite(ws.user) ? (
      <Page title="Добавить изделие" subtitle="Карточка модели и первая спецификация">
        <div className="form-flat">
          <SpecEditor
            close={() => go('/catalog')}
            done={r => {
              ws.refresh()
              go('/catalog/' + r.id)
            }}
          />
        </div>
      </Page>
    ) : (
      <div className="minimal-state">
        <p>Нет доступа к этому разделу</p>
      </div>
    )
  }
  return (
    <Guard request={request}>
      {d => (
        <ProductView
          detail={d}
          selected={selected}
          refresh={() => {
            request.refresh()
            ws.refresh()
          }}
        />
      )}
    </Guard>
  )
}

/* --- Редактирование ведомости (Проезд / Долг / Аванс / НДФЛ) --- */
function PayrollAdjustmentDialog({ row, month, staffList = [], existingRows = [], close, done }) {
  const toast = useToast()
  const formId = useId()
  const state = useAction()

  const [staffId, setStaffId] = useState(row ? String(row.id) : '')
  const activeRow = useMemo(() => {
    if (row) return row
    if (!staffId) return null
    return existingRows.find(r => String(r.id) === String(staffId)) || null
  }, [row, existingRows, staffId])

  const selectedStaff = useMemo(() => {
    if (activeRow) return activeRow
    return staffList.find(s => String(s.id) === String(staffId)) || null
  }, [activeRow, staffList, staffId])

  const defaultTravel = activeRow
    ? activeRow.default_travel || 0
    : selectedStaff?.travel_eligible
      ? selectedStaff.travel_amount || 0
      : 0

  const [useDefaultTravel, setUseDefaultTravel] = useState(() => (activeRow ? activeRow.travel_override == null : true))
  const [data, setData] = useState(() => ({
    travel: activeRow ? toRubInput(activeRow.travel) : toRubInput(defaultTravel),
    debt: activeRow ? toRubInput(activeRow.debt) : '0',
    advance: activeRow ? toRubInput(activeRow.advance) : '0',
    ndfl: activeRow ? toRubInput(activeRow.ndfl) : '0',
    memo: activeRow?.memo || ''
  }))

  useEffect(() => {
    if (row) return
    if (activeRow) {
      setUseDefaultTravel(activeRow.travel_override == null)
      setData({
        travel: toRubInput(activeRow.travel),
        debt: toRubInput(activeRow.debt),
        advance: toRubInput(activeRow.advance),
        ndfl: toRubInput(activeRow.ndfl),
        memo: activeRow.memo || ''
      })
    } else if (selectedStaff) {
      const def = selectedStaff.travel_eligible ? selectedStaff.travel_amount || 0 : 0
      setUseDefaultTravel(true)
      setData({ travel: toRubInput(def), debt: '0', advance: '0', ndfl: '0', memo: '' })
    }
  }, [row, activeRow, selectedStaff])

  const accrual = activeRow ? activeRow.accrual || 0 : 0
  const travelKopecks = useDefaultTravel ? defaultTravel : parseRubToKopecks(data.travel)
  const debtKopecks = parseRubToKopecks(data.debt)
  const advanceKopecks = parseRubToKopecks(data.advance)
  const ndflKopecks = parseRubToKopecks(data.ndfl)
  const netTotal = accrual + travelKopecks - debtKopecks - advanceKopecks - ndflKopecks

  return (
    <Dialog
      title={row ? 'Корректировка ведомости · ' + row.name : 'Добавить удержание или проезд'}
      close={close}
      closeDisabled={state.busy}
      footer={<FormActions form={formId} busy={state.busy} cancel={close} submit="Сохранить" />}
    >
      <form
        id={formId}
        onSubmit={e => {
          e.preventDefault()
          state.run(async () => {
            const targetId = row ? row.id : Number(staffId)
            if (!targetId) throw new Error('Выберите сотрудника.')
            const payload = {
              month,
              staff_id: targetId,
              travel: useDefaultTravel ? null : Number(data.travel || 0),
              debt: Number(data.debt || 0),
              advance: Number(data.advance || 0),
              ndfl: Number(data.ndfl || 0),
              memo: data.memo.trim()
            }
            const updated = await api('/payroll/adjustments', 'PUT', payload)
            toast.success('Ведомость за ' + monthText(month).toLowerCase() + ' обновлена')
            done(updated)
          })
        }}
      >
        <p className="muted">
          Расчётный месяц: <strong>{monthText(month)}</strong>
          {row ? ' · Начислено: ' + money(accrual) : ''}
        </p>

        <div className="form-grid">
          {!row && (
            <Field label="Сотрудник" wide>
              <SearchPicker
                required
                value={staffId}
                placeholder="Выберите сотрудника"
                entries={staffList.map(s => [
                  s.id,
                  s.name,
                  false,
                  [s.position, stages[s.stage]].filter(Boolean).join(' · ')
                ])}
                onChange={e => {
                  setStaffId(e.target.value)
                  setUseDefaultTravel(true)
                }}
              />
            </Field>
          )}

          <Field
            label="Проезд, ₽"
            action={
              !useDefaultTravel ? (
                <button
                  type="button"
                  className="field-inline-action"
                  onClick={() => {
                    setUseDefaultTravel(true)
                    setData(v => ({ ...v, travel: toRubInput(defaultTravel) }))
                  }}
                >
                  Из карточки ({money(defaultTravel)})
                </button>
              ) : null
            }
            help={useDefaultTravel ? 'Из карточки сотрудника: ' + money(defaultTravel) : 'Задано вручную на этот месяц'}
          >
            <input
              required
              type="number"
              inputMode="decimal"
              min="0"
              max="20000000"
              step=".01"
              value={useDefaultTravel ? toRubInput(defaultTravel) : data.travel}
              onChange={e => {
                setUseDefaultTravel(false)
                setData(v => ({ ...v, travel: e.target.value }))
              }}
            />
          </Field>

          <Field label="Долг (взял заранее), ₽">
            <input
              required
              type="number"
              inputMode="decimal"
              min="0"
              max="20000000"
              step=".01"
              value={data.debt}
              onChange={edit(setData, 'debt')}
            />
          </Field>

          <Field label="Аванс, ₽">
            <input
              required
              type="number"
              inputMode="decimal"
              min="0"
              max="20000000"
              step=".01"
              value={data.advance}
              onChange={edit(setData, 'advance')}
            />
          </Field>

          <Field
            label="НДФЛ, ₽"
            action={
              <button
                type="button"
                className="field-inline-action"
                disabled={accrual <= 0}
                onClick={() => setData(v => ({ ...v, ndfl: String(Math.round(accrual * 0.13) / 100) }))}
              >
                Рассчитать 13%
              </button>
            }
          >
            <input
              required
              type="number"
              inputMode="decimal"
              min="0"
              max="20000000"
              step=".01"
              value={data.ndfl}
              onChange={edit(setData, 'ndfl')}
            />
          </Field>

          <Field label="Комментарий (необязательно)" wide>
            <input
              maxLength="500"
              placeholder="Например: Аванс 15-го числа или разовая доплата"
              value={data.memo}
              onChange={edit(setData, 'memo')}
            />
          </Field>
        </div>

        <div className="calc-summary">
          <div className="calc-summary-row">
            <span>Начисление</span>
            <strong>{money(accrual)}</strong>
          </div>
          <div className="calc-summary-row">
            <span>Проезд</span>
            <strong className={travelKopecks > 0 ? 'payroll-travel' : undefined}>
              {travelKopecks > 0 ? '+' + money(travelKopecks) : money(0)}
            </strong>
          </div>
          <div className="calc-summary-row">
            <span>Удержания (долг + аванс + НДФЛ)</span>
            <strong className={debtKopecks + advanceKopecks + ndflKopecks > 0 ? 'payroll-deduction' : undefined}>
              {debtKopecks + advanceKopecks + ndflKopecks > 0
                ? '−' + money(debtKopecks + advanceKopecks + ndflKopecks)
                : money(0)}
            </strong>
          </div>
          <div className="calc-summary-total">
            <span>Итого к выдаче</span>
            <strong className={netTotal < 0 ? 'negative' : undefined}>{money(netTotal)}</strong>
          </div>
        </div>

        <ErrorBox error={state.error} />
      </form>
    </Dialog>
  )
}

/* --- Сотрудники --- */
export function People() {
  const { staff, user, today, refresh } = useWorkspace()
  const canWrite = roleCanWrite(user)
  const state = useFilters('people', { search: '', stage: '', status: '' })
  const { filters, page, setPage, change } = state
  const [open, setOpen] = useState(false)

  const rows = staff.filter(
    r =>
      (!filters.stage || r.stage === filters.stage) &&
      matchesSearch(filters.search, r.name, r.position) &&
      (!filters.status || r.active === Number(filters.status))
  )

  return (
    <Page
      title="Сотрудники"
      subtitle="Исполнители для учёта выработки и начислений"
      actions={canWrite && <Button kind="primary" onClick={() => setOpen(true)}>Добавить сотрудника</Button>}
    >
      <RegistryTools state={state} total={rows.length} placeholder="Имя или должность">
        <Field label="Участок">
          <Select
            placeholder="Все участки"
            entries={Object.entries(stages)}
            value={filters.stage || ''}
            onChange={e => change('stage', e.target.value)}
          />
        </Field>
        <Field label="Статус">
          <Select
            placeholder="Все статусы"
            entries={[
              [1, 'Работает'],
              [0, 'Не работает']
            ]}
            value={filters.status}
            onChange={e => change('status', e.target.value)}
          />
        </Field>
      </RegistryTools>
      <LocalPager
        rows={rows}
        label="Сотрудники"
        empty="Сотрудники по этому запросу не найдены"
        page={page}
        setPage={setPage}
        rowHref={r => '/people/' + r.id}
        columns={[
          { label: 'Сотрудник', primary: true, cell: r => <a href={href('/people/' + r.id)}>{r.name}</a> },
          { label: 'Должность', mobileSubtitle: !canWrite, cell: r => r.position },
          { label: 'Участок', cell: r => stages[r.stage] || r.stage },
          ...(canWrite
            ? [
                {
                  label: 'Проезд',
                  align: 'right',
                  cell: r =>
                    r.travel_eligible ? (
                      <span className="travel-badge">{money(r.travel_amount)}</span>
                    ) : (
                      <span className="muted">—</span>
                    )
                }
              ]
            : []),
          { label: 'Дата приёма', align: canWrite ? 'after-number' : undefined, cell: r => dayText(r.hired_on) },
          {
            label: 'Статус',
            mobileKind: 'status',
            cell: r => <Status value={r.active ? 'posted' : 'inactive'} label={r.active ? 'Работает' : 'Не работает'} />
          }
        ]}
      />
      {open && canWrite && (
        <StaffForm
          today={today}
          close={() => setOpen(false)}
          done={id => {
            setOpen(false)
            refresh()
            go('/people/' + id)
          }}
        />
      )}
    </Page>
  )
}

function StaffForm({ record, today, close, done }) {
  const toast = useToast()
  const formId = useId()
  const [data, set] = useState(
    record
      ? {
          name: record.name,
          position: record.position,
          stage: record.stage,
          hired_on: record.hired_on,
          active: !!record.active,
          travel_eligible: !!record.travel_eligible,
          travel_amount: record.travel_amount ? toRubInput(record.travel_amount) : '2500'
        }
      : {
          name: '',
          position: '',
          stage: 'cut',
          hired_on: today,
          active: true,
          travel_eligible: false,
          travel_amount: '2500'
        }
  )
  const state = useAction()

  return (
    <Dialog
      title={record ? 'Редактировать сотрудника' : 'Добавить сотрудника'}
      close={close}
      closeDisabled={state.busy}
      footer={<FormActions form={formId} busy={state.busy} cancel={close} />}
    >
      <form
        id={formId}
        onSubmit={e => {
          e.preventDefault()
          state.run(async () => {
            const payload = {
              name: data.name,
              position: data.position,
              stage: data.stage,
              hired_on: data.hired_on,
              active: data.active,
              travel_eligible: Boolean(data.travel_eligible),
              travel_amount: data.travel_eligible ? Number(data.travel_amount || 0) : 0
            }
            const r = await api('/staff' + (record ? '/' + record.id : ''), record ? 'PUT' : 'POST', payload)
            toast.success(record ? 'Данные сотрудника обновлены' : 'Сотрудник добавлен')
            done(r.id)
          })
        }}
      >
        <div className="form-grid">
          <Field label="ФИО" wide>
            <input required maxLength="180" value={data.name} onChange={edit(set, 'name')} />
          </Field>
          <Field label="Должность">
            <input required maxLength="180" value={data.position} onChange={edit(set, 'position')} />
          </Field>
          <Field label="Участок">
            <Select value={data.stage} entries={Object.entries(stages)} onChange={edit(set, 'stage')} />
          </Field>
          <Field label="Дата приёма">
            <DateControl required max={today} value={data.hired_on} onChange={edit(set, 'hired_on')} />
          </Field>
          <Field label="Статус">
            <Select
              value={String(+data.active)}
              entries={[
                [1, 'Работает'],
                [0, 'Не работает']
              ]}
              onChange={e => set(v => ({ ...v, active: e.target.value === '1' }))}
            />
          </Field>
          <div className="field wide">
            <Toggle
              checked={data.travel_eligible}
              onChange={checked =>
                set(v => ({
                  ...v,
                  travel_eligible: checked,
                  travel_amount: checked && (!v.travel_amount || Number(v.travel_amount) === 0) ? '2500' : v.travel_amount
                }))
              }
              label="Компенсация проезда"
              help="Автоматически подставляется в ежемесячную ведомость зарплаты"
            />
          </div>
          {data.travel_eligible && (
            <Field label="Сумма проезда, ₽" wide>
              <input
                required
                type="number"
                inputMode="decimal"
                min="0"
                max="20000000"
                step=".01"
                value={data.travel_amount}
                onChange={edit(set, 'travel_amount')}
              />
            </Field>
          )}
        </div>
        <ErrorBox error={state.error} />
      </form>
    </Dialog>
  )
}

export function StaffDetail({ id }) {
  const { user, today, refresh } = useWorkspace()
  const state = useFilters('staff-' + id, { start: today.slice(0, 7) + '-01', end: today })
  const { filters, page, setPage, change, update } = state
  const request = useRemote('/staff/' + id, filters)
  const [open, setOpen] = useState(false)
  const [editAdj, setEditAdj] = useState(false)
  const [tab, setTab] = useState('')

  return (
    <Guard request={request}>
      {d => {
        const canWrite = roleCanWrite(user)
        const isProductionWorker = production.some(([sid]) => sid === d.staff.stage)
        const hourlyRows = d.hourly_rows || []
        const summary = d.summary || null
        const works = canWrite && (isProductionWorker || d.rows.length > 0 || hourlyRows.length > 0 || Boolean(summary))
        const activeTab = works ? tab || 'wages' : 'profile'
        const pieceAmount = d.rows.reduce((s, r) => s + r.amount, 0)
        const hourlyAmount = hourlyRows.reduce((s, r) => s + r.amount, 0)
        const hourlyMinutes = hourlyRows.reduce((s, r) => s + r.minutes, 0)
        const quantity = d.rows.reduce((s, r) => s + r.quantity, 0)
        const month = (filters.start || today).slice(0, 7)

        const effectiveSummary = summary || {
          id: d.staff.id,
          name: d.staff.name,
          stage: d.staff.stage,
          position: d.staff.position,
          month,
          accrual: pieceAmount + hourlyAmount,
          piece_amount: pieceAmount,
          hourly_amount: hourlyAmount,
          hourly_minutes: hourlyMinutes,
          travel_eligible: d.staff.travel_eligible,
          default_travel: d.staff.travel_eligible ? d.staff.travel_amount || 0 : 0,
          travel_override: null,
          travel: d.staff.travel_eligible ? d.staff.travel_amount || 0 : 0,
          debt: 0,
          advance: 0,
          ndfl: 0,
          net_total: pieceAmount + hourlyAmount + (d.staff.travel_eligible ? d.staff.travel_amount || 0 : 0),
          memo: ''
        }

        const totalDeductions = effectiveSummary.debt + effectiveSummary.advance + effectiveSummary.ndfl
        const hasHourly = canWrite && (hourlyMinutes > 0 || (effectiveSummary.hourly_minutes || 0) > 0)
        const paySubtitle = isProductionWorker
          ? hasHourly
            ? 'сдельная + грузчик'
            : 'сдельная оплата'
          : (stages[d.staff.stage] || d.staff.stage) + (hasHourly ? ' · грузчик' : '')

        return (
          <Page
            title={d.staff.name}
            subtitle={d.staff.position + ' · ' + paySubtitle}
            actions={canWrite && <Button onClick={() => setOpen(true)}>Редактировать</Button>}
          >
            {works && (
              <MetricStrip
                items={[
                  {
                    label: 'Начисление',
                    value: money(effectiveSummary.accrual),
                    meta:
                      hourlyAmount > 0
                        ? 'Сдельная ' + money(pieceAmount) + ' · Грузчик ' + money(hourlyAmount)
                        : 'Выработка: ' + qty(quantity) + ' компл.'
                  },
                  {
                    label: 'Проезд',
                    value: effectiveSummary.travel > 0 ? '+' + money(effectiveSummary.travel) : money(0),
                    meta: effectiveSummary.travel_override != null ? 'Задано на месяц' : 'По карточке',
                    tone: effectiveSummary.travel > 0 ? 'success' : undefined
                  },
                  {
                    label: 'Удержания',
                    value: totalDeductions > 0 ? '−' + money(totalDeductions) : money(0),
                    meta: 'Долг, аванс, НДФЛ',
                    tone: totalDeductions > 0 ? 'danger' : undefined
                  },
                  {
                    label: 'Итого к выдаче',
                    value: money(effectiveSummary.net_total),
                    meta: monthText(month),
                    tone: effectiveSummary.net_total < 0 ? 'danger' : undefined
                  }
                ]}
              />
            )}

            {works && (
              <Tabs
                items={[
                  ['wages', 'Выработка и начисления'],
                  ['profile', 'Личные данные']
                ]}
                value={activeTab}
                onChange={setTab}
              />
            )}

            {activeTab === 'profile' && (
              <>
                <Section title="Сведения о сотруднике">
                  <div className="surface-panel">
                    <Details
                      values={[
                        ['Имя', d.staff.name],
                        ['Участок', stages[d.staff.stage] || d.staff.stage],
                        ['Должность', d.staff.position],
                        ['Дата приёма', dayText(d.staff.hired_on)],
                        ...(isProductionWorker ? [['Форма оплаты', 'Сдельная']] : []),
                        ...(canWrite
                          ? [
                              [
                                'Компенсация проезда',
                                d.staff.travel_eligible ? (
                                  <span className="travel-badge">{money(d.staff.travel_amount)} / мес.</span>
                                ) : (
                                  'Не назначена'
                                )
                              ]
                            ]
                          : []),
                        [
                          'Статус',
                          <Status
                            value={d.staff.active ? 'posted' : 'inactive'}
                            label={d.staff.active ? 'Работает' : 'Не работает'}
                          />
                        ]
                      ]}
                    />
                  </div>
                </Section>
                {!canWrite && isProductionWorker && (
                  <>
                    <div className="inline-note info">
                      Фактическая выработка сотрудника отображается в проведённых сменных отчётах. Персональные начисления и расчётный листок доступны бухгалтеру и администратору.
                    </div>
                    <ActionRow>
                      <Button to={routeWith('/reports', { stage: d.staff.stage })}>
                        Открыть отчёты участка «{stages[d.staff.stage]}»
                      </Button>
                    </ActionRow>
                  </>
                )}
              </>
            )}

            {activeTab === 'wages' && works && (
              <>
                <RegistryTools
                  state={state}
                  periodLabel
                  periodPlacement="header"
                  total={d.rows.length + hourlyRows.length}
                >
                  <DateRange
                    filters={filters}
                    change={change}
                    allowClear={false}
                    onRangeChange={(start, end) => update({ start, end })}
                  />
                </RegistryTools>

                <Section
                  title={'Расчёт за ' + monthText(month).toLowerCase()}
                  actions={
                    <Button size="small" onClick={() => setEditAdj(true)}>
                      Изменить удержания
                    </Button>
                  }
                >
                  <div className="surface-panel">
                    <div className="calc-summary">
                      <div className="calc-summary-row">
                        <span>Сдельная выработка ({qty(quantity)} компл.)</span>
                        <strong>{money(pieceAmount)}</strong>
                      </div>
                      {hourlyMinutes > 0 && (
                        <div className="calc-summary-row">
                          <span>Почасовая работа · Грузчик ({duration(hourlyMinutes)})</span>
                          <strong>{money(hourlyAmount)}</strong>
                        </div>
                      )}
                      <div className="calc-summary-row">
                        <span>Проезд</span>
                        <strong className={effectiveSummary.travel > 0 ? 'payroll-travel' : undefined}>
                          {effectiveSummary.travel > 0 ? '+' + money(effectiveSummary.travel) : money(0)}
                        </strong>
                      </div>
                      <div className="calc-summary-row">
                        <span>Долг</span>
                        <strong className={effectiveSummary.debt > 0 ? 'payroll-deduction' : undefined}>
                          {effectiveSummary.debt > 0 ? '−' + money(effectiveSummary.debt) : money(0)}
                        </strong>
                      </div>
                      <div className="calc-summary-row">
                        <span>Аванс</span>
                        <strong className={effectiveSummary.advance > 0 ? 'payroll-deduction' : undefined}>
                          {effectiveSummary.advance > 0 ? '−' + money(effectiveSummary.advance) : money(0)}
                        </strong>
                      </div>
                      <div className="calc-summary-row">
                        <span>НДФЛ</span>
                        <strong className={effectiveSummary.ndfl > 0 ? 'payroll-deduction' : undefined}>
                          {effectiveSummary.ndfl > 0 ? '−' + money(effectiveSummary.ndfl) : money(0)}
                        </strong>
                      </div>
                      <div className="calc-summary-total">
                        <span>Итого к выдаче</span>
                        <strong className={effectiveSummary.net_total < 0 ? 'negative' : undefined}>
                          {money(effectiveSummary.net_total)}
                        </strong>
                      </div>
                    </div>
                    {effectiveSummary.memo && <p className="muted">Комментарий: {effectiveSummary.memo}</p>}
                  </div>
                </Section>

                <Section title="Сдельная выработка">
                  <LocalPager
                    rows={d.rows.map((r, i) => ({ ...r, id: r.id + '-' + r.item_id + '-' + i, doc_id: r.id }))}
                    label="Начисления сотрудника"
                    empty="За выбранный период сдельной выработки нет"
                    page={page}
                    setPage={setPage}
                    rowHref={r => '/reports/' + r.doc_id}
                    columns={[
                      {
                        label: 'Дата / документ',
                        primary: true,
                        cell: r => (
                          <a href={href('/reports/' + r.doc_id)}>
                            {dayText(r.date)} · {r.code}
                          </a>
                        )
                      },
                      { label: 'Изделие', mobileSubtitle: true, cell: itemText },
                      { label: 'Количество', align: 'right', cell: r => qty(r.quantity) },
                      { label: 'Расценка', align: 'right', cell: r => money(r.rate) },
                      { label: 'Начислено', align: 'right', mobileAccent: true, cell: r => <strong>{money(r.amount)}</strong> }
                    ]}
                    mobileSummary={
                      d.rows.length > 0
                        ? {
                            title: 'Итого по сдельной выработке',
                            rows: [
                              { label: 'Выработка', value: qty(quantity) + ' компл.' },
                              { label: 'Начислено', value: money(pieceAmount), strong: true }
                            ]
                          }
                        : undefined
                    }
                    footer={
                      d.rows.length > 0 ? (
                        <tr>
                          <th scope="row" colSpan={2}>
                            Итого по сдельной выработке
                          </th>
                          <td className="right" data-label="Выработка">
                            <strong>{qty(quantity)} компл.</strong>
                          </td>
                          <td className="right" />
                          <td className="right" data-label="Начислено">
                            <strong>{money(pieceAmount)}</strong>
                          </td>
                        </tr>
                      ) : null
                    }
                  />
                </Section>

                {hourlyRows.length > 0 && (
                  <Section title="Почасовая работа · Грузчик">
                    <Table
                      label="Почасовая работа грузчиком"
                      rows={hourlyRows}
                      rowKey={(r, i) => r.id + '-' + i}
                      rowHref={r => '/reports/' + r.id}
                      columns={[
                        {
                          label: 'Дата / документ',
                          primary: true,
                          cell: r => (
                            <a href={href('/reports/' + r.id)}>
                              {dayText(r.date)} · {r.code}
                            </a>
                          )
                        },
                        { label: 'Вид работы', mobileSubtitle: true, cell: () => 'Грузчик' },
                        { label: 'Время', align: 'right', cell: r => duration(r.minutes) },
                        { label: 'Ставка', align: 'right', cell: r => money(r.hourly_rate) + ' / ч' },
                        { label: 'Начислено', align: 'right', mobileAccent: true, cell: r => <strong>{money(r.amount)}</strong> }
                      ]}
                      mobileSummary={{
                        title: 'Итого за работу грузчиком',
                        rows: [
                          { label: 'Время', value: duration(hourlyMinutes) },
                          { label: 'Начислено', value: money(hourlyAmount), strong: true }
                        ]
                      }}
                      footer={
                        <tr>
                          <th scope="row" colSpan={2}>
                            Итого за работу грузчиком
                          </th>
                          <td className="right" data-label="Время">
                            <strong>{duration(hourlyMinutes)}</strong>
                          </td>
                          <td className="right" />
                          <td className="right" data-label="Начислено">
                            <strong>{money(hourlyAmount)}</strong>
                          </td>
                        </tr>
                      }
                    />
                  </Section>
                )}

                {(d.rows.length > 0 || hourlyRows.length > 0) && (
                  <ActionRow>
                    <Download path={'/staff/' + id} options={filters}>
                      Скачать расчёт
                    </Download>
                  </ActionRow>
                )}
              </>
            )}

            {open && canWrite && (
              <StaffForm
                record={d.staff}
                today={today}
                close={() => setOpen(false)}
                done={() => {
                  setOpen(false)
                  request.refresh()
                  refresh()
                }}
              />
            )}

            {editAdj && canWrite && (
              <PayrollAdjustmentDialog
                row={effectiveSummary}
                month={month}
                close={() => setEditAdj(false)}
                done={() => {
                  setEditAdj(false)
                  request.refresh()
                }}
              />
            )}
          </Page>
        )
      }}
    </Guard>
  )
}

/* --- Ведомость зарплаты --- */
export function Payroll() {
  const { today, staff = [] } = useWorkspace()
  const state = useFilters('payroll', { search: '', stage: '', start: today.slice(0, 7) + '-01', end: today })
  const { filters, page, setPage, change, update } = state
  const request = useRemote('/payroll', { start: filters.start, end: filters.end, stage: filters.stage })
  const [editingRow, setEditingRow] = useState(null)
  const [addingAdj, setAddingAdj] = useState(false)

  const month = (filters.start || today).slice(0, 7)

  const columns = [
    {
      label: 'Сотрудник',
      primary: true,
      cell: r => (
        <>
          <a href={href('/people/' + r.id)}>{r.name}</a>
          <small className="cell-secondary">
            {[
              stages[r.stage] || r.stage,
              r.hourly_minutes > 0 ? 'грузчик ' + duration(r.hourly_minutes) : '',
              (r.memo || '').trim()
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </>
      )
    },
    { label: 'Начисление', align: 'right', mobileFull: true, cell: r => money(r.accrual) },
    {
      label: 'Проезд',
      align: 'right',
      cell: r => (r.travel > 0 ? <span className="payroll-travel">{money(r.travel)}</span> : <span className="muted">—</span>)
    },
    {
      label: 'Долг',
      align: 'right',
      cell: r => (r.debt > 0 ? <span className="payroll-deduction">−{money(r.debt)}</span> : <span className="muted">—</span>)
    },
    {
      label: 'Аванс',
      align: 'right',
      cell: r => (r.advance > 0 ? <span className="payroll-deduction">−{money(r.advance)}</span> : <span className="muted">—</span>)
    },
    {
      label: 'НДФЛ',
      align: 'right',
      cell: r => (r.ndfl > 0 ? <span className="payroll-deduction">−{money(r.ndfl)}</span> : <span className="muted">—</span>)
    },
    {
      label: 'Итого',
      align: 'right',
      mobileAccent: true,
      cell: r => (
        <strong className={'payroll-net' + (r.net_total < 0 ? ' negative' : '')}>{money(r.net_total)}</strong>
      )
    },
    {
      label: 'Действия',
      kind: 'actions',
      mobileKind: 'actions',
      align: 'right',
      cell: r => (
        <Button kind="ghost" size="small" onClick={() => setEditingRow(r)}>
          Изменить
        </Button>
      )
    }
  ]

  return (
    <Page
      title="Зарплата"
      subtitle={'Ведомость начислений и удержаний · ' + monthText(month)}
      actions={
        <Download path="/payroll" options={filters} disabled={request.loading || !!request.error}>
          Скачать ведомость
        </Download>
      }
    >
      <Guard request={request}>
        {records => {
          const rows = records.filter(r => matchesSearch(filters.search, r.name, r.position, r.memo))
          const totalAccrual = rows.reduce((s, r) => s + (r.accrual || 0), 0)
          const totalHourly = rows.reduce((s, r) => s + (r.hourly_amount || 0), 0)
          const totalTravel = rows.reduce((s, r) => s + (r.travel || 0), 0)
          const totalDebt = rows.reduce((s, r) => s + (r.debt || 0), 0)
          const totalAdvance = rows.reduce((s, r) => s + (r.advance || 0), 0)
          const totalNdfl = rows.reduce((s, r) => s + (r.ndfl || 0), 0)
          const totalDeductions = totalDebt + totalAdvance + totalNdfl
          const totalNet = rows.reduce((s, r) => s + (r.net_total || 0), 0)

          const byStage = production.map(([code, label]) => {
            const group = rows.filter(r => r.stage === code)
            const amount = group.reduce((s, r) => s + (r.accrual || 0), 0)
            return { code, label, count: group.length, amount }
          })

          return (
            <>
              <MetricStrip
                items={[
                  {
                    label: 'Итого к выдаче',
                    value: money(totalNet),
                    meta: 'Сотрудников в ведомости: ' + number(rows.length),
                    tone: totalNet < 0 ? 'danger' : undefined
                  },
                  {
                    label: 'Начисление и проезд',
                    value: money(totalAccrual + totalTravel),
                    meta:
                      'Начислено ' +
                      money(totalAccrual) +
                      (totalTravel > 0 ? ' · Проезд ' + money(totalTravel) : '')
                  },
                  {
                    label: 'Удержания',
                    value: totalDeductions > 0 ? '−' + money(totalDeductions) : money(0),
                    meta:
                      'Долг ' + money(totalDebt) + ' · Аванс ' + money(totalAdvance) + ' · НДФЛ ' + money(totalNdfl)
                  }
                ]}
              />

              {rows.length > 0 && !filters.stage && totalAccrual > 0 && (
                <Section
                  title="Распределение начислений по этапам"
                  subtitle={totalHourly > 0 ? 'Включая почасовую работу грузчиком: ' + money(totalHourly) : undefined}
                >
                  <div className="surface-panel">
                    <div className="output-chart">
                      {byStage.map(s => {
                        const share = totalAccrual > 0 ? Math.round((s.amount / totalAccrual) * 100) : 0
                        return (
                          <div className="bar-row" key={s.code}>
                            <span>
                              {s.label} ({number(s.count)})
                            </span>
                            <div className="bar-track" aria-hidden="true">
                              <div
                                className={'bar-fill ' + s.code}
                                style={{ width: (totalAccrual > 0 ? (s.amount / totalAccrual) * 100 : 0) + '%' }}
                              />
                            </div>
                            <strong>
                              {money(s.amount)} · {share}%
                            </strong>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </Section>
              )}

              <Section
                title="Ведомость начислений"
                actions={
                  <Button size="small" onClick={() => setAddingAdj(true)}>
                    Добавить запись
                  </Button>
                }
              >
                <RegistryTools
                  state={state}
                  periodLabel
                  periodPlacement="header"
                  total={rows.length}
                  placeholder="Сотрудник или комментарий"
                >
                  <DateRange
                    filters={filters}
                    change={change}
                    allowClear={false}
                    onRangeChange={(start, end) => update({ start, end })}
                  />
                  <Field label="Участок" wide>
                    <Select
                      placeholder="Все участки"
                      entries={Object.entries(stages)}
                      value={filters.stage}
                      onChange={e => change('stage', e.target.value)}
                    />
                  </Field>
                </RegistryTools>
                <LocalPager
                  rows={rows}
                  label="Ведомость зарплаты"
                  empty="Начисления по этому запросу не найдены"
                  page={page}
                  setPage={setPage}
                  rowHref={r => '/people/' + r.id}
                  className="payroll-table"
                  columns={columns}
                  mobileSummary={
                    rows.length > 0
                      ? {
                          title: 'Итого по ведомости (' + number(rows.length) + ' чел.)',
                          rows: [
                            { label: 'Начисление', value: money(totalAccrual) },
                            {
                              label: 'Проезд',
                              value:
                                totalTravel > 0 ? (
                                  <span className="payroll-travel">{money(totalTravel)}</span>
                                ) : (
                                  money(0)
                                )
                            },
                            {
                              label: 'Долг',
                              value:
                                totalDebt > 0 ? (
                                  <span className="payroll-deduction">−{money(totalDebt)}</span>
                                ) : (
                                  money(0)
                                )
                            },
                            {
                              label: 'Аванс',
                              value:
                                totalAdvance > 0 ? (
                                  <span className="payroll-deduction">−{money(totalAdvance)}</span>
                                ) : (
                                  money(0)
                                )
                            },
                            {
                              label: 'НДФЛ',
                              value:
                                totalNdfl > 0 ? (
                                  <span className="payroll-deduction">−{money(totalNdfl)}</span>
                                ) : (
                                  money(0)
                                )
                            },
                            {
                              label: 'Итого к выдаче',
                              value: (
                                <span className={'payroll-net' + (totalNet < 0 ? ' negative' : '')}>
                                  {money(totalNet)}
                                </span>
                              ),
                              strong: true
                            }
                          ]
                        }
                      : undefined
                  }
                  footer={
                    rows.length > 0 ? (
                      <tr>
                        <th scope="row">Итого ({number(rows.length)} чел.)</th>
                        <td className="right" data-label="Начисление">
                          <strong>{money(totalAccrual)}</strong>
                        </td>
                        <td className="right" data-label="Проезд">
                          <strong className={totalTravel > 0 ? 'payroll-travel' : undefined}>
                            {money(totalTravel)}
                          </strong>
                        </td>
                        <td className="right" data-label="Долг">
                          <strong className={totalDebt > 0 ? 'payroll-deduction' : undefined}>
                            {totalDebt > 0 ? '−' + money(totalDebt) : money(0)}
                          </strong>
                        </td>
                        <td className="right" data-label="Аванс">
                          <strong className={totalAdvance > 0 ? 'payroll-deduction' : undefined}>
                            {totalAdvance > 0 ? '−' + money(totalAdvance) : money(0)}
                          </strong>
                        </td>
                        <td className="right" data-label="НДФЛ">
                          <strong className={totalNdfl > 0 ? 'payroll-deduction' : undefined}>
                            {totalNdfl > 0 ? '−' + money(totalNdfl) : money(0)}
                          </strong>
                        </td>
                        <td className="right" data-label="Итого">
                          <strong className={'payroll-net' + (totalNet < 0 ? ' negative' : '')}>{money(totalNet)}</strong>
                        </td>
                        <td className="right" />
                      </tr>
                    ) : null
                  }
                />
              </Section>
            </>
          )
        }}
      </Guard>

      {editingRow && (
        <PayrollAdjustmentDialog
          row={editingRow}
          month={editingRow.month || month}
          close={() => setEditingRow(null)}
          done={() => {
            setEditingRow(null)
            request.refresh()
          }}
        />
      )}

      {addingAdj && (
        <PayrollAdjustmentDialog
          month={month}
          staffList={staff.filter(s => s.active)}
          existingRows={request.data || []}
          close={() => setAddingAdj(false)}
          done={() => {
            setAddingAdj(false)
            request.refresh()
          }}
        />
      )}
    </Page>
  )
}

/* --- Итоги месяца --- */
export function Month() {
  const { today } = useWorkspace()
  const maxMonth = today.slice(0, 7)
  const minMonth = '2025-01'
  const selection = useFilters('month', { month: maxMonth, tab: 'stock' })
  const { month, tab } = selection.filters
  const request = useRemote('/month', { month })

  const prevMonth = shiftMonthYm(month, -1)
  const nextMonth = shiftMonthYm(month, 1)
  const [monthStart, monthEnd] = monthBounds(month)

  const accounting = [
    ['opening', 'НЗП на начало месяца', 'addition'],
    ['material', 'Материалы', 'addition'],
    ['wages', 'Начисления по оплате труда', 'addition'],
    ['overhead', 'Прочие затраты', 'addition'],
    ['closing', 'НЗП на конец месяца', 'deduction']
  ]

  return (
    <Page
      title="Итоги месяца"
      subtitle={monthText(month) + ' · остатки, выпуск и себестоимость'}
      actions={
        <Download path="/month" options={{ month }} disabled={request.loading || !!request.error}>
          Скачать отчёт
        </Download>
      }
    >
      <div className="toolbar spec-toolbar">
        <Field label="Месяц">
          <DateControl
            month
            value={month}
            min={minMonth}
            max={maxMonth}
            onChange={e => {
              if (e.target.value) selection.change('month', e.target.value)
            }}
          />
        </Field>
        <div className="action-pair">
          <Button
            disabled={prevMonth < minMonth}
            onClick={() => selection.change('month', prevMonth)}
          >
            ← Предыдущий
          </Button>
          <Button
            disabled={nextMonth > maxMonth}
            onClick={() => selection.change('month', nextMonth)}
          >
            Следующий →
          </Button>
        </div>
      </div>

      <Tabs
        items={[
          ['stock', 'Выпуск и остатки'],
          ['cost', 'Себестоимость']
        ]}
        value={tab}
        onChange={value => selection.change('tab', value)}
      />

      <Guard request={request}>
        {d => {
          const totalOpening = d.flows.reduce((s, r) => s + r.opening, 0)
          const totalIncoming = d.flows.reduce((s, r) => s + r.incoming, 0)
          const totalOutgoing = d.flows.reduce((s, r) => s + r.outgoing, 0)
          const totalClosing = d.flows.reduce((s, r) => s + r.closing, 0)
          const wipClosing = d.flows.filter(r => r.kind !== 'finished').reduce((s, r) => s + r.closing, 0)
          const finishedClosing = d.flows.find(r => r.kind === 'finished')?.closing || 0
          const maxFlow = Math.max(1, ...d.flows.flatMap(r => [r.incoming, r.outgoing, r.closing]))

          const costParts = [
            { key: 'opening', label: 'НЗП на начало', value: d.opening, color: '#6b7280' },
            { key: 'material', label: 'Материалы', value: d.material, color: 'var(--primary)' },
            { key: 'wages', label: 'Оплата труда', value: d.wages, color: 'var(--link)' },
            { key: 'overhead', label: 'Прочие затраты', value: d.overhead, color: '#c4832b' }
          ]
          const costPartColor = Object.fromEntries(costParts.map(p => [p.key, p.color]))
          const grossCost = costParts.reduce((s, p) => s + Math.max(0, p.value), 0)
          const maxArticle = Math.max(1, ...accounting.map(([k]) => Math.abs(d[k] || 0)))
          const avgUnitCost = d.completed > 0 ? Math.round((d.total * 1000) / d.completed) : null

          return tab === 'stock' ? (
            <>
              <MetricStrip
                items={[
                  {
                    label: 'Выпуск готовой продукции',
                    value: qty(d.completed) + ' компл.',
                    meta: 'Упаковано за ' + monthText(month).toLowerCase()
                  },
                  {
                    label: 'НЗП на конец месяца',
                    value: qty(wipClosing) + ' компл.',
                    meta: 'Крой, пошив и упаковка'
                  },
                  {
                    label: 'Готовая продукция на конец',
                    value: qty(finishedClosing) + ' компл.',
                    meta: 'Остаток на складе готовой продукции'
                  }
                ]}
              />

              <Section title="Движение по складам Иваново" subtitle="Приход и расход за месяц, комплектов">
                <div className="surface-panel">
                  <div className="cost-breakdown">
                    <div className="output-chart">
                      {d.flows.map(r => (
                        <div className="cost-row" key={r.id}>
                          <a
                            href={href('/stock/' + r.id + '?tab=history&start=' + monthStart + '&end=' + monthEnd)}
                          >
                            {r.name}
                          </a>
                          <div className="bar-track" aria-hidden="true">
                            <div
                              className={'bar-fill ' + (r.kind === 'finished' ? 'pack' : r.kind)}
                              style={{ width: (r.incoming / maxFlow) * 100 + '%' }}
                            />
                          </div>
                          <strong className="right">
                            +{qty(r.incoming)} / −{qty(r.outgoing)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Section>

              <Section title="Выпуск и остатки по складам">
                <Table
                  rows={d.flows}
                  label="Выпуск и остатки"
                  rowHref={r => '/stock/' + r.id + '?tab=history&start=' + monthStart + '&end=' + monthEnd}
                  columns={[
                    {
                      label: 'Склад',
                      primary: true,
                      cell: r => (
                        <a href={href('/stock/' + r.id + '?tab=history&start=' + monthStart + '&end=' + monthEnd)}>
                          {r.name}
                        </a>
                      )
                    },
                    ...['opening', 'incoming', 'outgoing', 'closing'].map((key, idx) => ({
                      label: ['На начало', 'Приход', 'Расход', 'На конец'][idx] + ', компл.',
                      align: 'right',
                      mobileFull: key === 'opening',
                      mobileAccent: key === 'closing',
                      cell: r => (key === 'closing' ? <strong>{qty(r[key])}</strong> : qty(r[key]))
                    }))
                  ]}
                  mobileSummary={{
                    title: 'Итого по складам изделий',
                    rows: [
                      { label: 'На начало', value: qty(totalOpening) + ' компл.' },
                      { label: 'Приход', value: qty(totalIncoming) + ' компл.' },
                      { label: 'Расход', value: qty(totalOutgoing) + ' компл.' },
                      { label: 'На конец', value: qty(totalClosing) + ' компл.', strong: true }
                    ]
                  }}
                  footer={
                    <tr>
                      <th scope="row">Итого по складам изделий</th>
                      <td className="right" data-label="На начало">{qty(totalOpening)}</td>
                      <td className="right" data-label="Приход">{qty(totalIncoming)}</td>
                      <td className="right" data-label="Расход">{qty(totalOutgoing)}</td>
                      <td className="right" data-label="На конец">
                        <strong>{qty(totalClosing)}</strong>
                      </td>
                    </tr>
                  }
                />
              </Section>

              <div className="inline-note info version-banner">
                <span>
                  Склад сырья (5-й склад Иваново) учитывается в метрах и штуках на отдельном складе.
                </span>
                <a href={href('/stock/1?tab=history&start=' + monthStart + '&end=' + monthEnd)}>
                  Движения сырья за {monthText(month).toLowerCase()} →
                </a>
              </div>
            </>
          ) : (
            <>
              <MetricStrip
                items={[
                  {
                    label: 'Себестоимость выпуска',
                    value: money(d.total),
                    meta: 'НЗП на начало + затраты − НЗП на конец'
                  },
                  {
                    label: 'Выпущено комплектов',
                    value: qty(d.completed) + ' компл.',
                    meta: 'Готовая продукция за месяц'
                  },
                  {
                    label: 'Средняя себестоимость',
                    value: avgUnitCost != null ? money(avgUnitCost) : '—',
                    meta: 'На 1 выпущенный комплект'
                  }
                ]}
              />

              <Section
                title="Структура себестоимости выпуска"
                subtitle="НЗП на начало + материалы + оплата труда + прочие затраты − НЗП на конец"
              >
                <div className="surface-panel">
                  <div className="cost-breakdown">
                    {grossCost > 0 && (
                      <>
                        <div className="cost-stack" role="img" aria-label="Структура затрат за месяц">
                          {costParts
                            .filter(p => p.value > 0)
                            .map(p => (
                              <span
                                key={p.key}
                                title={`${p.label}: ${money(p.value)}`}
                                style={{ width: (p.value / grossCost) * 100 + '%', background: p.color }}
                              />
                            ))}
                        </div>
                        <div className="cost-legend">
                          {costParts.map(p => {
                            const share = grossCost > 0 ? Math.round((Math.max(0, p.value) / grossCost) * 100) : 0
                            return (
                              <span key={p.key}>
                                <i className="dot" style={{ background: p.color }} />
                                {p.label}: <strong>{money(p.value)}</strong> ({share}%)
                              </span>
                            )
                          })}
                        </div>
                      </>
                    )}
                    <div className="output-chart">
                      {accounting.map(([key, label, kind]) => {
                        const val = d[key] || 0
                        const isDeduction = kind === 'deduction'
                        const share = grossCost > 0 ? Math.round((Math.abs(val) / grossCost) * 100) : 0
                        return (
                          <div className="cost-row" key={key}>
                            <span>
                              {isDeduction ? '− ' + label : '+ ' + label}{' '}
                              <small className="muted">({share}%)</small>
                            </span>
                            <div className="bar-track" aria-hidden="true">
                              <div
                                className={'bar-fill' + (isDeduction ? ' cost-deduction' : '')}
                                style={{
                                  width: (Math.abs(val) / maxArticle) * 100 + '%',
                                  ...(!isDeduction ? { background: costPartColor[key] } : {})
                                }}
                              />
                            </div>
                            <strong className={isDeduction && val > 0 ? 'negative right' : 'right'}>
                              {isDeduction && val > 0 ? '−' : ''}
                              {money(val)}
                            </strong>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </Section>

              <Section title="Статьи себестоимости">
                <Table
                  rows={accounting.map(([key, label, kind]) => ({ key, label, kind, value: d[key] }))}
                  rowKey={r => r.key}
                  label="Себестоимость"
                  columns={[
                    { label: 'Статья затрат', primary: true, cell: r => r.label },
                    {
                      label: 'В расчёте',
                      mobileSubtitle: true,
                      cell: r => (r.kind === 'deduction' ? 'Вычитается (остаток НЗП)' : 'Увеличивает себестоимость')
                    },
                    {
                      label: 'Сумма',
                      align: 'right',
                      mobileAccent: true,
                      cell: r => (
                        <span className={r.kind === 'deduction' && r.value > 0 ? 'negative' : undefined}>
                          {r.kind === 'deduction' && r.value > 0 ? '−' : ''}
                          {money(r.value)}
                        </span>
                      )
                    }
                  ]}
                  mobileSummary={{
                    rows: [{ label: 'Себестоимость выпуска', value: money(d.total), strong: true }]
                  }}
                  footer={
                    <tr>
                      <th scope="row" colSpan={2}>
                        Себестоимость выпуска
                      </th>
                      <td className="right">
                        <strong>{money(d.total)}</strong>
                      </td>
                    </tr>
                  }
                />
              </Section>

              {d.overhead_details && <p className="inline-note">{d.overhead_details}</p>}
            </>
          )
        }}
      </Guard>
    </Page>
  )
}

/* --- Профиль и настройки (#/profile, #/settings) --- */
export function Settings() {
  const { user, settings, refresh, logout, openInstallGuide, installPwa, isStandalone, canInstallPwa } = useWorkspace()
  const toast = useToast()
  const canWrite = roleCanWrite(user)

  const currentLoaderRateKopecks = Number(settings?.loader_rate ?? 6000)
  const [loaderRate, setLoaderRate] = useState(() => toRubInput(currentLoaderRateKopecks))
  const rateState = useAction()

  useEffect(() => {
    setLoaderRate(toRubInput(Number(settings?.loader_rate ?? 6000)))
  }, [settings?.loader_rate])

  const [data, setData] = useState({ old: '', new: '', repeat: '' })
  const [saved, setSaved] = useState(false)
  const state = useAction()

  const tooShort = Boolean(data.new && data.new.length < 10)
  const mismatch = Boolean(data.repeat && data.new !== data.repeat)
  const sameAsOld = Boolean(data.old && data.new && data.old === data.new)

  function handleRateSubmit(e) {
    e.preventDefault()
    rateState.run(async () => {
      const value = Number(loaderRate)
      if (!Number.isFinite(value) || value < 0) throw new Error('Укажите корректную ставку грузчика.')
      await api('/settings', 'PUT', { loader_rate: value })
      toast.success('Ставка грузчика обновлена')
      refresh()
    })
  }

  function handlePasswordSubmit(e) {
    e.preventDefault()
    setSaved(false)
    state.run(async () => {
      if (data.new.length < 10) throw new Error('Новый пароль должен содержать не менее 10 символов.')
      if (data.new !== data.repeat) throw new Error('Новые пароли не совпадают.')
      if (data.old === data.new) throw new Error('Новый пароль должен отличаться от текущего.')
      await api('/password', 'POST', { old: data.old, new: data.new })
      setData({ old: '', new: '', repeat: '' })
      setSaved(true)
      toast.success('Пароль изменён. Прежние сеансы завершены.')
    })
  }

  const rateUnchanged = parseRubToKopecks(loaderRate) === currentLoaderRateKopecks

  return (
    <Page title="Профиль" subtitle="Учётная запись, открытый период и безопасность доступа">
      <div className="profile-layout">
        <div className="profile-col">
          <Section title="Учётная запись">
            <div className="surface-panel profile-card">
              <div className="profile-account-head">
                <span className="avatar" aria-hidden="true">
                  {initials(user.name)}
                </span>
                <div>
                  <strong>{user.name}</strong>
                  <span className="muted">
                    {user.role_name} · {user.email}
                  </span>
                </div>
              </div>
              <Details
                values={[
                  ['Имя', user.name],
                  ['Роль', user.role_name],
                  ['Электронная почта', user.email],
                  ['Язык интерфейса', 'Русский'],
                  ...(user.city ? [['Склад', user.warehouse_name + ' · ' + user.city]] : [])
                ]}
              />
              <div className="profile-logout-row">
                <Button kind="quiet-danger" onClick={logout}>
                  Выйти из аккаунта
                </Button>
              </div>
            </div>
          </Section>

          {settings && (
            <Section title="Параметры учёта">
              <div className="surface-panel">
                <Details
                  values={[
                    ['Организация', settings.company],
                    [
                      'Открытый расчётный период',
                      <div className="assignment-help">
                        <Status value="posted" label={monthText(settings.open_month)} />
                        <small className="muted">с {dayText(settings.open_month + '-01')}</small>
                      </div>
                    ],
                    ...(!canWrite ? [['Ставка грузчика', money(currentLoaderRateKopecks) + ' / час']] : [])
                  ]}
                />

                {!canWrite && (
                  <>
                    <p className="muted">
                      Операции задним числом ограничены открытым периодом. Спецификации и расценки хранятся в каталоге изделий.
                    </p>
                    <ActionRow>
                      <Button to="/catalog">Открыть изделия и нормы</Button>
                    </ActionRow>
                  </>
                )}
              </div>

              {canWrite && (
                <form className="form-flat" onSubmit={handleRateSubmit}>
                  <Field
                    label="Фиксированная ставка грузчика, ₽ / час"
                    help="Применяется в отчётах за смену при добавлении почасовой работы грузчиком"
                  >
                    <input
                      required
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="20000000"
                      step=".01"
                      disabled={rateState.busy}
                      value={loaderRate}
                      onChange={e => setLoaderRate(e.target.value)}
                    />
                  </Field>
                  <ErrorBox error={rateState.error} />
                  <div className="form-actions">
                    <Button type="submit" kind="primary" disabled={rateState.busy || rateUnchanged}>
                      {rateState.busy ? 'Сохранение…' : 'Сохранить ставку'}
                    </Button>
                    <Button to="/catalog">Открыть изделия и нормы</Button>
                  </div>
                </form>
              )}
            </Section>
          )}

          <Section title="Приложение на телефоне">
            <div className="surface-panel">
              {isStandalone ? (
                <div className="pwa-install-card">
                  <p className="muted">Приложение установлено и работает в полноэкранном режиме.</p>
                  <Status value="posted" label="Установлено" />
                </div>
              ) : (
                <div className="pwa-install-card">
                  <p className="muted">
                    Добавьте «Швейную фабрику» на экран «Домой» для быстрого запуска, полноэкранного режима и кэширования интерфейса.
                  </p>
                  {canInstallPwa && installPwa && openInstallGuide ? (
                    <div className="action-pair">
                      <Button kind="primary" onClick={installPwa}>
                        Установить
                      </Button>
                      <Button kind="secondary" onClick={openInstallGuide}>
                        Инструкция
                      </Button>
                    </div>
                  ) : openInstallGuide ? (
                    <Button kind="primary" onClick={openInstallGuide}>
                      Установить на экран «Домой»
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </Section>
        </div>

        <div className="profile-col">
          <Section
            title="Смена пароля"
            subtitle="После смены пароля все другие активные сеансы будут завершены"
          >
            <div className="form-flat">
              {saved && (
                <div className="notice success" role="status">
                  Пароль успешно изменён.
                </div>
              )}
              <form className="spec-form" onSubmit={handlePasswordSubmit}>
                <Field label="Текущий пароль">
                  <PasswordInput
                    required
                    maxLength="128"
                    autoComplete="current-password"
                    disabled={state.busy}
                    value={data.old}
                    onChange={e => {
                      setSaved(false)
                      setData(v => ({ ...v, old: e.target.value }))
                    }}
                  />
                </Field>
                <Field
                  label="Новый пароль"
                  help={
                    tooShort
                      ? 'Слишком короткий: нужно минимум 10 символов.'
                      : sameAsOld
                        ? 'Новый пароль должен отличаться от текущего.'
                        : 'Минимум 10 символов'
                  }
                >
                  <PasswordInput
                    required
                    minLength="10"
                    maxLength="128"
                    autoComplete="new-password"
                    disabled={state.busy}
                    value={data.new}
                    onChange={e => {
                      setSaved(false)
                      setData(v => ({ ...v, new: e.target.value }))
                    }}
                  />
                </Field>
                <Field
                  label="Повторите новый пароль"
                  help={mismatch ? 'Введённые пароли не совпадают.' : undefined}
                >
                  <PasswordInput
                    required
                    minLength="10"
                    maxLength="128"
                    autoComplete="new-password"
                    disabled={state.busy}
                    value={data.repeat}
                    onChange={e => {
                      setSaved(false)
                      setData(v => ({ ...v, repeat: e.target.value }))
                    }}
                  />
                </Field>
                <ErrorBox error={state.error} />
                <div className="form-actions">
                  <Button
                    type="submit"
                    kind="primary"
                    disabled={state.busy || tooShort || mismatch || sameAsOld}
                  >
                    {state.busy ? 'Сохранение…' : 'Изменить пароль'}
                  </Button>
                </div>
              </form>
            </div>
          </Section>
        </div>
      </div>
    </Page>
  )
}

export const Profile = Settings
