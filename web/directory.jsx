import React, { useEffect, useId, useMemo, useState } from 'react'
import {
  ActionRow, Button, Card, DateControl, DateRange, Details, Dialog, Download, ErrorBox,
  Field, FormActions, Guard, Page, Pager, RegistryTools, Select, Status, Table, Tabs,
  api, dayText, go, href, itemText, matchesSearch, money, monthText, number, qty,
  roleCanWrite, routeWith, stages, useAction, useFilters, useRemote, useToast, useWorkspace
} from './ui'
import { PasswordInput, SearchPicker } from './pickers'

const production = Object.entries(stages).slice(0, 3)

const payrollColumns = [
  {
    label: 'Сотрудник',
    cell: r => (
      <>
        <a href={href('/people/' + r.id)}>{r.name}</a>
        {r.position && <small className="cell-secondary">{r.position}</small>}
      </>
    )
  },
  { label: 'Этап', cell: r => stages[r.stage] || r.stage },
  { label: 'Комплектов', align: 'right', cell: r => qty(r.quantity) },
  { label: 'Документов', align: 'right', cell: r => number(r.documents) },
  { label: 'Начислено', align: 'right', cell: r => <strong>{money(r.amount)}</strong> }
]

const edit = (set, key, numeric = false) => e =>
  set(v => ({ ...v, [key]: numeric ? Number(e.target.value) : e.target.value }))

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

function LocalPager({ rows, columns, page, setPage, label, empty, footer, rowKey }) {
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
        rowKey={rowKey}
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
  const { items, user } = useWorkspace()
  const state = useFilters('catalog', { search: '', category: '', size: '' })
  const { filters, page, setPage, change } = state
  const products = useMemo(() => items.filter(i => i.kind === 'product'), [items])
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
      <Card>
        <RegistryTools state={state} total={rows.length} placeholder="Модель, артикул, размер или категория">
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
          columns={[
            {
              label: 'Изделие',
              cell: r => (
                <>
                  <a href={href('/catalog/' + r.id)}>{r.name}</a>
                  {r.category && <small className="cell-secondary">{r.category}</small>}
                </>
              )
            },
            { label: 'Размер', cell: r => r.size },
            { label: 'Артикул', cell: r => r.sku },
            { label: 'Спецификация', cell: r => (r.version ? 'Версия ' + r.version : '—') },
            { label: 'Цена продажи', align: 'right', cell: r => money(r.price) },
            {
              label: 'Статус',
              align: 'after-number',
              cell: () => <Status value="posted" label="Действует" />
            }
          ]}
        />
      </Card>
    </Page>
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
      : production.map(([s], i) => ({ key: i, item_id: '', stage: s, quantity: 1 }))
  )

  function patch(key, change) {
    setNorms(list => list.map(n => (n.key === key ? { ...n, ...change } : n)))
  }

  const rawItems = ws.items.filter(i => i.kind === 'raw')

  const form = (
    <form
      id={formId}
      className="spec-form"
      onSubmit={e => {
        e.preventDefault()
        state.run(async () => {
          if (!norms.length) throw new Error('Добавьте хотя бы одну норму расхода материала.')
          if (norms.some(n => !n.item_id)) throw new Error('Выберите материал в каждой строке нормы.')
          const data = {
            ...rates,
            norms: norms.map(({ key, ...n }) => n),
            ...(detail ? {} : details)
          }
          const result = await api('/catalog' + (detail ? '/' + detail.item.id + '/versions' : ''), 'POST', data)
          toast.success(detail ? 'Новая версия спецификации сохранена' : 'Изделие и спецификация созданы')
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
              value={details.price}
              onChange={edit(setDetails, 'price')}
            />
          </Field>
        </div>
      )}
      <h3>Нормы материалов на 1 комплект</h3>
      <div className="spec-lines">
        {norms.map(n => {
          const unit = rawItems.find(i => i.id === n.item_id)?.unit
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
                  min={unit === 'м' ? '.001' : '1'}
                  max="100000"
                  step={unit === 'м' ? '.001' : '1'}
                  type="number"
                  value={n.quantity}
                  onChange={e => patch(n.key, { quantity: e.target.value })}
                />
              </Field>
              <Button
                kind="quiet-danger"
                className="icon-only"
                aria-label="Убрать материал"
                disabled={norms.length <= 1}
                onClick={() => setNorms(list => list.filter(o => o.key !== n.key))}
              >
                ×
              </Button>
            </div>
          )
        })}
      </div>
      <Button
        disabled={norms.some(n => !n.item_id)}
        onClick={() =>
          setNorms(list => [
            ...list,
            { key: Math.max(-1, ...list.map(n => n.key)) + 1, item_id: '', stage: 'cut', quantity: 1 }
          ])
        }
      >
        Добавить материал
      </Button>
      <h3>Сдельные расценки</h3>
      <div className="toolbar">
        {production.map(([s, label]) => (
          <Field key={s} label={label + ', ₽ / компл.'}>
            <input
              required
              type="number"
              min="0"
              max="20000000"
              step=".01"
              value={rates[s]}
              onChange={edit(setRates, s)}
            />
          </Field>
        ))}
      </div>
      <ErrorBox error={state.error} />
      {!detail && <FormActions busy={state.busy} cancel={close} submit="Создать изделие" />}
    </form>
  )

  return detail ? (
    <Dialog
      title="Новая версия спецификации"
      close={close}
      closeDisabled={state.busy}
      footer={<FormActions form={formId} busy={state.busy} cancel={close} submit="Сохранить версию" />}
    >
      {form}
    </Dialog>
  ) : (
    form
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
    { label: 'Этап', cell: r => stages[r.stage] },
    { label: 'Материал', cell: r => <a href={href('/stock/1/items/' + r.item_id)}>{r.name}</a> },
    { label: 'Количество', align: 'right', cell: r => <strong>{qty(r.quantity)}</strong> },
    { label: 'Единица', cell: r => r.unit },
    ...(compareTarget
      ? [
          {
            label: 'Было (в. ' + compareTarget.version + ')',
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
              if (!prev) return <span className="version-diff diff-up">Новая позиция</span>
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
    { label: 'Этап', cell: r => r.label },
    { label: 'Операция', cell: r => actionLabels[r.id] },
    { label: 'Единица выработки', cell: () => 'компл.' },
    { label: 'Расценка', align: 'right', cell: r => <strong>{money(v?.rates[r.id] || 0)}</strong> },
    ...(compareTarget
      ? [
          {
            label: 'Было (в. ' + compareTarget.version + ')',
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
        [item.category, item.sku, v ? 'версия ' + v.version + ' от ' + dayText(v.effective) : '']
          .filter(Boolean)
          .join(' · ')
      }
      actions={roleCanWrite(user) && <Button kind="primary" onClick={() => setOpen(true)}>Новая версия</Button>}
    >
      <Card className="kpi-grid cols-3">
        <div className="kpi-item">
          <span className="kpi-label">Цена продажи</span>
          <strong className="kpi-value">{money(item.price)}</strong>
          <span className="kpi-meta">{item.category} · {item.size}</span>
        </div>
        <div className="kpi-item">
          <span className="kpi-label">Спецификация</span>
          <strong className="kpi-value">{v ? 'Версия ' + v.version : '—'}</strong>
          <span className="kpi-meta">
            {v ? (isLatest ? 'Актуальная · ' : 'Архивная · ') + 'с ' + dayText(v.effective) : 'Не задана'}
          </span>
        </div>
        <div className="kpi-item">
          <span className="kpi-label">Сдельные начисления</span>
          <strong className="kpi-value">{v ? money(totalRates) : '—'}</strong>
          <span className="kpi-meta">За полный цикл (3 этапа)</span>
        </div>
      </Card>

      <Card>
        <div className="toolbar spec-toolbar">
          <Field label="Версия спецификации" className="spec-version-field">
            <Select
              value={v?.id || ''}
              onChange={e => {
                setVersion(e.target.value)
                if (String(compareId) === String(e.target.value)) setCompareId('')
              }}
              entries={versions.map((ver, idx) => [
                ver.id,
                'Версия ' + ver.version + ' · ' + dayText(ver.effective) + (idx === 0 ? ' (актуальная)' : '')
              ])}
            />
          </Field>
          {versions.length > 1 && (
            <>
              <div className="spec-nav-buttons">
                <Button
                  size="small"
                  disabled={!olderVersion}
                  onClick={() => {
                    if (olderVersion) setVersion(String(olderVersion.id))
                  }}
                >
                  ← Предыдущая
                </Button>
                <Button
                  size="small"
                  disabled={!newerVersion}
                  onClick={() => {
                    if (newerVersion) setVersion(String(newerVersion.id))
                  }}
                >
                  Следующая →
                </Button>
              </div>
              <Field label="Сравнить с версией" className="spec-version-field">
                <Select
                  placeholder="Без сравнения"
                  value={compareTarget ? String(compareTarget.id) : ''}
                  onChange={e => setCompareId(e.target.value)}
                  entries={versions
                    .filter(ver => ver.id !== v?.id)
                    .map(ver => [
                      ver.id,
                      'Версия ' +
                        ver.version +
                        ' · ' +
                        dayText(ver.effective) +
                        (ver.id === versions[0].id ? ' (актуальная)' : '')
                    ])}
                />
              </Field>
            </>
          )}
        </div>

        {v && !isLatest && (
          <div className="inline-note info version-banner">
            <span>
              Вы просматриваете историческую версию {v.version} (действует с {dayText(v.effective)}).
            </span>
            <Button size="small" onClick={() => setVersion(String(versions[0].id))}>
              Перейти к актуальной (версия {versions[0].version})
            </Button>
          </div>
        )}

        <Tabs
          items={[
            ['materials', 'Материалы'],
            ['rates', 'Технологическая карта и расценки']
          ]}
          value={tab}
          onChange={setTab}
        />

        {v && tab === 'materials' && (
          <>
            <h3>Нормы на один комплект</h3>
            <Table
              label="Нормы материалов"
              rows={v.norms}
              rowKey={r => r.stage + '-' + r.item_id}
              columns={materialColumns}
            />
            {compareTarget && removedNorms.length > 0 && (
              <div className="inline-note">
                Исключены по сравнению с версией {compareTarget.version}:{' '}
                {removedNorms.map(n => `${stages[n.stage]} — ${n.name} (${qty(n.quantity)} ${n.unit})`).join(', ')}.
              </div>
            )}
            <p className="muted">Проведённые отчёты сохраняют нормы своей версии спецификации.</p>
          </>
        )}

        {v && tab === 'rates' && (
          <Table
            label="Технологическая карта и расценки"
            rows={rateRows}
            columns={rateColumns}
            footer={
              <tr>
                <th scope="row" colSpan={3}>
                  Сдельные начисления на полный цикл (за 1 компл.)
                </th>
                <td className="right">
                  <strong>{money(totalRates)}</strong>
                </td>
                {compareTarget && (
                  <>
                    <td className="right">{money(compareTotalRates)}</td>
                    <td className="right">
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
        )}
      </Card>

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
      <Page title="Добавить изделие">
        <Card title="Изделие и первая спецификация">
          <SpecEditor
            close={() => go('/catalog')}
            done={r => {
              ws.refresh()
              go('/catalog/' + r.id)
            }}
          />
        </Card>
      </Page>
    ) : (
      <Card className="forbidden-card">
        <ErrorBox error="Создание изделий доступно только администратору и бухгалтеру." />
        <ActionRow>
          <Button to="/catalog">Вернуться в каталог</Button>
        </ActionRow>
      </Card>
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

/* --- Сотрудники --- */
export function People() {
  const { staff, user, today, refresh } = useWorkspace()
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
      actions={roleCanWrite(user) && <Button kind="primary" onClick={() => setOpen(true)}>Добавить сотрудника</Button>}
    >
      <Card>
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
          columns={[
            { label: 'Сотрудник', cell: r => <a href={href('/people/' + r.id)}>{r.name}</a> },
            { label: 'Должность', cell: r => r.position },
            { label: 'Участок', cell: r => stages[r.stage] || r.stage },
            { label: 'Дата приёма', cell: r => dayText(r.hired_on) },
            {
              label: 'Статус',
              cell: r => <Status value={r.active ? 'posted' : 'inactive'} label={r.active ? 'Работает' : 'Не работает'} />
            }
          ]}
        />
      </Card>
      {open && roleCanWrite(user) && (
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
    record ? { ...record, active: !!record.active } : { name: '', position: '', stage: 'cut', hired_on: today, active: true }
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
            const r = await api('/staff' + (record ? '/' + record.id : ''), record ? 'PUT' : 'POST', data)
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
  const [tab, setTab] = useState('')

  return (
    <Guard request={request}>
      {d => {
        const canWrite = roleCanWrite(user)
        const isProductionWorker = production.some(([sid]) => sid === d.staff.stage)
        const works = canWrite && (isProductionWorker || d.rows.length > 0)
        const activeTab = works ? tab || 'wages' : 'profile'
        const amount = d.rows.reduce((s, r) => s + r.amount, 0)
        const quantity = d.rows.reduce((s, r) => s + r.quantity, 0)

        return (
          <Page
            title={d.staff.name}
            subtitle={d.staff.position + ' · ' + (works ? 'сдельная оплата' : stages[d.staff.stage] || d.staff.stage)}
            actions={canWrite && <Button onClick={() => setOpen(true)}>Редактировать</Button>}
          >
            {works && (
              <Card className="kpi-grid cols-3">
                <div className="kpi-item">
                  <span className="kpi-label">Начислено за период</span>
                  <strong className="kpi-value">{money(amount)}</strong>
                  <span className="kpi-meta">{dayText(filters.start)} — {dayText(filters.end)}</span>
                </div>
                <div className="kpi-item">
                  <span className="kpi-label">Выработка за период</span>
                  <strong className="kpi-value">{qty(quantity)} компл.</strong>
                  <span className="kpi-meta">Строк выработки: {number(d.rows.length)}</span>
                </div>
                <div className="kpi-item">
                  <span className="kpi-label">Последний отчёт в периоде</span>
                  <strong className="kpi-value">
                    {d.rows.length ? <a href={href('/reports/' + d.rows[0].id)}>{d.rows[0].code}</a> : '—'}
                  </strong>
                  <span className="kpi-meta">{d.rows.length ? dayText(d.rows[0].date) : 'Нет проведённых отчётов'}</span>
                </div>
              </Card>
            )}

            <Card>
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
                  <Details
                    values={[
                      ['Имя', d.staff.name],
                      ['Участок', stages[d.staff.stage] || d.staff.stage],
                      ['Должность', d.staff.position],
                      ['Дата приёма', dayText(d.staff.hired_on)],
                      ...(works ? [['Форма оплаты', 'Сдельная']] : []),
                      [
                        'Статус',
                        <Status
                          value={d.staff.active ? 'posted' : 'inactive'}
                          label={d.staff.active ? 'Работает' : 'Не работает'}
                        />
                      ]
                    ]}
                  />
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
                  <RegistryTools state={state} periodLabel total={d.rows.length}>
                    <DateRange
                      filters={filters}
                      change={change}
                      allowClear={false}
                      onRangeChange={(start, end) => update({ start, end })}
                    />
                  </RegistryTools>
                  <LocalPager
                    rows={d.rows.map((r, i) => ({ ...r, id: r.id + '-' + r.item_id + '-' + i, doc_id: r.id }))}
                    label="Начисления сотрудника"
                    empty="За выбранный период начислений нет"
                    page={page}
                    setPage={setPage}
                    columns={[
                      {
                        label: 'Дата / документ',
                        cell: r => (
                          <a href={href('/reports/' + r.doc_id)}>
                            {dayText(r.date)} · {r.code}
                          </a>
                        )
                      },
                      { label: 'Изделие', cell: itemText },
                      { label: 'Количество', align: 'right', cell: r => qty(r.quantity) },
                      { label: 'Расценка', align: 'right', cell: r => money(r.rate) },
                      { label: 'Начислено', align: 'right', cell: r => <strong>{money(r.amount)}</strong> }
                    ]}
                    footer={
                      d.rows.length > 0 ? (
                        <tr>
                          <th scope="row" colSpan={2}>
                            Итого за период
                          </th>
                          <td className="right">
                            <strong>{qty(quantity)} компл.</strong>
                          </td>
                          <td className="right">—</td>
                          <td className="right">
                            <strong>{money(amount)}</strong>
                          </td>
                        </tr>
                      ) : null
                    }
                  />
                  {d.rows.length > 0 && (
                    <ActionRow>
                      <Download path={'/staff/' + id} options={filters}>
                        Скачать расчёт
                      </Download>
                    </ActionRow>
                  )}
                </>
              )}
            </Card>

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
          </Page>
        )
      }}
    </Guard>
  )
}

/* --- Сдельная зарплата --- */
export function Payroll() {
  const { today } = useWorkspace()
  const state = useFilters('payroll', { search: '', stage: '', start: today.slice(0, 7) + '-01', end: today })
  const { filters, page, setPage, change, update } = state
  const request = useRemote('/payroll', { start: filters.start, end: filters.end, stage: filters.stage })

  return (
    <Page title="Сдельная зарплата" subtitle="Начисления по проведённым отчётам · без черновиков">
      <Guard request={request}>
        {records => {
          const rows = records.filter(r => matchesSearch(filters.search, r.name, r.position))
          const totalAmount = rows.reduce((s, r) => s + r.amount, 0)
          const totalQty = rows.reduce((s, r) => s + r.quantity, 0)
          const avgAmount = rows.length ? Math.round(totalAmount / rows.length) : 0
          const byStage = production.map(([code, label]) => {
            const group = rows.filter(r => r.stage === code)
            const amount = group.reduce((s, r) => s + r.amount, 0)
            const quantity = group.reduce((s, r) => s + r.quantity, 0)
            return { code, label, count: group.length, amount, quantity }
          })

          return (
            <>
              <Card className="kpi-grid cols-3">
                <div className="kpi-item">
                  <span className="kpi-label">Начислено по выборке</span>
                  <strong className="kpi-value">{money(totalAmount)}</strong>
                  <span className="kpi-meta">Исполнителей: {number(rows.length)}</span>
                </div>
                <div className="kpi-item">
                  <span className="kpi-label">Выработано комплектов</span>
                  <strong className="kpi-value">{qty(totalQty)} компл.</strong>
                  <span className="kpi-meta">{dayText(filters.start)} — {dayText(filters.end)}</span>
                </div>
                <div className="kpi-item">
                  <span className="kpi-label">Среднее на сотрудника</span>
                  <strong className="kpi-value">{rows.length ? money(avgAmount) : '—'}</strong>
                  <span className="kpi-meta">{filters.stage ? 'Этап: ' + stages[filters.stage] : 'Все этапы'}</span>
                </div>
              </Card>

              {rows.length > 0 && !filters.stage && (
                <Card title="Распределение начислений по этапам">
                  <div className="output-chart">
                    {byStage.map(s => {
                      const share = totalAmount > 0 ? Math.round((s.amount / totalAmount) * 100) : 0
                      return (
                        <div className="bar-row" key={s.code}>
                          <span>
                            {s.label} ({number(s.count)})
                          </span>
                          <div className="bar-track" aria-hidden="true">
                            <div
                              className={'bar-fill ' + s.code}
                              style={{ width: (totalAmount > 0 ? (s.amount / totalAmount) * 100 : 0) + '%' }}
                            />
                          </div>
                          <strong>
                            {money(s.amount)} · {share}%
                          </strong>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}

              <Card>
                <RegistryTools
                  state={state}
                  periodLabel
                  total={rows.length}
                  placeholder="Сотрудник или должность"
                >
                  <DateRange
                    filters={filters}
                    change={change}
                    allowClear={false}
                    onRangeChange={(start, end) => update({ start, end })}
                  />
                  <Field label="Этап" wide>
                    <Select
                      placeholder="Все этапы"
                      entries={production}
                      value={filters.stage}
                      onChange={e => change('stage', e.target.value)}
                    />
                  </Field>
                </RegistryTools>
                <LocalPager
                  rows={rows}
                  label="Сдельная зарплата"
                  empty="Начисления по этому запросу не найдены"
                  page={page}
                  setPage={setPage}
                  columns={payrollColumns}
                  footer={
                    rows.length > 0 ? (
                      <tr>
                        <th scope="row">Итого по выборке</th>
                        <td>{number(rows.length)} чел.</td>
                        <td className="right">
                          <strong>{qty(totalQty)}</strong>
                        </td>
                        <td className="right">—</td>
                        <td className="right">
                          <strong>{money(totalAmount)}</strong>
                        </td>
                      </tr>
                    ) : null
                  }
                />
                {rows.length > 0 && (
                  <ActionRow>
                    <Download path="/payroll" options={filters} />
                  </ActionRow>
                )}
              </Card>
            </>
          )
        }}
      </Guard>
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
    ['wages', 'Сдельные начисления', 'addition'],
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
      <Card>
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
          <div className="spec-nav-buttons">
            <Button
              size="small"
              disabled={prevMonth < minMonth}
              onClick={() => selection.change('month', prevMonth)}
            >
              ← Предыдущий
            </Button>
            <Button
              size="small"
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
              { key: 'wages', label: 'Сдельная оплата', value: d.wages, color: 'var(--link)' },
              { key: 'overhead', label: 'Прочие затраты', value: d.overhead, color: '#c4832b' }
            ]
            const grossCost = costParts.reduce((s, p) => s + Math.max(0, p.value), 0)
            const maxArticle = Math.max(1, ...accounting.map(([k]) => Math.abs(d[k] || 0)))
            const avgUnitCost = d.completed > 0 ? Math.round((d.total * 1000) / d.completed) : null

            return tab === 'stock' ? (
              <>
                <div className="card kpi-grid cols-3">
                  <div className="kpi-item">
                    <span className="kpi-label">Выпуск готовой продукции</span>
                    <strong className="kpi-value">{qty(d.completed)} компл.</strong>
                    <span className="kpi-meta">Упаковано за {monthText(month).toLowerCase()}</span>
                  </div>
                  <div className="kpi-item">
                    <span className="kpi-label">НЗП на конец месяца</span>
                    <strong className="kpi-value">{qty(wipClosing)} компл.</strong>
                    <span className="kpi-meta">Крой, пошив и упаковка</span>
                  </div>
                  <div className="kpi-item">
                    <span className="kpi-label">Готовая продукция на конец</span>
                    <strong className="kpi-value">{qty(finishedClosing)} компл.</strong>
                    <span className="kpi-meta">Остаток на складе ГП (Иваново)</span>
                  </div>
                </div>

                <div className="cost-breakdown">
                  <div className="chart-title">
                    <h3>Движение по складам Иваново</h3>
                    <span>приход · расход · остаток на конец</span>
                  </div>
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
                          +{qty(r.incoming)} / −{qty(r.outgoing)} · ост. {qty(r.closing)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>

                <Table
                  rows={d.flows}
                  label="Выпуск и остатки"
                  columns={[
                    {
                      label: 'Склад',
                      cell: r => (
                        <a href={href('/stock/' + r.id + '?tab=history&start=' + monthStart + '&end=' + monthEnd)}>
                          {r.name}
                        </a>
                      )
                    },
                    ...['opening', 'incoming', 'outgoing', 'closing'].map((key, idx) => ({
                      label: ['На начало', 'Приход', 'Расход', 'На конец'][idx] + ', компл.',
                      align: 'right',
                      cell: r => (key === 'closing' ? <strong>{qty(r[key])}</strong> : qty(r[key]))
                    }))
                  ]}
                  footer={
                    <tr>
                      <th scope="row">Итого по складам изделий</th>
                      <td className="right">{qty(totalOpening)}</td>
                      <td className="right">{qty(totalIncoming)}</td>
                      <td className="right">{qty(totalOutgoing)}</td>
                      <td className="right">
                        <strong>{qty(totalClosing)}</strong>
                      </td>
                    </tr>
                  }
                />

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
                <div className="card kpi-grid cols-3">
                  <div className="kpi-item">
                    <span className="kpi-label">Себестоимость выпуска</span>
                    <strong className="kpi-value">{money(d.total)}</strong>
                    <span className="kpi-meta">НЗП нач. + затраты − НЗП кон.</span>
                  </div>
                  <div className="kpi-item">
                    <span className="kpi-label">Выпущено комплектов</span>
                    <strong className="kpi-value">{qty(d.completed)} компл.</strong>
                    <span className="kpi-meta">Готовая продукция за месяц</span>
                  </div>
                  <div className="kpi-item">
                    <span className="kpi-label">Средняя себестоимость</span>
                    <strong className="kpi-value">{avgUnitCost != null ? money(avgUnitCost) : '—'}</strong>
                    <span className="kpi-meta">На 1 выпущенный комплект</span>
                  </div>
                </div>

                <div className="cost-breakdown">
                  <div className="chart-title">
                    <h3>Структура себестоимости выпуска</h3>
                    <span>НЗП нач. + материалы + зарплата + накладные − НЗП кон.</span>
                  </div>
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
                          <span>{isDeduction ? '− ' + label : '+ ' + label}</span>
                          <div className="bar-track" aria-hidden="true">
                            <div
                              className={'bar-fill ' + (isDeduction ? 'cost-deduction' : key === 'wages' ? 'sew' : key === 'material' ? 'cut' : 'pack')}
                              style={{ width: (Math.abs(val) / maxArticle) * 100 + '%' }}
                            />
                          </div>
                          <strong className={isDeduction && val > 0 ? 'negative right' : 'right'}>
                            {isDeduction && val > 0 ? '−' : ''}
                            {money(val)} · {share}%
                          </strong>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <Table
                  rows={accounting.map(([key, label, kind]) => ({ key, label, kind, value: d[key] }))}
                  rowKey={r => r.key}
                  label="Себестоимость"
                  columns={[
                    { label: 'Статья затрат', cell: r => r.label },
                    {
                      label: 'В расчёте',
                      cell: r => (r.kind === 'deduction' ? 'Вычитается (остаток НЗП)' : 'Увеличивает себестоимость')
                    },
                    {
                      label: 'Сумма',
                      align: 'right',
                      cell: r => (
                        <span className={r.kind === 'deduction' && r.value > 0 ? 'negative' : undefined}>
                          {r.kind === 'deduction' && r.value > 0 ? '−' : ''}
                          {money(r.value)}
                        </span>
                      )
                    }
                  ]}
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

                {d.overhead_details && <p className="inline-note">{d.overhead_details}</p>}
              </>
            )
          }}
        </Guard>
      </Card>
    </Page>
  )
}

/* --- Настройки --- */
export function Settings() {
  const { user, settings, logout } = useWorkspace()
  const toast = useToast()
  const [data, setData] = useState({ old: '', new: '', repeat: '' })
  const [saved, setSaved] = useState(false)
  const state = useAction()

  const tooShort = Boolean(data.new && data.new.length < 10)
  const mismatch = Boolean(data.repeat && data.new !== data.repeat)
  const sameAsOld = Boolean(data.old && data.new && data.old === data.new)

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

  return (
    <Page title="Настройки" subtitle="Учётная запись, открытый период и безопасность доступа">
      <div className="settings-grid">
        <div className="settings-col">
          <Card title="Мой профиль" className="profile-card">
            <div className="profile-account-head">
              <span className="avatar" aria-hidden="true">
                {user.name?.[0] || '?'}
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
            <ActionRow>
              <Button onClick={logout}>Выйти из системы</Button>
            </ActionRow>
          </Card>

          {settings && (
            <Card title="Параметры учёта">
              <Details
                values={[
                  ['Организация', settings.company],
                  [
                    'Открытый расчётный период',
                    <Status value="posted" label={monthText(settings.open_month) + ' (с ' + dayText(settings.open_month + '-01') + ')'} />
                  ]
                ]}
              />
              <p className="muted">
                Операции задним числом ограничены открытым периодом. Нормы материалов и расценки хранятся в спецификациях изделий.
              </p>
              <ActionRow>
                <Button to="/catalog">Открыть изделия и нормы</Button>
              </ActionRow>
            </Card>
          )}
        </div>

        <Card title="Смена пароля" subtitle="После смены пароля все другие активные сеансы будут завершены">
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
        </Card>
      </div>
    </Page>
  )
}
