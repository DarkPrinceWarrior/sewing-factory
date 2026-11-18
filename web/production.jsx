import React, { useId, useState } from 'react'
import {
  ActionRow, Button, Card, Confirm, DateControl, DateRange, Dialog, Download, EmptyState,
  ErrorBox, Field, FormActions, Guard, Page, Pager, RegistryTools, Select, Status, Table, Tabs,
  api, dayText, go, href, itemText, money, monthText, number, qty, roleCanWrite, routeWith,
  shifts, stages, statuses, timeText, useAction, useFilters, useRemote, useSearchOptions,
  useToast, useWorkspace
} from './ui'
import { SearchPicker } from './pickers'

const production = Object.entries(stages).slice(0, 3)
const finishedLabels = { cut: 'Раскроено', sew: 'Пошито', pack: 'Упаковано' }
const wipLabels = { cut: 'Крой', sew: 'Пошив', pack: 'Упаковка' }
const tabList = [
  ['work', 'Выработка'],
  ['materials', 'Материалы'],
  ['wages', 'Технологическая карта · зарплата']
]
const events = {
  created: 'Создан',
  updated: 'Сохранён черновик',
  posted: 'Проведён',
  corrected: 'Исправлен',
  in_transit: 'Отправлен',
  received: 'Получен'
}
const operations = {
  material: 'Списание по норме',
  stage_use: 'Выдача в производство',
  packing_sent: 'Передача в упаковку',
  packing_received: 'Приём в упаковку',
  production: 'Выпуск',
  correction: 'Исправление',
  transfer_out: 'Отправка',
  transfer_in: 'Приёмка',
  sale: 'Продажа',
  receipt: 'Поступление'
}
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0)

function shiftReportColumns(overview = false) {
  const columns = [
    {
      label: overview ? 'Документ' : 'Документ / дата',
      width: overview ? '24%' : '23%',
      cell: r => (
        <>
          <a className="nowrap" href={href('/reports/' + r.id)}>{r.code}</a>
          <span className="cell-secondary nowrap">
            {overview ? timeText(r.created_at) : dayText(r.date)}
          </span>
        </>
      )
    },
    { label: 'Этап', width: '16%', cell: r => stages[r.stage] || r.stage },
    {
      label: 'Выработка',
      width: overview ? '18%' : '14%',
      align: 'right',
      cell: r => qty(r.quantity) + ' компл.'
    },
    {
      label: 'Начислено',
      width: overview ? '22%' : '16%',
      align: 'right',
      cell: r => (r.status === 'draft' ? '—' : money(r.wages))
    }
  ]
  if (!overview) {
    columns.push({ label: 'Автор', width: '16%', align: 'after-number', cell: r => r.author })
  }
  columns.push({
    label: 'Статус',
    width: overview ? '20%' : '15%',
    align: overview ? 'after-number' : undefined,
    cell: r => (
      <>
        <Status value={r.status} />
        {!overview && r.replacement_id && (
          <span className="cell-secondary nowrap">
            → <a href={href('/reports/' + r.replacement_id)}>{r.replacement_code || 'Исправление'}</a>
          </span>
        )}
        {!overview && !r.replacement_id && r.source_doc && (
          <span className="cell-secondary nowrap">
            ← <a href={href('/reports/' + r.source_doc)}>{r.source_code || 'Исходный'}</a>
          </span>
        )}
      </>
    )
  })
  return columns
}

function OutputChart({ data }) {
  const rows = production.map(([key]) => {
    const found = data.stages.find(row => row.stage === key)
    return [key, found?.quantity || 0, found?.documents || 0]
  })
  const totalOutput = sum(data.stages, 'quantity')
  const totalDocs = sum(data.stages, 'documents')
  const max = Math.max(1, ...rows.map(([, n]) => n))

  return (
    <Card className="output-card">
      <div className="output-chart">
        <div className="chart-title">
          <h2>Выработка за смену</h2>
          <span>
            {totalOutput > 0
              ? 'Итого: ' + qty(totalOutput) + ' компл.'
              : 'Выработка ещё не проведена'}
          </span>
        </div>
        {rows.map(([key, n, docs]) => (
          <div className="bar-row" key={key}>
            <span>{finishedLabels[key]}</span>
            <a
              className="bar-track"
              href={href(routeWith('/reports', { start: data.day, end: data.day, stage: key, status: 'posted' }))}
              title={stages[key] + ': ' + qty(n) + ' компл. (отчётов: ' + number(docs) + ')'}
              aria-label={stages[key] + ': открыть отчёты за ' + dayText(data.day)}
            >
              <div
                className={'bar-fill ' + key}
                style={{ width: (n > 0 ? Math.max(3, (n / max) * 100) : 0) + '%' }}
              />
            </a>
            <strong className="nowrap">{qty(n)} компл.</strong>
          </div>
        ))}
      </div>
      <div className="output-wages">
        <span>Начислено за смену</span>
        <strong>{money(data.wages)}</strong>
        <small>
          {totalDocs > 0
            ? 'Проведённых отчётов: ' + number(totalDocs)
            : 'Проведённых отчётов пока нет'}
        </small>
      </div>
    </Card>
  )
}

export function Wip({ rows, links = false, showStack = !links }) {
  const total = sum(rows, 'quantity')
  return (
    <div className="wip">
      <div className="wip-legend">
        {rows.map(w => (
          <div key={w.id}>
            <span>
              <i className={'dot ' + w.kind} />
              {links ? <a href={href('/stock/' + w.id)}>{wipLabels[w.kind]}</a> : wipLabels[w.kind]}
            </span>
            <b>{qty(w.quantity)} компл.</b>
          </div>
        ))}
      </div>
      {showStack && (
        <div className="stack" aria-hidden="true">
          {rows.filter(w => w.quantity > 0).map(w => (
            <span
              key={w.id}
              className={w.kind}
              style={{ width: (total ? (w.quantity / total) * 100 : 0) + '%' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function Overview() {
  const { today } = useWorkspace()
  const overview = useFilters('overview', { day: today })
  const day = overview.filters.day
  const request = useRemote('/overview', { day })

  return (
    <Page
      title="Обзор производства"
      subtitle={
        <>
          <DateControl
            inline
            required
            aria-label="Дата обзора"
            max={today}
            value={day}
            onChange={e => overview.change('day', e.target.value || today)}
          />
          {' · фактические результаты смены'}
        </>
      }
      actions={<Button kind="primary" to="/reports/new">Новый отчёт за смену</Button>}
    >
      <Guard request={request}>
        {data => (
          <>
            <OutputChart data={data} />
            <Card
              title="Отчёты за смену"
              actions={
                <Button to={routeWith('/reports', { start: day, end: day, status: 'posted' })}>
                  Отчёты за выбранный день
                </Button>
              }
            >
              <Table
                columns={shiftReportColumns(true)}
                rows={data.reports}
                label="Отчёты за смену"
                empty="За выбранную дату проведённых отчётов нет"
              />
            </Card>
            <div className="grid-two overview-bottom">
              <Card
                title={'Незавершённое производство · ' + qty(sum(data.wip, 'quantity')) + ' компл.'}
                subtitle={'Остаток на ' + dayText(day)}
                actions={<Button size="small" to="/stock">Открыть склады</Button>}
              >
                <Wip rows={data.wip} links showStack />
              </Card>
              <Card
                title="Требует внимания"
                actions={
                  data.pending.total > 0 ? (
                    <Button size="small" to={routeWith('/reports', { status: 'draft' })}>
                      Все черновики
                    </Button>
                  ) : null
                }
              >
                {data.pending.total ? (
                  <>
                    <strong>Черновиков отчётов: {number(data.pending.total)}</strong>
                    <ul className="attention">
                      {data.pending.rows.map(r => (
                        <li key={r.id}>
                          <a href={href('/reports/' + r.id)}>
                            {stages[r.stage]} · {r.code}
                          </a>{' '}
                          <span className="muted">({dayText(r.date)})</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="muted">Все отчёты проведены — черновиков нет.</p>
                )}
              </Card>
            </div>
          </>
        )}
      </Guard>
    </Page>
  )
}

export function ReportList() {
  const state = useFilters('reports', { search: '', start: '', end: '', stage: '', status: '' })
  const { filters, page, setPage, change, update, hasFilters, reset } = state
  const [pageSize, setPageSize] = useState(15)
  const { options, pending } = useSearchOptions(filters)
  const request = useRemote('/documents/report', { ...options, limit: pageSize, offset: (page - 1) * pageSize })

  return (
    <Page
      title="Отчёты за смену"
      subtitle="Выпуск, материалы и начисления в одном документе"
      actions={<Button kind="primary" to="/reports/new">Новый отчёт</Button>}
    >
      <Card>
        <RegistryTools
          state={state}
          placeholder="Документ, изделие или автор"
          total={request.data?.total}
        >
          <DateRange
            filters={filters}
            change={change}
            onRangeChange={(start, end) => update({ start, end })}
          />
          <Field label="Этап">
            <Select
              placeholder="Все этапы"
              entries={production}
              value={filters.stage}
              onChange={e => change('stage', e.target.value)}
            />
          </Field>
          <Field label="Статус">
            <Select
              placeholder="Все статусы"
              entries={[
                ['draft', 'Черновик'],
                ['posted', 'Проведён'],
                ['corrected', 'Исправлен']
              ]}
              value={filters.status}
              onChange={e => change('status', e.target.value)}
            />
          </Field>
        </RegistryTools>
        <Guard request={pending ? {} : request}>
          {d => (
            <>
              <Table
                columns={shiftReportColumns()}
                rows={d.rows}
                label="Реестр отчётов"
                hasPager={Boolean(d.total)}
                empty={
                  <EmptyState
                    title="Отчёты по этому запросу не найдены"
                    description={
                      filters.search || hasFilters
                        ? 'Попробуйте изменить поисковый запрос или сбросить фильтры.'
                        : 'Создайте первый отчёт за смену.'
                    }
                    action={
                      hasFilters ? (
                        <Button size="small" onClick={reset}>Сбросить фильтры</Button>
                      ) : (
                        <Button kind="primary" size="small" to="/reports/new">Новый отчёт</Button>
                      )
                    }
                  />
                }
              />
              <Pager
                page={page}
                size={pageSize}
                total={d.total}
                change={setPage}
                onSizeChange={s => {
                  setPageSize(s)
                  setPage(1)
                }}
              />
              {d.total > 0 && (
                <ActionRow>
                  <Download path="/documents/report" options={options} />
                </ActionRow>
              )}
            </>
          )}
        </Guard>
      </Card>
    </Page>
  )
}

function initialData(document, today) {
  if (!document) return { date: today, stage: 'cut', shift: 'day', memo: '', lines: [] }
  return {
    date: document.date,
    stage: document.stage,
    shift: document.shift,
    memo: document.memo || '',
    lines: document.lines.map(l => ({
      item_id: l.item_id,
      quantity: l.quantity / 1000,
      prepared: l.prepared / 1000,
      assignments: l.assignments.map(a => ({ staff_id: a.staff_id, quantity: a.quantity / 1000 }))
    }))
  }
}

function EditWorkLine({ original, stage, used, items, close, save, remove }) {
  const formId = useId()
  const [data, set] = useState(original || { item_id: '', quantity: 1, prepared: 0, assignments: [] })
  const [error, setError] = useState('')
  const change = (k, v) => {
    setError('')
    set(d => ({ ...d, [k]: v }))
  }
  const productEntries = items
    .filter(i => i.kind === 'product' && !used.includes(i.id))
    .map(i => [i.id, itemText(i), false, [i.sku, i.category].filter(Boolean).join(' · ')])

  function submit(e) {
    e.preventDefault()
    if (!data.item_id) {
      setError('Выберите изделие из списка.')
      return
    }
    const quantity = Number(data.quantity)
    const prepared = stage === 'pack' ? Number(data.prepared || 0) : 0
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
      setError('Укажите целое количество комплектов от 1 до 100 000.')
      return
    }
    if (stage === 'pack' && (!Number.isInteger(prepared) || prepared < 0 || prepared > 100000)) {
      setError('Укажите целое количество переданных комплектов от 0 до 100 000.')
      return
    }
    if (data.assignments.reduce((s, a) => s + a.quantity, 0) > quantity) {
      setError('Сначала уменьшите выработку в технологической карте.')
      return
    }
    save({ ...data, quantity, prepared })
  }

  return (
    <Dialog
      title={original ? 'Изменить выработку' : 'Добавить изделие'}
      close={close}
      footer={
        <>
          {remove && (
            <Button className="push-left" kind="quiet-danger" onClick={remove}>
              Удалить строку
            </Button>
          )}
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" form={formId} kind="primary">Сохранить</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <div className="form-grid">
          <Field label="Изделие" wide>
            <SearchPicker
              required
              placeholder="Поиск по названию, размеру или артикулу"
              entries={productEntries}
              value={data.item_id}
              onChange={e => change('item_id', e.target.value ? Number(e.target.value) : '')}
            />
          </Field>
          <Field label="Количество, компл.">
            <input
              required
              min="1"
              step="1"
              max="100000"
              type="number"
              value={data.quantity}
              onChange={e => change('quantity', e.target.value === '' ? '' : Number(e.target.value))}
            />
          </Field>
          {stage === 'pack' && (
            <Field
              label="Передано с пошива, компл."
              help="Сколько комплектов поступило на участок упаковки в эту смену."
            >
              <input
                required
                min="0"
                step="1"
                max="100000"
                type="number"
                value={data.prepared}
                onChange={e => change('prepared', e.target.value === '' ? '' : Number(e.target.value))}
              />
            </Field>
          )}
        </div>
        <ErrorBox error={error} />
      </form>
    </Dialog>
  )
}

function EditAssignment({ original, initialLine = 0, lines, workers, close, save, remove }) {
  const formId = useId()
  const lineRemaining = idx => {
    const target = lines[idx]
    if (!target) return 0
    return target.quantity - target.assignments
      .filter(a => !(original && idx === original.line && a.staff_id === original.staff_id))
      .reduce((s, a) => s + a.quantity, 0)
  }

  const startLine = original
    ? original.line
    : lines[initialLine] && lineRemaining(initialLine) > 0
      ? initialLine
      : Math.max(0, lines.findIndex((_, idx) => lineRemaining(idx) > 0))

  const [data, set] = useState(() =>
    original
      ? { line: original.line, staff_id: original.staff_id, quantity: original.quantity }
      : { line: startLine, staff_id: '', quantity: Math.max(1, lineRemaining(startLine)) }
  )
  const [error, setError] = useState('')
  const line = lines[data.line] || lines[0]
  const used = line.assignments
    .filter(a => !(original && data.line === original.line && a.staff_id === original.staff_id))
    .map(a => a.staff_id)
  const remaining = lineRemaining(data.line)
  const availableWorkers = workers.filter(w => !used.includes(w.id))

  const change = (key, value) => {
    setError('')
    set(d => ({ ...d, [key]: value }))
  }

  function submit(e) {
    e.preventDefault()
    if (!data.staff_id) {
      setError('Выберите исполнителя из списка.')
      return
    }
    const quantity = Number(data.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > remaining) {
      setError('Укажите целое количество от 1 до ' + number(remaining) + ' компл.')
      return
    }
    save({ ...data, quantity })
  }

  return (
    <Dialog
      title={original ? 'Изменить начисление' : 'Назначить исполнителя'}
      close={close}
      footer={
        <>
          {remove && (
            <Button className="push-left" kind="quiet-danger" onClick={remove}>
              Убрать исполнителя
            </Button>
          )}
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" form={formId} kind="primary" disabled={!remaining || !availableWorkers.length}>
            Сохранить
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <div className="form-grid">
          <Field label="Изделие" wide>
            <Select
              disabled={Boolean(original)}
              value={data.line}
              onChange={e => {
                const nextLine = Number(e.target.value)
                const nextRem = lineRemaining(nextLine)
                setError('')
                set({ line: nextLine, staff_id: '', quantity: nextRem > 0 ? nextRem : '' })
              }}
              entries={lines.map((l, i) => {
                const rem = lineRemaining(i)
                return [i, itemText(l.item) + (rem > 0 ? ' (остаток ' + number(rem) + ')' : ' (распределено)')]
              })}
            />
          </Field>
          <Field
            label="Исполнитель"
            help={
              !availableWorkers.length
                ? 'Все действующие сотрудники этого этапа уже назначены на выбранное изделие.'
                : undefined
            }
          >
            <SearchPicker
              required
              disabled={!availableWorkers.length}
              placeholder="Поиск сотрудника"
              value={data.staff_id}
              entries={availableWorkers.map(w => [w.id, w.name, false, w.position])}
              onChange={e => change('staff_id', e.target.value ? Number(e.target.value) : '')}
            />
          </Field>
          <Field
            label="Количество, компл."
            help={
              <span className="assignment-help">
                Доступно к распределению: <strong>{number(remaining)}</strong>
                {remaining > 0 && Number(data.quantity) !== remaining && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => change('quantity', remaining)}
                    >
                      Весь остаток ({number(remaining)})
                    </button>
                  </>
                )}
              </span>
            }
          >
            <input
              type="number"
              required
              min="1"
              step="1"
              max={Math.max(1, remaining)}
              disabled={!remaining}
              value={data.quantity}
              onChange={e => change('quantity', e.target.value === '' ? '' : Number(e.target.value))}
            />
          </Field>
        </div>
        <ErrorBox error={error} />
      </form>
    </Dialog>
  )
}

function MaterialRows({ document }) {
  const rows = document.lines.flatMap(l =>
    l.materials.map(m => ({ ...m, product: itemText(l), count: l.quantity, key: l.id + '-' + m.item_id }))
  )
  const totals = new Map()
  for (const r of rows) {
    const prev = totals.get(r.item_id)
    totals.set(r.item_id, { ...r, quantity: r.quantity + (prev?.quantity || 0) })
  }
  const summaryRows = [...totals.values()]
  const isDraft = document.status === 'draft'
  const shortages = isDraft ? summaryRows.filter(r => r.available < r.quantity) : []

  const columns = [
    { label: 'Материал', cell: r => <a href={href('/stock/1/items/' + r.item_id)}>{r.name}</a> },
    { label: 'Изделие', cell: r => r.product },
    { label: 'Норма на комплект', align: 'right', cell: r => qty(r.norm) + ' ' + r.unit },
    { label: 'Комплектов', align: 'right', cell: r => qty(r.count) },
    { label: 'К списанию', align: 'right', cell: r => qty(r.quantity) + ' ' + r.unit }
  ]
  if (isDraft) {
    columns.push({
      label: 'На складе',
      align: 'right',
      cell: r => {
        const needed = totals.get(r.item_id)?.quantity || r.quantity
        const lacks = r.available < needed
        return (
          <span className={lacks ? 'negative' : 'positive'}>
            {qty(r.available) + ' ' + r.unit}
          </span>
        )
      }
    })
  }

  return (
    <>
      <Table
        label="Списание материалов"
        rows={rows}
        rowKey={r => r.key}
        empty="По спецификации для выбранного этапа списание материалов не требуется"
        columns={columns}
      />
      {summaryRows.length > 0 && (
        <div className={shortages.length > 0 ? 'notice warning' : 'inline-note'}>
          {shortages.length > 0 && (
            <p className="shortage-heading">
              <strong>Недостаточно сырья на складе для проведения отчёта:</strong>
            </p>
          )}
          {summaryRows.map(r => (
            <div key={r.item_id}>
              <strong>
                <a href={href('/stock/1/items/' + r.item_id)}>{r.name}</a>: {qty(r.quantity)} {r.unit}.
              </strong>
              {isDraft && (
                <span className={r.available < r.quantity ? ' negative' : ''}>
                  {r.available >= r.quantity
                    ? ' После списания останется ' + qty(r.available - r.quantity)
                    : ' На складе ' + qty(r.available) + ', не хватает ' + qty(r.quantity - r.available)}{' '}
                  {r.unit}.
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export function DocumentHistory({ document, hideCost, defaultOpen = false }) {
  const ws = useWorkspace()
  const maskCost = hideCost ?? (ws?.user?.role === 'regional')
  const [open, setOpen] = useState(defaultOpen)
  const movementColumns = [
    {
      label: 'Операция',
      cell: r => operations[r.operation] || r.operation
    },
    { label: 'Склад', cell: r => r.warehouse },
    { label: 'Товар', cell: itemText },
    { label: 'Количество', align: 'right', cell: r => qty(r.quantity) + ' ' + r.unit }
  ]
  if (!maskCost) {
    movementColumns.push({ label: 'Стоимость', align: 'right', cell: r => money(r.value) })
  }

  return (
    <Card
      title="История документа"
      actions={
        <Button aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Свернуть' : 'Развернуть'}
        </Button>
      }
    >
      {open && (
        <>
          <Table
            label="История изменений"
            rows={document.events || []}
            empty="Событий пока нет"
            columns={[
              { label: 'Действие', cell: r => events[r.action] || r.action },
              { label: 'Сотрудник', cell: r => r.actor },
              {
                label: 'Дата и время',
                className: 'nowrap',
                cell: r => dayText(r.happened_at) + ' · ' + timeText(r.happened_at)
              },
              { label: 'Комментарий', cell: r => r.memo || '—' }
            ]}
          />
          {document.movements?.length > 0 && (
            <div className="history-movements">
              <h3>Движение запасов</h3>
              <Table label="Движение запасов" rows={document.movements} columns={movementColumns} />
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function DocumentRelationBanner({ document }) {
  if (!document) return null
  if (document.source_doc) {
    return (
      <div className="notice info doc-relation">
        Исправление к отчёту{' '}
        <a href={href('/reports/' + document.source_doc)}>
          <strong>{document.source_code || '№' + document.source_doc}</strong>
        </a>
        {document.memo ? ' · Причина: ' + document.memo : ''}
      </div>
    )
  }
  if (document.replacement_id) {
    return (
      <div className="notice warning doc-relation">
        Отчёт сторнирован (исправлен). Связанный документ:{' '}
        <a href={href('/reports/' + document.replacement_id)}>
          <strong>{document.replacement_code || '№' + document.replacement_id}</strong>
        </a>
      </div>
    )
  }
  return null
}

function ReportEditor({ document }) {
  const ws = useWorkspace()
  const toast = useToast()
  const [report, set] = useState(() => initialData(document, ws.today))
  const [tab, setTab] = useState('work')
  const [quote, setQuote] = useState(() => ({
    key: JSON.stringify(initialData(document, ws.today)),
    document
  }))
  const requestKey = JSON.stringify(report)
  const preview = quote.key === requestKey ? quote.document : null

  async function calculate(data) {
    const doc = await api('/reports/preview', 'POST', data)
    setQuote({ key: JSON.stringify(data), document: doc })
  }

  const [edit, setEdit] = useState(null)
  const [confirm, setConfirm] = useState('')
  const [reason, setReason] = useState('')
  const action = useAction()
  const previewAction = useAction()
  const correctionFormId = useId()

  const editable = !document || document.status === 'draft'
  const write = roleCanWrite(ws.user)
  const minDate = ws.settings?.open_month ? ws.settings.open_month + '-01' : undefined
  const dateBelowOpenMonth = Boolean(editable && minDate && report.date && report.date < minDate)

  const products = report.lines.map(l => ({
    ...l,
    item: ws.items.find(i => i.id === l.item_id) || { id: l.item_id, name: 'Изделие #' + l.item_id, size: '' }
  }))
  const computed = editable ? preview : document
  const assigned = products.flatMap((l, i) =>
    l.assignments.map(a => {
      const rate = computed?.lines
        ?.find(p => p.item_id === l.item_id)
        ?.assignments?.find(x => x.staff_id === a.staff_id)?.rate
      return {
        ...a,
        line: i,
        item: l.item,
        worker: ws.staff.find(w => w.id === a.staff_id),
        rate
      }
    })
  )
  const totalOutput = products.reduce((s, l) => s + l.quantity, 0)
  const totalUnassigned = products.reduce(
    (s, l) => s + Math.max(0, l.quantity - l.assignments.reduce((q, a) => q + a.quantity, 0)),
    0
  )
  const canPost = products.length > 0 && products.every(l => l.assignments.reduce((s, a) => s + a.quantity, 0) === l.quantity)
  const totalWages = assigned.reduce((s, r) => s + (r.rate || 0) * r.quantity, 0)

  function change(next, runPreview = false) {
    set(next)
    action.clear()
    previewAction.clear()
    if (runPreview && next.lines.length) {
      previewAction.run(() => calculate(next))
    }
  }

  function updateLine(index, l, runPreview = false) {
    const next = {
      ...report,
      lines: index < 0 ? [...report.lines, l] : report.lines.map((current, i) => (i === index ? l : current))
    }
    change(next, runPreview)
    setEdit(null)
  }

  function setAssignment(a, remove = false) {
    const l = report.lines[a.line]
    const id = edit?.original?.staff_id
    const assignments = l.assignments.filter(x => x.staff_id !== id && x.staff_id !== a.staff_id)
    if (!remove) assignments.push({ staff_id: a.staff_id, quantity: a.quantity })
    updateLine(a.line, { ...l, assignments }, !remove)
  }

  function selectTab(key) {
    setTab(key)
    if (key !== 'work' && editable && report.lines.length && !preview) {
      previewAction.run(() => calculate(report))
    }
  }

  function save(post) {
    action.run(async () => {
      const response = await api(
        '/reports' + (document ? '/' + document.id : '') + (post ? '?post=true' : ''),
        document ? 'PUT' : 'POST',
        report
      )
      toast.success(
        post
          ? 'Отчёт ' + response.code + ' проведён'
          : document
            ? 'Черновик отчёта сохранён'
            : 'Создан черновик отчёта ' + response.code
      )
      ws.refresh()
      if (document?.id === response.id) ws.refreshPage()
      go('/reports/' + response.id)
    })
  }

  const title = document ? 'Отчёт ' + document.code : 'Новый отчёт за смену'
  const documentMovement = document && document.status !== 'draft'
  const canCorrect = Boolean(document?.status === 'posted' && write && (!minDate || document.date >= minDate))
  const eligibleWorkers = ws.staff.filter(w => w.active && w.stage === report.stage && w.hired_on <= report.date)

  return (
    <Page
      title={title}
      subtitle={
        stages[report.stage] +
        ' · ' +
        (document ? dayText(report.date) : 'данные из журнала выработки') +
        (document ? ' · ' + (statuses[document.status] || document.status) : ' · Черновик')
      }
      actions={
        documentMovement && (
          <Button to={'/reports/' + document.id + '/movements'}>Движения документа</Button>
        )
      }
    >
      {document && (
        <Card className="kpi-grid cols-4">
          <div className="kpi-item">
            <span className="kpi-label">Статус</span>
            <div className="kpi-value">
              <Status value={document.status} />
            </div>
            <span className="kpi-meta">{shifts[document.shift] || document.shift} смена</span>
          </div>
          <div className="kpi-item">
            <span className="kpi-label">Выработка</span>
            <strong className="kpi-value">{qty(document.quantity)} компл.</strong>
            <span className="kpi-meta">{stages[document.stage]}</span>
          </div>
          <div className="kpi-item">
            <span className="kpi-label">Начислено</span>
            <strong className="kpi-value">
              {document.status === 'draft' ? '—' : money(document.wages)}
            </strong>
            <span className="kpi-meta">
              {document.status === 'draft' ? 'Фиксируется при проведении' : 'Сдельная оплата'}
            </span>
          </div>
          <div className="kpi-item">
            <span className="kpi-label">Автор</span>
            <strong className="kpi-value" style={{ fontSize: '20px', lineHeight: '32px' }}>
              {document.author}
            </strong>
            <span className="kpi-meta">{dayText(document.date)}</span>
          </div>
        </Card>
      )}

      <DocumentRelationBanner document={document} />

      <Card className="report-card">
        {editable && (
          <>
            <div className="toolbar report-fields">
              <Field label="Дата">
                <DateControl
                  required
                  disabled={!editable}
                  max={ws.today}
                  min={minDate}
                  value={report.date}
                  onChange={e => {
                    if (!e.target.value) return
                    const nextDate = e.target.value
                    const nextLines = report.lines.map(l => ({
                      ...l,
                      assignments: l.assignments.filter(a => {
                        const worker = ws.staff.find(w => w.id === a.staff_id)
                        return !worker || worker.hired_on <= nextDate
                      })
                    }))
                    change({ ...report, date: nextDate, lines: nextLines }, tab !== 'work')
                  }}
                />
              </Field>
              <Field label="Этап">
                <Select
                  disabled={!editable}
                  entries={production}
                  value={report.stage}
                  onChange={e => {
                    change(
                      {
                        ...report,
                        stage: e.target.value,
                        lines: report.lines.map(l => ({ ...l, prepared: 0, assignments: [] }))
                      },
                      tab !== 'work'
                    )
                  }}
                />
              </Field>
              <Field label="Смена">
                <Select
                  disabled={!editable}
                  entries={Object.entries(shifts)}
                  value={report.shift}
                  onChange={e => change({ ...report, shift: e.target.value })}
                />
              </Field>
            </div>
            {dateBelowOpenMonth && (
              <div className="notice warning">
                Дата отчёта раньше открытого периода ({monthText(ws.settings.open_month)}). Выберите дату начиная с{' '}
                {dayText(minDate)}.
              </div>
            )}
          </>
        )}

        <Tabs items={tabList} value={tab} onChange={selectTab} label="Содержимое отчёта" />

        {tab === 'work' && (
          <>
            <Table
              label="Выработка"
              rows={products}
              rowKey={r => r.item_id}
              empty="Добавьте хотя бы одно изделие из журнала выработки"
              columns={[
                { label: 'Изделие', width: '30%', cell: r => r.item.name },
                { label: 'Размер', width: '14%', cell: r => r.item.size || '—' },
                {
                  label: 'Количество, компл.',
                  width: '16%',
                  align: 'right',
                  cell: r => number(r.quantity)
                },
                ...(report.stage === 'pack'
                  ? [
                      {
                        label: 'Передано с пошива',
                        width: '16%',
                        align: 'right',
                        cell: r => number(r.prepared) + ' компл.'
                      }
                    ]
                  : []),
                {
                  label: 'Спецификация',
                  width: '18%',
                  align: 'after-number',
                  cell: r => {
                    const saved = computed?.lines?.find(l => l.item_id === r.item_id)
                    const v = saved?.version || r.item.version
                    return (
                      <a
                        className="neutral-link"
                        href={href('/catalog/' + r.item_id + (saved?.spec_id ? '/specs/' + saved.spec_id : ''))}
                      >
                        {v ? 'Версия ' + v : 'Спецификация'}
                      </a>
                    )
                  }
                },
                ...(editable
                  ? [
                      {
                        label: 'Действия',
                        width: '12%',
                        align: 'right',
                        cell: (r, i) => (
                          <Button kind="ghost" onClick={() => setEdit({ kind: 'line', index: i })}>
                            Изменить
                          </Button>
                        )
                      }
                    ]
                  : [])
              ]}
              footer={
                products.length > 0 ? (
                  <tr>
                    <th scope="row" colSpan={2}>Итого выработка</th>
                    <td className="right"><strong>{number(totalOutput)} компл.</strong></td>
                    {report.stage === 'pack' && (
                      <td className="right">
                        {number(products.reduce((s, l) => s + (l.prepared || 0), 0))} компл.
                      </td>
                    )}
                    <td colSpan={editable ? 2 : 1} />
                  </tr>
                ) : null
              }
            />
            {editable && (
              <div className="report-totals work-totals">
                <Button onClick={() => setEdit({ kind: 'line', index: -1 })}>Добавить изделие</Button>
              </div>
            )}
          </>
        )}

        {tab === 'materials' && (
          <>
            <ErrorBox error={previewAction.error} />
            {computed ? (
              <MaterialRows document={computed} />
            ) : (
              <EmptyState
                title={previewAction.busy ? 'Расчёт материалов…' : 'Нет выработки для расчёта'}
                description={
                  previewAction.busy
                    ? 'Проверяем нормы по действующей спецификации и остатки сырья.'
                    : 'Добавьте изделия на вкладке «Выработка», чтобы увидеть потребность в сырье.'
                }
              />
            )}
          </>
        )}

        {tab === 'wages' && (
          <>
            <ErrorBox error={previewAction.error} />
            {editable && products.length > 0 && (
              <div className="assignment-progress" aria-label="Распределение выработки по изделиям">
                {products.map((l, idx) => {
                  const allocated = l.assignments.reduce((s, a) => s + a.quantity, 0)
                  const remaining = l.quantity - allocated
                  const pct = l.quantity > 0 ? Math.min(100, Math.round((allocated / l.quantity) * 100)) : 0
                  const fillState = remaining === 0 ? 'is-complete' : remaining < 0 ? 'is-over' : 'is-warning'
                  return (
                    <div className="assignment-progress-row" key={l.item_id}>
                      <div>
                        <strong>{itemText(l.item)}</strong>
                        <span className="cell-secondary">
                          распределено {number(allocated)} из {number(l.quantity)} компл.
                        </span>
                      </div>
                      <div className="progress-track" aria-hidden="true">
                        <div className={'progress-fill ' + fillState} style={{ width: pct + '%' }} />
                      </div>
                      <div className="actions">
                        {remaining === 0 ? (
                          <span className="positive">Распределено полностью</span>
                        ) : remaining > 0 ? (
                          <>
                            <span className="negative">Остаток: {number(remaining)} компл.</span>
                            <Button
                              size="small"
                              disabled={!eligibleWorkers.length}
                              onClick={() => setEdit({ kind: 'assignment', lineIndex: idx })}
                            >
                              Назначить остаток ({number(remaining)})
                            </Button>
                          </>
                        ) : (
                          <span className="negative">Превышение на {number(-remaining)} компл.</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <Table
              label="Технологическая карта"
              rows={assigned}
              rowKey={r => r.line + '-' + r.staff_id}
              empty={
                products.length
                  ? 'Исполнители ещё не назначены'
                  : 'Сначала добавьте изделия на вкладке «Выработка»'
              }
              columns={[
                {
                  label: 'Исполнитель',
                  cell: r =>
                    r.worker ? (
                      <a href={href('/people/' + r.staff_id)}>{r.worker.name}</a>
                    ) : (
                      '—'
                    )
                },
                { label: 'Изделие', cell: r => itemText(r.item) },
                { label: 'Комплектов', align: 'right', cell: r => number(r.quantity) },
                {
                  label: 'Расценка',
                  align: 'right',
                  cell: r => (r.rate !== undefined ? money(r.rate) : '—')
                },
                {
                  label: 'Начислено',
                  align: 'right',
                  cell: r => (r.rate !== undefined ? money(r.rate * r.quantity) : '—')
                },
                ...(editable
                  ? [
                      {
                        label: 'Действия',
                        align: 'right',
                        cell: r => (
                          <Button kind="ghost" onClick={() => setEdit({ kind: 'assignment', original: r })}>
                            Изменить
                          </Button>
                        )
                      }
                    ]
                  : [])
              ]}
              footer={
                assigned.length > 0 ? (
                  <tr>
                    <th scope="row" colSpan={2}>Итого по технологической карте</th>
                    <td className="right">
                      <strong>{number(assigned.reduce((s, r) => s + r.quantity, 0))}</strong>
                    </td>
                    <td />
                    <td className="right"><strong>{money(totalWages)}</strong></td>
                    {editable && <td />}
                  </tr>
                ) : null
              }
            />
            {editable && (
              <div className="report-totals">
                <Button
                  disabled={!products.length || totalUnassigned === 0 || !eligibleWorkers.length}
                  onClick={() => setEdit({ kind: 'assignment' })}
                >
                  Назначить исполнителя
                </Button>
                {totalUnassigned > 0 && (
                  <span className="muted">
                    Нераспределённый остаток: <strong>{number(totalUnassigned)} компл.</strong>
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {editable && (
          <details className="report-note" open={Boolean(report.memo)}>
            <summary>
              <svg
                className="report-note-chevron"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m4 6 4 4 4-4" />
              </svg>
              <span>Комментарий</span>
            </summary>
            <Field label="Комментарий к отчёту" wide>
              <textarea
                value={report.memo}
                maxLength={500}
                rows={2}
                placeholder="Заметки смены или пояснение к отчёту"
                onChange={e => change({ ...report, memo: e.target.value })}
              />
            </Field>
          </details>
        )}
        {!editable && document?.memo && !document?.source_doc && (
          <p className="inline-note">{document.memo}</p>
        )}

        <ErrorBox error={action.error} />

        <ActionRow>
          <Button className="push-left" to="/reports">
            {editable ? 'Отмена' : 'Назад'}
          </Button>
          {editable && (
            <>
              <Button disabled={!report.lines.length || action.busy || dateBelowOpenMonth} onClick={() => save(false)}>
                Сохранить черновик
              </Button>
              <Button
                kind="primary"
                disabled={!report.lines.length || action.busy || dateBelowOpenMonth}
                onClick={() => {
                  if (canPost) {
                    setConfirm('post')
                  } else {
                    selectTab('wages')
                    toast.info('Распределите весь выпуск по исполнителям перед проведением.')
                  }
                }}
              >
                Провести отчёт
              </Button>
            </>
          )}
          {canCorrect && (
            <Button onClick={() => setConfirm('correct')}>Исправить отчёт</Button>
          )}
          {document?.status === 'posted' && write && minDate && document.date < minDate && (
            <span className="muted">Период закрыт для исправления</span>
          )}
        </ActionRow>
      </Card>

      {document && <DocumentHistory document={{ ...document, movements: [] }} defaultOpen={document.status !== 'draft'} />}

      {edit?.kind === 'line' && (
        <EditWorkLine
          original={report.lines[edit.index]}
          stage={report.stage}
          items={ws.items}
          used={report.lines.filter((_, i) => i !== edit.index).map(l => l.item_id)}
          close={() => setEdit(null)}
          save={l => updateLine(edit.index, l, tab !== 'work')}
          remove={
            edit.index >= 0
              ? () => {
                  change({ ...report, lines: report.lines.filter((_, i) => i !== edit.index) }, tab !== 'work')
                  setEdit(null)
                }
              : undefined
          }
        />
      )}

      {edit?.kind === 'assignment' && (
        <EditAssignment
          original={edit.original}
          initialLine={edit.lineIndex ?? 0}
          lines={products}
          workers={eligibleWorkers}
          close={() => setEdit(null)}
          save={a => setAssignment(a)}
          remove={edit.original ? () => setAssignment(edit.original, true) : undefined}
        />
      )}

      {confirm === 'post' && (
        <Confirm
          title="Провести отчёт?"
          text="Система спишет рассчитанные материалы, отразит выпуск на складе и начислит сдельную зарплату."
          close={() => setConfirm('')}
          submit="Провести отчёт"
          action={async () => {
            setConfirm('')
            save(true)
          }}
        />
      )}

      {confirm === 'correct' && (
        <Dialog
          title="Исправить отчёт"
          closeDisabled={action.busy}
          close={() => {
            setConfirm('')
            action.clear()
          }}
          footer={
            <FormActions
              form={correctionFormId}
              busy={action.busy}
              cancel={() => {
                setConfirm('')
                action.clear()
              }}
              submit="Создать исправление"
            />
          }
        >
          <form
            id={correctionFormId}
            onSubmit={e => {
              e.preventDefault()
              action.run(async () => {
                const result = await api('/reports/' + document.id + '/correct', 'POST', { reason })
                toast.success('Создан черновик исправления ' + result.code)
                ws.refresh()
                go('/reports/' + result.id)
              })
            }}
          >
            <p className="modal-description">
              Складские движения и начисления будут сторнированы. Создастся черновик исправления.
            </p>
            <Field label="Причина">
              <textarea
                required
                maxLength={180}
                rows={3}
                placeholder="Укажите причину корректировки отчёта"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </Field>
            <ErrorBox error={action.error} />
          </form>
        </Dialog>
      )}
    </Page>
  )
}

export function ReportDetail({ id }) {
  const request = useRemote(id ? '/document/' + id : null)
  if (!id) return <ReportEditor key="new" />
  return (
    <Guard request={request}>
      {r =>
        r.kind === 'report' ? (
          <ReportEditor key={r.id + '-' + r.status + '-' + r.updated_at} document={r} />
        ) : (
          <ErrorBox error="Отчёт не найден" />
        )
      }
    </Guard>
  )
}

export function ReportMovements({ id }) {
  const request = useRemote('/document/' + id)
  return (
    <Guard request={request}>
      {d => {
        if (d.kind !== 'report' || d.status === 'draft') {
          return <ErrorBox error="По этому документу ещё нет движений." />
        }
        const assignmentRows = d.lines.flatMap(l =>
          l.assignments.map(a => ({
            ...a,
            item_name: itemText(l),
            id: l.id + '-' + a.staff_id
          }))
        )
        return (
          <Page
            title={'Движения отчёта ' + d.code}
            subtitle={stages[d.stage] + ' · ' + dayText(d.date) + ' · ' + (statuses[d.status] || d.status)}
            actions={<Button to={'/reports/' + d.id}>К отчёту</Button>}
          >
            <DocumentRelationBanner document={d} />
            <Card title="Материалы и выпуск">
              <Table
                label="Материалы и выпуск"
                rows={d.movements}
                empty="Движений по этому документу нет"
                columns={[
                  {
                    label: 'Склад',
                    cell: r => <a href={href('/stock/' + r.warehouse_id)}>{r.warehouse}</a>
                  },
                  {
                    label: 'Позиция',
                    cell: r =>
                      r.warehouse_id === 1 ? (
                        <a href={href('/stock/1/items/' + r.item_id)}>{r.name}</a>
                      ) : (
                        <a href={href('/catalog/' + r.item_id)}>{itemText(r)}</a>
                      )
                  },
                  {
                    label: 'Приход',
                    align: 'right',
                    cell: r =>
                      r.quantity > 0 ? (
                        <span className="positive">+{qty(r.quantity) + ' ' + r.unit}</span>
                      ) : (
                        '—'
                      )
                  },
                  {
                    label: 'Расход',
                    align: 'right',
                    cell: r =>
                      r.quantity < 0 ? (
                        <span className="negative">−{qty(-r.quantity) + ' ' + r.unit}</span>
                      ) : (
                        '—'
                      )
                  },
                  {
                    label: 'Остаток',
                    align: 'right',
                    cell: r => qty(r.balance_after) + ' ' + r.unit
                  }
                ]}
              />
              <p className="muted">Остаток указан сразу после проведения соответствующей операции.</p>
            </Card>
            <Card title="Сдельная зарплата">
              <Table
                label="Сдельная зарплата по отчёту"
                rows={assignmentRows}
                empty="Начислений по отчёту нет"
                columns={[
                  {
                    label: 'Исполнитель',
                    cell: r => <a href={href('/people/' + r.staff_id)}>{r.name}</a>
                  },
                  { label: 'Изделие', cell: r => r.item_name },
                  { label: 'Операция', cell: () => stages[d.stage] },
                  { label: 'Комплектов', align: 'right', cell: r => qty(r.quantity) },
                  { label: 'Расценка', align: 'right', cell: r => money(r.rate) },
                  {
                    label: 'Начислено',
                    align: 'right',
                    cell: r => money(Math.round((r.quantity * r.rate) / 1000))
                  }
                ]}
                footer={
                  assignmentRows.length > 0 ? (
                    <tr>
                      <th scope="row" colSpan={3}>Итого начислено</th>
                      <td className="right">
                        <strong>{qty(assignmentRows.reduce((s, r) => s + r.quantity, 0))}</strong>
                      </td>
                      <td />
                      <td className="right"><strong>{money(d.wages)}</strong></td>
                    </tr>
                  ) : null
                }
              />
            </Card>
            <DocumentHistory document={{ ...d, movements: [] }} defaultOpen />
          </Page>
        )
      }}
    </Guard>
  )
}
