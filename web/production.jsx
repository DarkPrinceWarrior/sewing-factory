import React, { useId, useState } from 'react'
import {
  ActionRow, Button, Card, Confirm, DataCard, DateControl, DateRange, Dialog, Download, EmptyState,
  ErrorBox, Field, FormActions, Guard, MetricStrip, Page, Pager, RegistryTools, Section, Select,
  Status, Stepper, SummaryCard, Table, Tabs, api, dayText, duration, go, href, itemText, money,
  monthText, number, qty, roleCanWrite, routeWith, shifts, stages, statuses, timeText, useAction,
  useFilters, useRemote, useSearchOptions, useToast, useWorkspace
} from './ui'
import { SearchPicker } from './pickers'

const production = Object.entries(stages).slice(0, 3)
const finishedLabels = { cut: 'Раскроено', sew: 'Пошито', pack: 'Упаковано' }
const wipLabels = { cut: 'Крой', sew: 'Пошив', pack: 'Упаковка' }
const hourlyWorkLabels = { loader: 'Грузчик' }
const hourlyPresets = [
  [30, '30 мин'],
  [60, '1 ч'],
  [90, '1,5 ч'],
  [120, '2 ч'],
  [180, '3 ч'],
  [240, '4 ч']
]
const tabList = [
  ['work', 'Выработка'],
  ['materials', 'Материалы'],
  ['wages', 'Оплата смены']
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
const warehouseLabel = (name, city) => [name, city].filter(Boolean).join(' · ')
const calcHourlyAmount = (minutes, rate) => Math.round((Number(minutes || 0) * Number(rate || 0)) / 60)

function defaultSpecForDate(itemSpecs, day) {
  if (!itemSpecs?.length) return null
  const ordered = [...itemSpecs].sort((a, b) => (b.version || 0) - (a.version || 0))
  return ordered.find(s => !day || !s.effective || s.effective <= day) || ordered[0]
}

function specOptionLabel(spec) {
  if (!spec) return 'Спецификация'
  const raw = (spec.name || '').trim()
  const base = raw || (spec.version ? 'Спецификация ' + spec.version : 'Спецификация')
  const details = []
  if (spec.version && base !== 'Спецификация ' + spec.version && base !== 'Версия ' + spec.version) {
    details.push('версия ' + spec.version)
  }
  if (spec.effective) {
    details.push('с ' + dayText(spec.effective))
  }
  return details.length ? base + ' (' + details.join(', ') + ')' : base
}

function shiftDay(iso, delta) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

function shiftReportColumns(overview = false) {
  const columns = [
    {
      label: overview ? 'Документ' : 'Документ / дата',
      width: overview ? '24%' : '23%',
      primary: true,
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
      cell: r => {
        const hasQty = (r.quantity || 0) > 0
        const hasHourly = (r.hourly_minutes || 0) > 0
        if (!hasQty && hasHourly) {
          return (
            <>
              <span className="nowrap">{duration(r.hourly_minutes)}</span>
              <span className="cell-secondary nowrap">Грузчик</span>
            </>
          )
        }
        return (
          <>
            <span className="nowrap">{qty(r.quantity) + ' компл.'}</span>
            {hasHourly && (
              <span className="cell-secondary nowrap">+{duration(r.hourly_minutes)} грузчик</span>
            )}
          </>
        )
      }
    },
    {
      label: 'Начислено',
      width: overview ? '22%' : '16%',
      align: 'right',
      mobileAccent: true,
      mobileFull: overview,
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
    mobileKind: 'status',
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
  const draftStages = data.draft_stages || []
  const postedReports = data.reports || []
  const draftReports = data.day_drafts || []
  const rows = production.map(([key]) => {
    const found = data.stages.find(row => row.stage === key)
    const draft = draftStages.find(row => row.stage === key)
    return [key, found?.quantity || 0, found?.documents || 0, draft?.quantity || 0, draft?.documents || 0]
  })
  const totalOutput = sum(data.stages, 'quantity')
  const totalDocs = Math.max(sum(data.stages, 'documents'), postedReports.length)
  const totalDraftOutput = sum(draftStages, 'quantity')
  const totalDraftDocs = Math.max(sum(draftStages, 'documents'), draftReports.length)
  const totalHourlyMinutes = sum(postedReports, 'hourly_minutes')
  const max = Math.max(1, ...rows.map(([, n]) => n))

  return (
    <Card className="output-card">
      <div className="output-chart">
        <div className="chart-title">
          <h2>Выработка за смену</h2>
          <span>
            {totalOutput > 0
              ? 'Итого: ' + qty(totalOutput) + ' компл.'
              : totalHourlyMinutes > 0
                ? 'Грузчик: ' + duration(totalHourlyMinutes)
                : totalDraftOutput > 0
                  ? 'В черновиках: ' + qty(totalDraftOutput) + ' компл.'
                  : 'Выработка ещё не проведена'}
          </span>
        </div>
        {rows.map(([key, n, docs, draftN, draftDocs]) => (
          <div className="bar-row" key={key}>
            <span>{finishedLabels[key]}</span>
            <a
              className="bar-track"
              href={href(
                routeWith('/reports', {
                  start: data.day,
                  end: data.day,
                  stage: key,
                  ...(n > 0 || !draftN ? { status: 'posted' } : { status: 'draft' })
                })
              )}
              title={
                stages[key] +
                ': ' +
                qty(n) +
                ' компл. (проведено: ' +
                number(docs) +
                (draftDocs ? ', в черновиках: ' + qty(draftN) + ' компл.' : '') +
                ')'
              }
              aria-label={stages[key] + ': открыть отчёты за ' + dayText(data.day)}
            >
              <div
                className={'bar-fill ' + key}
                style={{ width: (n > 0 ? Math.max(3, (n / max) * 100) : 0) + '%' }}
              />
            </a>
            <strong className="nowrap">
              {qty(n)} компл.
              {draftN > 0 && (
                <span className="cell-secondary">+{qty(draftN)} в черновиках</span>
              )}
            </strong>
          </div>
        ))}
      </div>
      <div className="output-wages">
        <span>Начислено за смену</span>
        <strong>{money(data.wages)}</strong>
        <small>
          {totalDocs > 0
            ? 'Проведённых отчётов: ' +
              number(totalDocs) +
              (totalHourlyMinutes > 0 ? ' · грузчик ' + duration(totalHourlyMinutes) : '') +
              (totalDraftDocs ? ' · черновиков: ' + number(totalDraftDocs) : '')
            : totalDraftDocs > 0
              ? 'Черновиков за день: ' + number(totalDraftDocs) + ' (ещё не проведены)'
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
  const { today, settings } = useWorkspace()
  const overview = useFilters('overview', { day: today })
  const day = overview.filters.day
  const request = useRemote('/overview', { day })
  const minDate = settings?.open_month ? settings.open_month + '-01' : ''
  const newReportTarget =
    day && day !== today && (!minDate || day >= minDate) && day <= today
      ? routeWith('/reports/new', { date: day })
      : '/reports/new'

  return (
    <Page
      title="Обзор производства"
      subtitle="Фактические результаты смены"
      actions={<Button kind="primary" to={newReportTarget}>Новый отчёт за смену</Button>}
    >
      <div className="overview-date-bar">
        <span className="day-stepper" role="group" aria-label="Выбор даты обзора">
          <button
            type="button"
            className="day-stepper-btn"
            aria-label="Предыдущий день"
            onClick={() => overview.change('day', shiftDay(day, -1) || today)}
          >
            ‹
          </button>
          <DateControl
            inline
            required
            aria-label="Дата обзора"
            max={today}
            value={day}
            onChange={e => overview.change('day', e.target.value || today)}
          />
          <button
            type="button"
            className="day-stepper-btn"
            aria-label="Следующий день"
            disabled={day >= today}
            onClick={() => {
              const next = shiftDay(day, 1)
              if (next && next <= today) overview.change('day', next)
            }}
          >
            ›
          </button>
        </span>
      </div>
      <Guard request={request} skeleton="overview">
        {data => {
          const dayReports = data.day_reports ?? data.reports ?? []
          const dayDrafts = data.day_drafts ?? dayReports.filter(r => r.status === 'draft')
          const dayDraftQty = sum(dayDrafts, 'quantity')
          const dayDraftHourly = sum(dayDrafts, 'hourly_minutes')
          const draftParts = [
            number(dayDrafts.length) + ' шт.',
            dayDraftQty > 0 ? qty(dayDraftQty) + ' компл.' : '',
            dayDraftHourly > 0 ? 'грузчик ' + duration(dayDraftHourly) : ''
          ].filter(Boolean)
          return (
            <>
              <OutputChart data={data} />
              {dayDrafts.length > 0 && (
                <div className="notice warning version-banner">
                  <div>
                    <strong>
                      За {dayText(day)} есть непроведённые черновики ({draftParts.join(', ')}).
                    </strong>{' '}
                    В выработке и начислениях смены учитываются только проведённые отчёты.
                  </div>
                  <Button
                    size="small"
                    to={
                      dayDrafts.length === 1
                        ? '/reports/' + dayDrafts[0].id
                        : routeWith('/reports', { start: day, end: day, status: 'draft' })
                    }
                  >
                    {dayDrafts.length === 1 ? 'Открыть и провести' : 'Открыть черновики'}
                  </Button>
                </div>
              )}
              <Section
                title="Отчёты за смену"
                subtitle={
                  dayReports.length > 0
                    ? 'Всего за ' + dayText(day) + ': ' + number(dayReports.length) +
                      (dayDrafts.length > 0 ? ' (в том числе черновиков: ' + number(dayDrafts.length) + ')' : '')
                    : undefined
                }
                actions={
                  <Button kind="ghost" size="small" to={routeWith('/reports', { start: day, end: day })}>
                    Все за день
                  </Button>
                }
              >
                <Table
                  columns={shiftReportColumns(true)}
                  rows={dayReports}
                  rowHref={r => '/reports/' + r.id}
                  label="Отчёты за смену"
                  empty="За выбранную дату отчётов нет"
                />
              </Section>
              <div className="grid-two overview-bottom">
                <Section
                  title={'Незавершённое производство · ' + qty(sum(data.wip, 'quantity')) + ' компл.'}
                  subtitle={'Остаток на ' + dayText(day)}
                  actions={<Button kind="ghost" size="small" to="/stock">Открыть склады</Button>}
                >
                  <div className="surface-panel">
                    <Wip rows={data.wip} links showStack />
                  </div>
                </Section>
                <Section
                  title="Требует внимания"
                  actions={
                    data.pending.total > 0 ? (
                      <Button kind="ghost" size="small" to={routeWith('/reports', { status: 'draft' })}>
                        Все черновики
                      </Button>
                    ) : null
                  }
                >
                  <div className="surface-panel">
                    {data.pending.total ? (
                      <>
                        <strong>Черновиков отчётов: {number(data.pending.total)}</strong>
                        <ul className="attention">
                          {data.pending.rows.map(r => (
                            <li key={r.id}>
                              <a href={href('/reports/' + r.id)}>
                                {stages[r.stage]} · {r.code}
                              </a>{' '}
                              <span className="muted">
                                ({dayText(r.date)}
                                {r.quantity ? ' · ' + qty(r.quantity) + ' компл.' : ''}
                                {r.hourly_minutes ? ' · грузчик ' + duration(r.hourly_minutes) : ''})
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="muted">Все отчёты проведены — черновиков нет.</p>
                    )}
                  </div>
                </Section>
              </div>
            </>
          )
        }}
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
              rowHref={r => '/reports/' + r.id}
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
    </Page>
  )
}

function queryInitialDate(today, minDate) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const value = params.get('date') || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return today
  const parsed = new Date(value + 'T00:00:00Z')
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return today
  if (value > today) return today
  if (minDate && value < minDate) return today
  return value
}

function initialData(document, today, minDate) {
  if (!document) {
    return {
      date: queryInitialDate(today, minDate),
      stage: 'cut',
      shift: 'day',
      source_id: 1,
      memo: '',
      lines: [],
      hourly_works: []
    }
  }
  return {
    date: document.date,
    stage: document.stage,
    shift: document.shift,
    source_id: document.source_id || 1,
    memo: document.memo || '',
    lines: document.lines.map(l => ({
      item_id: l.item_id,
      spec_id: l.spec_id || null,
      quantity: l.quantity / 1000,
      prepared: l.prepared / 1000,
      assignments: l.assignments.map(a => ({ staff_id: a.staff_id, quantity: a.quantity / 1000 }))
    })),
    hourly_works: (document.hourly_works || []).map(h => ({
      staff_id: h.staff_id,
      minutes: h.minutes,
      work_type: h.work_type || 'loader'
    }))
  }
}

function EditWorkLine({ original, stage, reportDate, used, items, specs = [], close, save, remove }) {
  const formId = useId()
  const [data, set] = useState(() => {
    if (original) {
      const itemSpecs = specs.filter(s => s.product_id === original.item_id)
      const fallback = defaultSpecForDate(itemSpecs, reportDate)
      return {
        ...original,
        spec_id: original.spec_id || fallback?.id || null
      }
    }
    return { item_id: '', spec_id: null, quantity: 1, prepared: 0, assignments: [] }
  })
  const [error, setError] = useState('')
  const change = (k, v) => {
    setError('')
    set(d => ({ ...d, [k]: v }))
  }
  const productEntries = items
    .filter(i => i.kind === 'product' && !used.includes(i.id))
    .map(i => [i.id, itemText(i), false, [i.sku, i.category].filter(Boolean).join(' · ')])

  const itemSpecs = data.item_id
    ? specs
        .filter(s => s.product_id === Number(data.item_id))
        .sort((a, b) => (b.version || 0) - (a.version || 0))
    : []
  const activeSpecId =
    data.spec_id && itemSpecs.some(s => s.id === Number(data.spec_id))
      ? Number(data.spec_id)
      : defaultSpecForDate(itemSpecs, reportDate)?.id || null

  function selectProduct(nextId) {
    const id = nextId ? Number(nextId) : ''
    const nextSpecs = id ? specs.filter(s => s.product_id === id) : []
    const def = defaultSpecForDate(nextSpecs, reportDate)
    setError('')
    set(d => ({ ...d, item_id: id, spec_id: def?.id || null }))
  }

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
    save({ ...data, spec_id: activeSpecId, quantity, prepared })
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
              placeholder="Название, размер или артикул"
              entries={productEntries}
              value={data.item_id}
              onChange={e => selectProduct(e.target.value)}
            />
          </Field>
          {itemSpecs.length > 0 && (
            <Field
              label="Спецификация"
              wide
              help={
                itemSpecs.length > 1
                  ? 'По умолчанию выбрана действующая на дату отчёта. При необходимости выберите другую версию.'
                  : 'Для этого изделия действует одна спецификация.'
              }
            >
              <Select
                value={activeSpecId ? String(activeSpecId) : ''}
                entries={itemSpecs.map(s => [String(s.id), specOptionLabel(s)])}
                onChange={e => change('spec_id', e.target.value ? Number(e.target.value) : null)}
              />
            </Field>
          )}
          <Field label="Количество, компл.">
            <Stepper
              required
              min={1}
              step={1}
              max={100000}
              value={data.quantity}
              onChange={v => change('quantity', v)}
            />
          </Field>
          {stage === 'pack' && (
            <Field
              label="Передано с пошива, компл."
              help="Сколько комплектов поступило на участок упаковки в эту смену."
            >
              <Stepper
                required
                min={0}
                step={1}
                max={100000}
                value={data.prepared}
                onChange={v => change('prepared', v)}
              />
            </Field>
          )}
        </div>
        <ErrorBox error={error} />
      </form>
    </Dialog>
  )
}

function EditHourlyWork({ original, workers, usedStaffIds, loaderRate, close, save, remove }) {
  const formId = useId()
  const [staffId, setStaffId] = useState(original?.staff_id || '')
  const [hours, setHours] = useState(() => (original ? String(Math.floor(original.minutes / 60)) : '1'))
  const [mins, setMins] = useState(() => (original ? String(original.minutes % 60) : '0'))
  const [error, setError] = useState('')

  const availableWorkers = workers.filter(
    w => !usedStaffIds.includes(w.id) || (original && w.id === original.staff_id)
  )
  const hNum = hours === '' ? 0 : Number(hours)
  const mNum = mins === '' ? 0 : Number(mins)
  const validParts =
    Number.isInteger(hNum) && hNum >= 0 && hNum <= 24 &&
    Number.isInteger(mNum) && mNum >= 0 && mNum <= 59
  const totalMinutes = validParts ? hNum * 60 + mNum : 0
  const validTotal = validParts && totalMinutes >= 1 && totalMinutes <= 1440
  const previewAmount = validTotal ? calcHourlyAmount(totalMinutes, loaderRate) : 0

  function pickPreset(minutes) {
    setError('')
    setHours(String(Math.floor(minutes / 60)))
    setMins(String(minutes % 60))
  }

  function submit(e) {
    e.preventDefault()
    if (!staffId) {
      setError('Выберите сотрудника из списка.')
      return
    }
    if (!validTotal) {
      setError('Укажите время работы от 1 минуты до 24 часов (минуты — от 0 до 59).')
      return
    }
    save({ staff_id: Number(staffId), minutes: totalMinutes, work_type: 'loader' })
  }

  return (
    <Dialog
      title={original ? 'Изменить работу грузчиком' : 'Работа грузчиком (почасовая)'}
      close={close}
      footer={
        <>
          {remove && (
            <Button className="push-left" kind="quiet-danger" onClick={remove}>
              Убрать запись
            </Button>
          )}
          <Button onClick={close}>Отмена</Button>
          <Button type="submit" form={formId} kind="primary" disabled={!availableWorkers.length}>
            Сохранить
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <div className="form-grid">
          <Field
            label="Сотрудник"
            wide
            help={
              !availableWorkers.length
                ? 'Все действующие сотрудники уже добавлены в почасовую работу этого отчёта.'
                : 'Можно выбрать любого действующего сотрудника вне зависимости от основного этапа.'
            }
          >
            <SearchPicker
              required
              disabled={!availableWorkers.length}
              placeholder="Имя, должность или этап"
              value={staffId}
              entries={availableWorkers.map(w => [
                w.id,
                w.name,
                false,
                [w.position, stages[w.stage]].filter(Boolean).join(' · ')
              ])}
              onChange={e => {
                setError('')
                setStaffId(e.target.value ? Number(e.target.value) : '')
              }}
            />
          </Field>

          <Field label="Быстрый выбор времени" wide>
            <div className="duration-presets" role="group" aria-label="Быстрый выбор длительности">
              {hourlyPresets.map(([presetMin, label]) => (
                <button
                  key={presetMin}
                  type="button"
                  className={'preset-chip' + (validTotal && totalMinutes === presetMin ? ' is-active' : '')}
                  aria-pressed={validTotal && totalMinutes === presetMin}
                  onClick={() => pickPreset(presetMin)}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <div className="wide duration-inputs">
            <Field label="Часы">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={24}
                step={1}
                value={hours}
                onChange={e => {
                  setError('')
                  setHours(e.target.value)
                }}
              />
            </Field>
            <Field label="Минуты">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                step={1}
                value={mins}
                onChange={e => {
                  setError('')
                  setMins(e.target.value)
                }}
              />
            </Field>
          </div>
        </div>

        <div className="hourly-summary">
          <span>
            Начисление
            {validTotal
              ? ' (' + duration(totalMinutes) + ' × ' + money(loaderRate) + '/ч)'
              : ' (ставка ' + money(loaderRate) + '/ч)'}
          </span>
          <strong>{validTotal ? money(previewAmount) : '—'}</strong>
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
            <Stepper
              required
              min={1}
              step={1}
              max={Math.max(1, remaining)}
              disabled={!remaining}
              value={data.quantity}
              onChange={v => change('quantity', v)}
            />
          </Field>
        </div>
        <ErrorBox error={error} />
      </form>
    </Dialog>
  )
}

function MaterialRows({ document, sourceId = 1, sourceLabel = 'Склад сырья · Иваново' }) {
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
  const materialHref = itemId => (sourceId === 1 ? '/stock/1/items/' + itemId : '/stock/' + sourceId)

  const columns = [
    {
      label: 'Материал',
      primary: true,
      cell: r => <a href={href(materialHref(r.item_id))}>{r.name}</a>
    },
    { label: 'Изделие', mobileFull: !isDraft, cell: r => r.product },
    { label: 'Норма на комплект', align: 'right', cell: r => qty(r.norm) + ' ' + r.unit },
    { label: 'Комплектов', align: 'right', cell: r => qty(r.count) },
    { label: 'К списанию', align: 'right', mobileAccent: true, cell: r => qty(r.quantity) + ' ' + r.unit }
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
      <div className="inline-note info">
        Склад списания сырья:{' '}
        <a href={href('/stock/' + sourceId)}>
          <strong>{sourceLabel}</strong>
        </a>
      </div>
      <Table
        label="Списание материалов"
        rows={rows}
        rowKey={r => r.key}
        rowHref={r => materialHref(r.item_id)}
        empty="По спецификации для выбранного этапа списание материалов не требуется"
        columns={columns}
      />
      {summaryRows.length > 0 && (
        <div className={shortages.length > 0 ? 'notice warning' : 'inline-note'}>
          {shortages.length > 0 && (
            <p className="shortage-heading">
              <strong>Недостаточно сырья на складе «{sourceLabel}» для проведения отчёта:</strong>
            </p>
          )}
          {summaryRows.map(r => {
            const endDot = String(r.unit || '').endsWith('.') ? '' : '.'
            return (
              <div key={r.item_id}>
                <strong>
                  <a href={href(materialHref(r.item_id))}>{r.name}</a>: {qty(r.quantity)} {r.unit}{endDot}
                </strong>
                {isDraft && (
                  <span className={r.available < r.quantity ? ' negative' : ''}>
                    {r.available >= r.quantity
                      ? ' На складе «' + sourceLabel + '» останется ' + qty(r.available - r.quantity)
                      : ' На складе «' + sourceLabel + '» ' + qty(r.available) + ', не хватает ' + qty(r.quantity - r.available)}{' '}
                    {r.unit}{endDot}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export function DocumentHistory({ document, hideCost, defaultOpen = false }) {
  const ws = useWorkspace()
  const maskCost = hideCost ?? (ws?.user?.role === 'regional')
  const [open, setOpen] = useState(defaultOpen)
  const eventRows = document.events || []
  const movementRows = document.movements || []
  const movementColumns = [
    {
      label: 'Операция',
      primary: true,
      cell: r => operations[r.operation] || r.operation
    },
    { label: 'Склад', cell: r => r.warehouse },
    { label: 'Товар', cell: itemText },
    {
      label: 'Количество',
      align: 'right',
      mobileAccent: maskCost,
      cell: r => qty(r.quantity) + ' ' + r.unit
    }
  ]
  if (!maskCost) {
    movementColumns.push({
      label: 'Стоимость',
      align: 'right',
      mobileAccent: true,
      cell: r => money(r.value)
    })
  }

  return (
    <section className="section">
      <div className="doc-history-head">
        <h2>
          История документа
          {eventRows.length > 0 && <span className="muted"> · {number(eventRows.length)}</span>}
        </h2>
        <Button kind="ghost" size="small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Свернуть' : 'Развернуть'}
        </Button>
      </div>
      {open && (
        <div className="doc-history-list">
          <Table
            label="История изменений"
            rows={eventRows}
            empty="Событий пока нет"
            columns={[
              { label: 'Действие', primary: true, cell: r => events[r.action] || r.action },
              { label: 'Сотрудник', cell: r => r.actor },
              {
                label: 'Дата и время',
                className: 'nowrap',
                cell: r => dayText(r.happened_at) + ' · ' + timeText(r.happened_at)
              },
              { label: 'Комментарий', mobileFull: true, cell: r => r.memo || '—' }
            ]}
          />
          {movementRows.length > 0 && (
            <Section title="Движение запасов">
              <Table label="Движение запасов" rows={movementRows} columns={movementColumns} />
            </Section>
          )}
        </div>
      )}
    </section>
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
  const minDate = ws.settings?.open_month ? ws.settings.open_month + '-01' : undefined
  const loaderRate = Number(ws.settings?.loader_rate) || 6000
  const [report, set] = useState(() => initialData(document, ws.today, minDate))
  const [tab, setTab] = useState(() =>
    document && !document.lines?.length && document.hourly_works?.length ? 'wages' : 'work'
  )
  const [quote, setQuote] = useState(() => ({
    key: JSON.stringify(initialData(document, ws.today, minDate)),
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
  const dateBelowOpenMonth = Boolean(editable && minDate && report.date && report.date < minDate)

  const sourceWarehouses = (ws.warehouses || []).filter(
    w => ws.user?.role !== 'master' || w.kind !== 'regional'
  )
  const allSpecs = ws.specs || []
  const specsById = new Map(allSpecs.map(s => [s.id, s]))
  const specsByProduct = new Map()
  for (const s of allSpecs) {
    if (!specsByProduct.has(s.product_id)) specsByProduct.set(s.product_id, [])
    specsByProduct.get(s.product_id).push(s)
  }

  const products = report.lines.map(l => ({
    ...l,
    item: ws.items.find(i => i.id === l.item_id) || { id: l.item_id, name: 'Изделие #' + l.item_id, size: '' }
  }))
  const computed = editable ? preview : document
  const activeSourceId = computed?.source_id || document?.source_id || report.source_id || 1
  const matchedWarehouse = (ws.warehouses || []).find(w => w.id === activeSourceId)
  const activeSourceLabel = computed?.source_name
    ? warehouseLabel(computed.source_name, computed.source_city)
    : document?.source_name
      ? warehouseLabel(document.source_name, document.source_city)
      : matchedWarehouse
        ? warehouseLabel(matchedWarehouse.name, matchedWarehouse.city)
        : 'Склад сырья · Иваново'

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
  const hourlyRows = report.hourly_works.map(h => {
    const saved = computed?.hourly_works?.find(
      x => x.staff_id === h.staff_id && (x.work_type || 'loader') === (h.work_type || 'loader')
    )
    const worker = ws.staff.find(w => w.id === h.staff_id)
    const rate = saved?.hourly_rate ?? loaderRate
    const amount = saved?.amount ?? calcHourlyAmount(h.minutes, rate)
    return {
      ...h,
      work_type: h.work_type || 'loader',
      name: saved?.name || worker?.name || 'Сотрудник #' + h.staff_id,
      position: saved?.position || worker?.position || '',
      stage: saved?.stage || worker?.stage || '',
      hourly_rate: rate,
      amount
    }
  })

  const totalOutput = products.reduce((s, l) => s + l.quantity, 0)
  const totalUnassigned = products.reduce(
    (s, l) => s + Math.max(0, l.quantity - l.assignments.reduce((q, a) => q + a.quantity, 0)),
    0
  )
  const hasContent = products.length > 0 || hourlyRows.length > 0
  const canPost =
    hasContent && products.every(l => l.assignments.reduce((s, a) => s + a.quantity, 0) === l.quantity)
  const totalPieceWages = assigned.reduce((s, r) => s + (r.rate || 0) * r.quantity, 0)
  const totalHourlyMinutes = hourlyRows.reduce((s, r) => s + (r.minutes || 0), 0)
  const totalHourlyWages = hourlyRows.reduce((s, r) => s + (r.amount || 0), 0)
  const totalAllWages = totalPieceWages + totalHourlyWages

  function change(next, runPreview = false) {
    set(next)
    action.clear()
    previewAction.clear()
    if (runPreview && (next.lines.length || next.hourly_works.length)) {
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

  function setHourlyWork(entry, remove = false) {
    const origId = edit?.original?.staff_id
    const nextHourly = report.hourly_works.filter(
      x => x.staff_id !== origId && x.staff_id !== entry.staff_id
    )
    if (!remove) nextHourly.push(entry)
    change({ ...report, hourly_works: nextHourly }, tab !== 'work')
    setEdit(null)
  }

  function selectTab(key) {
    setTab(key)
    if (key !== 'work' && editable && hasContent && !preview) {
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
  const eligibleHourlyWorkers = ws.staff.filter(w => w.active && w.hired_on <= report.date)
  const docHasQty = (document?.quantity || 0) > 0
  const docHasHourly = (document?.hourly_minutes || 0) > 0

  const postConfirmText =
    report.lines.length > 0 && report.hourly_works.length > 0
      ? 'Система спишет рассчитанные материалы со склада «' +
        activeSourceLabel +
        '», отразит выпуск на складе и начислит сдельную и почасовую зарплату.'
      : report.lines.length > 0
        ? 'Система спишет рассчитанные материалы со склада «' +
          activeSourceLabel +
          '», отразит выпуск на складе и начислит сдельную зарплату.'
        : 'Система начислит почасовую оплату за работу грузчиком (' +
          duration(totalHourlyMinutes) +
          ', ' +
          money(totalHourlyWages) +
          '). Складских списаний в этом отчёте нет.'

  return (
    <Page
      title={title}
      subtitle={
        stages[report.stage] +
        ' · ' +
        (document ? dayText(report.date) : 'данные из журнала выработки') +
        (document ? ' · ' + (statuses[document.status] || document.status) : ' · Черновик') +
        (!editable && docHasQty ? ' · Списание: ' + activeSourceLabel : '')
      }
      actions={
        documentMovement && (
          <Button to={'/reports/' + document.id + '/movements'}>Движения документа</Button>
        )
      }
    >
      {document && (
        <MetricStrip
          items={[
            {
              key: 'status',
              label: 'Статус',
              value: <Status value={document.status} />,
              meta: (shifts[document.shift] || document.shift) + ' смена'
            },
            !docHasQty && docHasHourly
              ? {
                  key: 'output',
                  label: 'Почасовая работа',
                  value: duration(document.hourly_minutes),
                  meta: 'Грузчик · ' + stages[document.stage]
                }
              : {
                  key: 'output',
                  label: 'Выработка',
                  value: qty(document.quantity) + ' компл.',
                  meta:
                    (docHasHourly ? '+' + duration(document.hourly_minutes) + ' грузчик' : stages[document.stage]) +
                    ' · ' +
                    activeSourceLabel,
                  to: '/stock/' + activeSourceId,
                  ariaLabel: 'Открыть склад списания: ' + activeSourceLabel
                },
            {
              key: 'wages',
              label: 'Начислено',
              value: document.status === 'draft' ? '—' : money(document.wages),
              meta:
                document.status === 'draft'
                  ? 'Фиксируется при проведении'
                  : docHasQty && docHasHourly
                    ? 'Сдельная + грузчик (' + duration(document.hourly_minutes) + ')'
                    : docHasHourly
                      ? 'Почасовая оплата (грузчик)'
                      : 'Сдельная оплата'
            },
            {
              key: 'author',
              label: 'Автор',
              value: document.author,
              meta: dayText(document.date)
            }
          ]}
        />
      )}

      <DocumentRelationBanner document={document} />

      {editable && (
        <div className="form-flat">
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
                  const nextHourly = report.hourly_works.filter(h => {
                    const worker = ws.staff.find(w => w.id === h.staff_id)
                    return !worker || worker.hired_on <= nextDate
                  })
                  change({ ...report, date: nextDate, lines: nextLines, hourly_works: nextHourly }, tab !== 'work')
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
            <Field label="Склад списания сырья">
              <Select
                disabled={!editable}
                entries={sourceWarehouses.map(w => [String(w.id), warehouseLabel(w.name, w.city)])}
                value={String(report.source_id || 1)}
                onChange={e => change({ ...report, source_id: Number(e.target.value) || 1 }, tab !== 'work')}
              />
            </Field>
          </div>
        </div>
      )}

      {dateBelowOpenMonth && (
        <div className="notice warning">
          Дата отчёта раньше открытого периода ({monthText(ws.settings.open_month)}). Выберите дату начиная с{' '}
          {dayText(minDate)}.
        </div>
      )}

      <Tabs items={tabList} value={tab} onChange={selectTab} label="Содержимое отчёта" />

      {tab === 'work' && (
        <>
          <Table
            label="Выработка"
            rows={products}
            rowKey={r => r.item_id}
            empty={
              hourlyRows.length > 0
                ? 'Выработка по изделиям не добавлена — в отчёте учтена работа грузчиком (' + duration(totalHourlyMinutes) + ')'
                : 'Добавьте изделие из журнала выработки или укажите почасовую работу грузчиком'
            }
            columns={[
              { label: 'Изделие', width: '28%', primary: true, cell: r => r.item.name },
              {
                label: 'Размер',
                width: '13%',
                mobileSubtitle: true,
                cell: r => r.item.size || '—'
              },
              {
                label: 'Количество, компл.',
                width: '15%',
                align: 'right',
                mobileAccent: true,
                cell: r => number(r.quantity) + ' компл.'
              },
              ...(report.stage === 'pack'
                ? [
                    {
                      label: 'Передано с пошива',
                      width: '15%',
                      align: 'right',
                      cell: r => number(r.prepared) + ' компл.'
                    }
                  ]
                : []),
              {
                label: 'Спецификация',
                width: '21%',
                align: 'after-number',
                mobileFull: report.stage !== 'pack',
                cell: r => {
                  const explicit = r.spec_id ? specsById.get(Number(r.spec_id)) : null
                  const saved = computed?.lines?.find(l => l.item_id === r.item_id)
                  const fallback = defaultSpecForDate(specsByProduct.get(r.item_id) || [], report.date)
                  const specId = explicit?.id || saved?.spec_id || fallback?.id || null
                  const specVer = explicit?.version || saved?.version || fallback?.version || r.item.version
                  const specName =
                    explicit?.name ||
                    saved?.spec_name ||
                    fallback?.name ||
                    (specVer ? 'Спецификация ' + specVer : 'Спецификация')
                  const showVerSub = specVer && specName !== 'Спецификация ' + specVer && specName !== 'Версия ' + specVer
                  return (
                    <>
                      <a
                        className="neutral-link"
                        href={href('/catalog/' + r.item_id + (specId ? '/specs/' + specId : ''))}
                      >
                        {specName}
                      </a>
                      {showVerSub && <span className="spec-tag">Версия {specVer}</span>}
                    </>
                  )
                }
              },
              ...(editable
                ? [
                    {
                      label: 'Действия',
                      width: '12%',
                      align: 'right',
                      mobileKind: 'actions',
                      cell: (r, i) => (
                        <Button kind="ghost" onClick={() => setEdit({ kind: 'line', index: i })}>
                          Изменить
                        </Button>
                      )
                    }
                  ]
                : [])
            ]}
            mobileSummary={
              products.length > 0
                ? {
                    rows: [
                      { label: 'Итого выработка', value: number(totalOutput) + ' компл.', strong: true },
                      ...(report.stage === 'pack'
                        ? [
                            {
                              label: 'Передано с пошива',
                              value: number(products.reduce((s, l) => s + (l.prepared || 0), 0)) + ' компл.'
                            }
                          ]
                        : [])
                    ]
                  }
                : null
            }
            footer={
              products.length > 0 ? (
                <tr>
                  <th scope="row" colSpan={2}>Итого выработка</th>
                  <td className="right" data-label="Выработка"><strong>{number(totalOutput)} компл.</strong></td>
                  {report.stage === 'pack' && (
                    <td className="right" data-label="Передано с пошива">
                      {number(products.reduce((s, l) => s + (l.prepared || 0), 0))} компл.
                    </td>
                  )}
                  <td colSpan={editable ? 2 : 1} />
                </tr>
              ) : null
            }
          />
          {editable && (
            <div className="action-pair">
              <Button kind="secondary" onClick={() => setEdit({ kind: 'line', index: -1 })}>
                Добавить изделие
              </Button>
              <Button
                kind="secondary"
                disabled={hourlyRows.length >= eligibleHourlyWorkers.length}
                onClick={() => {
                  selectTab('wages')
                  setEdit({ kind: 'hourly' })
                }}
              >
                Работа грузчиком
              </Button>
            </div>
          )}
        </>
      )}

      {tab === 'materials' && (
        <>
          <ErrorBox error={previewAction.error} />
          {computed && computed.lines?.length > 0 ? (
            <MaterialRows
              document={computed}
              sourceId={activeSourceId}
              sourceLabel={activeSourceLabel}
            />
          ) : (
            <div className="data-card data-card-empty">
              <EmptyState
                title={previewAction.busy ? 'Расчёт материалов…' : 'Нет выработки для расчёта'}
                description={
                  previewAction.busy
                    ? 'Проверяем нормы по выбранной спецификации и остатки на складе «' + activeSourceLabel + '».'
                    : hourlyRows.length > 0
                      ? 'Для почасовой работы грузчиком списание сырья со склада не требуется.'
                      : 'Добавьте изделия на вкладке «Выработка», чтобы увидеть потребность в сырье.'
                }
              />
            </div>
          )}
        </>
      )}

      {tab === 'wages' && (
        <>
          <ErrorBox error={previewAction.error} />
          {(editable || products.length > 0) && (
            <>
              {editable && products.length > 0 && (
                <div className="assignment-dist-list" aria-label="Распределение выработки по изделиям">
                  {products.map((l, idx) => {
                    const allocated = l.assignments.reduce((s, a) => s + a.quantity, 0)
                    const remaining = l.quantity - allocated
                    const pct = l.quantity > 0 ? Math.min(100, Math.round((allocated / l.quantity) * 100)) : 0
                    const fillState = remaining === 0 ? 'is-complete' : remaining < 0 ? 'is-over' : 'is-warning'
                    return (
                      <DataCard
                        key={l.item_id}
                        className="assignment-dist-card"
                        title={itemText(l.item)}
                        subtitle={'Распределено ' + number(allocated) + ' из ' + number(l.quantity) + ' компл.'}
                        badge={
                          remaining === 0 ? (
                            <Status value="posted" label="Распределено" />
                          ) : remaining > 0 ? (
                            <Status value="draft" label={'Остаток: ' + number(remaining) + ' компл.'} />
                          ) : (
                            <Status value="corrected" label={'Превышение: ' + number(-remaining) + ' компл.'} />
                          )
                        }
                        actions={
                          remaining > 0 ? (
                            <Button
                              kind="secondary"
                              size="small"
                              disabled={!eligibleWorkers.length}
                              onClick={() => setEdit({ kind: 'assignment', lineIndex: idx })}
                            >
                              Назначить остаток ({number(remaining)})
                            </Button>
                          ) : null
                        }
                      >
                        <div className="assignment-dist-progress">
                          <div className="progress-track" aria-hidden="true">
                            <div className={'progress-fill ' + fillState} style={{ width: pct + '%' }} />
                          </div>
                        </div>
                      </DataCard>
                    )
                  })}
                </div>
              )}

              <Table
                label="Технологическая карта"
                rows={assigned}
                rowKey={r => r.line + '-' + r.staff_id}
                rowHref={!editable ? r => '/people/' + r.staff_id : undefined}
                empty={
                  products.length
                    ? 'Исполнители ещё не назначены'
                    : 'Сначала добавьте изделия на вкладке «Выработка» (или укажите ниже работу грузчиком)'
                }
                columns={[
                  {
                    label: 'Исполнитель',
                    primary: true,
                    cell: r =>
                      r.worker ? (
                        <a href={href('/people/' + r.staff_id)}>{r.worker.name}</a>
                      ) : (
                        '—'
                      )
                  },
                  { label: 'Изделие', mobileFull: true, cell: r => itemText(r.item) },
                  { label: 'Комплектов', align: 'right', cell: r => number(r.quantity) },
                  {
                    label: 'Расценка',
                    align: 'right',
                    cell: r => (r.rate !== undefined ? money(r.rate) : '—')
                  },
                  {
                    label: 'Начислено',
                    align: 'right',
                    mobileAccent: true,
                    cell: r => (r.rate !== undefined ? money(r.rate * r.quantity) : '—')
                  },
                  ...(editable
                    ? [
                        {
                          label: 'Действия',
                          align: 'right',
                          mobileKind: 'actions',
                          cell: r => (
                            <Button kind="ghost" onClick={() => setEdit({ kind: 'assignment', original: r })}>
                              Изменить
                            </Button>
                          )
                        }
                      ]
                    : [])
                ]}
                mobileSummary={
                  assigned.length > 0
                    ? {
                        title: 'Итого по технологической карте',
                        rows: [
                          { label: 'Комплектов', value: number(assigned.reduce((s, r) => s + r.quantity, 0)) },
                          { label: 'Начислено', value: money(totalPieceWages), strong: true }
                        ]
                      }
                    : null
                }
                footer={
                  assigned.length > 0 ? (
                    <tr>
                      <th scope="row" colSpan={2}>Итого по технологической карте</th>
                      <td className="right" data-label="Комплектов">
                        <strong>{number(assigned.reduce((s, r) => s + r.quantity, 0))}</strong>
                      </td>
                      <td />
                      <td className="right" data-label="Начислено"><strong>{money(totalPieceWages)}</strong></td>
                      {editable && <td />}
                    </tr>
                  ) : null
                }
              />
              {editable && (
                <div className="left-actions mobile-full-action">
                  <Button
                    disabled={!products.length || totalUnassigned === 0 || !eligibleWorkers.length}
                    onClick={() => setEdit({ kind: 'assignment' })}
                  >
                    Назначить исполнителя
                  </Button>
                </div>
              )}
            </>
          )}

          {(editable || hourlyRows.length > 0) && (
            <div className="report-subsection">
              <Section
                title="Дополнительная работа · Грузчик"
                subtitle={'Почасовая оплата по ставке ' + money(loaderRate) + '/ч · доступен любой действующий сотрудник'}
                actions={
                  editable ? (
                    <Button
                      size="small"
                      disabled={hourlyRows.length >= eligibleHourlyWorkers.length}
                      onClick={() => setEdit({ kind: 'hourly' })}
                    >
                      Добавить работу грузчиком
                    </Button>
                  ) : null
                }
              >
                <Table
                  label="Почасовая работа грузчиком"
                  rows={hourlyRows}
                  rowKey={r => r.staff_id + '-' + r.work_type}
                  rowHref={!editable ? r => '/people/' + r.staff_id : undefined}
                  empty="Почасовая работа грузчиком в этой смене не указывалась"
                  columns={[
                    {
                      label: 'Сотрудник',
                      primary: true,
                      cell: r => (
                        <>
                          <a href={href('/people/' + r.staff_id)}>{r.name}</a>
                          {(r.position || r.stage) && (
                            <span className="cell-secondary">
                              {[r.position, stages[r.stage]].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </>
                      )
                    },
                    {
                      label: 'Вид работы',
                      mobileHide: true,
                      cell: r => hourlyWorkLabels[r.work_type] || 'Грузчик'
                    },
                    { label: 'Время', align: 'right', className: 'nowrap', cell: r => duration(r.minutes) },
                    { label: 'Ставка', align: 'right', className: 'nowrap', cell: r => money(r.hourly_rate) + '/ч' },
                    {
                      label: 'Начислено',
                      align: 'right',
                      className: 'nowrap',
                      mobileAccent: true,
                      cell: r => money(r.amount)
                    },
                    ...(editable
                      ? [
                          {
                            label: 'Действия',
                            align: 'right',
                            mobileKind: 'actions',
                            cell: r => (
                              <Button kind="ghost" onClick={() => setEdit({ kind: 'hourly', original: r })}>
                                Изменить
                              </Button>
                            )
                          }
                        ]
                      : [])
                  ]}
                  mobileSummary={
                    hourlyRows.length > 0
                      ? {
                          title: 'Итого работа грузчиком',
                          rows: [
                            { label: 'Время', value: duration(totalHourlyMinutes) },
                            { label: 'Начислено', value: money(totalHourlyWages), strong: true }
                          ]
                        }
                      : null
                  }
                  footer={
                    hourlyRows.length > 0 ? (
                      <tr>
                        <th scope="row" colSpan={2}>Итого работа грузчиком</th>
                        <td className="right nowrap" data-label="Время">
                          <strong>{duration(totalHourlyMinutes)}</strong>
                        </td>
                        <td />
                        <td className="right nowrap" data-label="Начислено">
                          <strong>{money(totalHourlyWages)}</strong>
                        </td>
                        {editable && <td />}
                      </tr>
                    ) : null
                  }
                />
              </Section>
            </div>
          )}

          {assigned.length > 0 && hourlyRows.length > 0 && (
            <SummaryCard
              title="Итого начислений по смене"
              rows={[
                { label: 'Сдельная оплата', value: money(totalPieceWages) },
                { label: 'Работа грузчиком (' + duration(totalHourlyMinutes) + ')', value: money(totalHourlyWages) },
                { label: 'Всего по отчёту', value: money(totalAllWages), strong: true }
              ]}
            />
          )}
        </>
      )}

      {editable && (
        <div className="form-flat">
          <Field label="Комментарий (необязательно)" wide>
            <textarea
              value={report.memo}
              maxLength={500}
              rows={2}
              placeholder="Заметки смены или пояснение к отчёту"
              onChange={e => change({ ...report, memo: e.target.value })}
            />
          </Field>
        </div>
      )}
      {!editable && document?.memo && !document?.source_doc && (
        <p className="inline-note">{document.memo}</p>
      )}

      <ErrorBox error={action.error} />

      {editable ? (
        <div className="action-row desktop-form-actions">
          <Button kind="ghost" className="push-left" to="/reports">
            Отмена
          </Button>
          <Button disabled={!hasContent || action.busy || dateBelowOpenMonth} onClick={() => save(false)}>
            Сохранить черновик
          </Button>
          <Button
            kind="primary"
            disabled={!hasContent || action.busy || dateBelowOpenMonth}
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
        </div>
      ) : (
        (canCorrect || (document?.status === 'posted' && write && minDate && document.date < minDate)) && (
          <div className="action-row">
            {canCorrect && (
              <Button onClick={() => setConfirm('correct')}>Исправить отчёт</Button>
            )}
            {document?.status === 'posted' && write && minDate && document.date < minDate && (
              <span className="muted">Период закрыт для исправления</span>
            )}
          </div>
        )
      )}

      {document && <DocumentHistory document={{ ...document, movements: [] }} defaultOpen={document.status !== 'draft'} />}

      {editable && (
        <div className="mobile-sticky-bar" role="region" aria-label="Действия отчёта">
          <div className="mobile-sticky-summary">
            <span>{totalOutput > 0 || !totalHourlyMinutes ? 'Выработка' : 'Грузчик'}</span>
            <strong>
              {totalOutput > 0
                ? number(totalOutput) + ' компл.' + (totalHourlyMinutes > 0 ? ' · ' + duration(totalHourlyMinutes) : '')
                : totalHourlyMinutes > 0
                  ? duration(totalHourlyMinutes)
                  : '0 компл.'}
            </strong>
          </div>
          <div className="mobile-sticky-actions">
            <Button
              disabled={!hasContent || action.busy || dateBelowOpenMonth}
              onClick={() => save(false)}
            >
              Черновик
            </Button>
            <Button
              kind="primary"
              disabled={!hasContent || action.busy || dateBelowOpenMonth}
              onClick={() => {
                if (canPost) {
                  setConfirm('post')
                } else {
                  selectTab('wages')
                  toast.info('Распределите весь выпуск по исполнителям перед проведением.')
                }
              }}
            >
              Провести
            </Button>
          </div>
        </div>
      )}

      {edit?.kind === 'line' && (
        <EditWorkLine
          original={report.lines[edit.index]}
          stage={report.stage}
          reportDate={report.date}
          items={ws.items}
          specs={allSpecs}
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

      {edit?.kind === 'hourly' && (
        <EditHourlyWork
          original={edit.original}
          workers={eligibleHourlyWorkers}
          usedStaffIds={report.hourly_works.map(h => h.staff_id)}
          loaderRate={loaderRate}
          close={() => setEdit(null)}
          save={entry => setHourlyWork(entry)}
          remove={edit.original ? () => setHourlyWork(edit.original, true) : undefined}
        />
      )}

      {confirm === 'post' && (
        <Confirm
          title="Провести отчёт?"
          text={postConfirmText}
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
    <Guard request={request} skeleton="cards">
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
  const ws = useWorkspace()
  const request = useRemote('/document/' + id)
  return (
    <Guard request={request} skeleton="cards">
      {d => {
        if (d.kind !== 'report' || d.status === 'draft') {
          return <ErrorBox error="По этому документу ещё нет движений." />
        }
        const sourceId = d.source_id || 1
        const sourceLabel = d.source_name
          ? warehouseLabel(d.source_name, d.source_city)
          : 'Склад сырья · Иваново'
        const assignmentRows = d.lines.flatMap(l =>
          l.assignments.map(a => ({
            ...a,
            item_name: itemText(l),
            id: l.id + '-' + a.staff_id
          }))
        )
        const pieceTotal = assignmentRows.reduce(
          (s, r) => s + Math.round((r.quantity * r.rate) / 1000),
          0
        )
        const hourlyRows = d.hourly_works || []
        const hourlyMinutesTotal = hourlyRows.reduce((s, r) => s + (r.minutes || 0), 0)
        const hourlyAmountTotal = hourlyRows.reduce((s, r) => s + (r.amount || 0), 0)
        const hasMovementsOrLines = (d.movements?.length || 0) > 0 || (d.lines?.length || 0) > 0

        return (
          <Page
            title={'Движения отчёта ' + d.code}
            subtitle={
              stages[d.stage] +
              ' · ' +
              dayText(d.date) +
              ' · ' +
              (statuses[d.status] || d.status) +
              (hasMovementsOrLines ? ' · Списание: ' + sourceLabel : '')
            }
            actions={<Button className="desktop-only" to={'/reports/' + d.id}>К отчёту</Button>}
          >
            <DocumentRelationBanner document={d} />
            {hasMovementsOrLines ? (
              <Section
                title="Материалы и выпуск"
                subtitle={
                  <>
                    Склад списания сырья:{' '}
                    <a href={href('/stock/' + sourceId)}>{sourceLabel}</a>
                  </>
                }
              >
                <Table
                  label="Материалы и выпуск"
                  rows={d.movements}
                  empty="Движений по этому документу нет"
                  columns={[
                    {
                      label: 'Склад',
                      mobileFull: true,
                      cell: r => <a href={href('/stock/' + r.warehouse_id)}>{r.warehouse}</a>
                    },
                    {
                      label: 'Позиция',
                      primary: true,
                      cell: r => {
                        const item = ws.items?.find(i => i.id === r.item_id)
                        if (r.warehouse_id === 1) {
                          return <a href={href('/stock/1/items/' + r.item_id)}>{r.name}</a>
                        }
                        if (item?.kind === 'raw') {
                          return <a href={href('/stock/' + r.warehouse_id)}>{r.name}</a>
                        }
                        return <a href={href('/catalog/' + r.item_id)}>{itemText(r)}</a>
                      }
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
                      mobileAccent: true,
                      cell: r => qty(r.balance_after) + ' ' + r.unit
                    }
                  ]}
                />
                <p className="muted">Остаток указан сразу после проведения соответствующей операции.</p>
              </Section>
            ) : (
              <div className="inline-note info">
                В этом отчёте учтена только почасовая работа грузчиком — складских движений нет.
              </div>
            )}
            {(assignmentRows.length > 0 || !hourlyRows.length) && (
              <Section title="Сдельная зарплата">
                <Table
                  label="Сдельная зарплата по отчёту"
                  rows={assignmentRows}
                  rowHref={r => '/people/' + r.staff_id}
                  empty="Начислений по отчёту нет"
                  columns={[
                    {
                      label: 'Исполнитель',
                      primary: true,
                      cell: r => <a href={href('/people/' + r.staff_id)}>{r.name}</a>
                    },
                    { label: 'Изделие', cell: r => r.item_name },
                    { label: 'Операция', cell: () => stages[d.stage] },
                    { label: 'Комплектов', align: 'right', cell: r => qty(r.quantity) },
                    { label: 'Расценка', align: 'right', cell: r => money(r.rate) },
                    {
                      label: 'Начислено',
                      align: 'right',
                      mobileAccent: true,
                      cell: r => money(Math.round((r.quantity * r.rate) / 1000))
                    }
                  ]}
                  mobileSummary={
                    assignmentRows.length > 0
                      ? {
                          title: 'Итого сдельная',
                          rows: [
                            { label: 'Комплектов', value: qty(assignmentRows.reduce((s, r) => s + r.quantity, 0)) },
                            { label: 'Начислено', value: money(pieceTotal), strong: true }
                          ]
                        }
                      : null
                  }
                  footer={
                    assignmentRows.length > 0 ? (
                      <tr>
                        <th scope="row" colSpan={3}>Итого сдельная</th>
                        <td className="right" data-label="Комплектов">
                          <strong>{qty(assignmentRows.reduce((s, r) => s + r.quantity, 0))}</strong>
                        </td>
                        <td />
                        <td className="right" data-label="Начислено"><strong>{money(pieceTotal)}</strong></td>
                      </tr>
                    ) : null
                  }
                />
              </Section>
            )}
            {hourlyRows.length > 0 && (
              <div className="report-subsection">
                <Section title="Дополнительная работа · Грузчик (почасовая)">
                  <Table
                    label="Почасовая работа грузчиком"
                    rows={hourlyRows}
                    rowKey={r => r.id || r.staff_id + '-' + r.work_type}
                    rowHref={r => '/people/' + r.staff_id}
                    empty="Почасовой работы нет"
                    columns={[
                      {
                        label: 'Сотрудник',
                        primary: true,
                        cell: r => (
                          <>
                            <a href={href('/people/' + r.staff_id)}>{r.name}</a>
                            {(r.position || r.stage) && (
                              <span className="cell-secondary">
                                {[r.position, stages[r.stage]].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </>
                        )
                      },
                      {
                        label: 'Вид работы',
                        mobileHide: true,
                        cell: r => hourlyWorkLabels[r.work_type] || 'Грузчик'
                      },
                      { label: 'Время', align: 'right', className: 'nowrap', cell: r => duration(r.minutes) },
                      { label: 'Ставка', align: 'right', className: 'nowrap', cell: r => money(r.hourly_rate) + '/ч' },
                      {
                        label: 'Начислено',
                        align: 'right',
                        className: 'nowrap',
                        mobileAccent: true,
                        cell: r => money(r.amount)
                      }
                    ]}
                    mobileSummary={{
                      title: 'Итого работа грузчиком',
                      rows: [
                        { label: 'Время', value: duration(hourlyMinutesTotal) },
                        { label: 'Начислено', value: money(hourlyAmountTotal), strong: true }
                      ]
                    }}
                    footer={
                      <tr>
                        <th scope="row" colSpan={2}>Итого работа грузчиком</th>
                        <td className="right nowrap" data-label="Время">
                          <strong>{duration(hourlyMinutesTotal)}</strong>
                        </td>
                        <td />
                        <td className="right nowrap" data-label="Начислено">
                          <strong>{money(hourlyAmountTotal)}</strong>
                        </td>
                      </tr>
                    }
                  />
                </Section>
              </div>
            )}
            {assignmentRows.length > 0 && hourlyRows.length > 0 && (
              <SummaryCard
                title="Итого начислений по отчёту"
                rows={[
                  { label: 'Сдельная оплата', value: money(pieceTotal) },
                  { label: 'Работа грузчиком (' + duration(hourlyMinutesTotal) + ')', value: money(hourlyAmountTotal) },
                  { label: 'Всего по документу', value: money(d.wages), strong: true }
                ]}
              />
            )}
            <DocumentHistory document={{ ...d, movements: [] }} defaultOpen />
          </Page>
        )
      }}
    </Guard>
  )
}
