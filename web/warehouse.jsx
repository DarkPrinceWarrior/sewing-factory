import React, {useState} from 'react'
import {DocumentHistory, Wip} from './production'
import {
  ActionRow, Button, Card, Confirm, DateControl, DateRange, Details, Dialog, Download, ErrorBox, Field,
  FormActions, Guard, Page, Pager, RegistryTools, Select, Status, Table, Tabs,
  api, dateTime, dayText, go, href, itemText, matchesSearch, money, number, payments, qty, roleCanWrite,
  routeWith, useAction, useFilters, useRemote, useSearchOptions, useToast, useWorkspace
} from './ui'
import {PasswordInput, SearchPicker} from './pickers'

const place = (w) => w.name + ' · ' + w.city
const purposes = {
  raw: 'Сырьё и материалы',
  finished: 'Готовая продукция',
  regional: 'Продажи и выдача',
  cut: 'Раскрой',
  sew: 'Пошив',
  pack: 'Упаковка'
}
const movementName = {
  opening: 'Начальный остаток',
  receipt: 'Поступление сырья',
  material: 'Списание материалов',
  stage_use: 'Передача в производство',
  packing_sent: 'Передача на упаковку',
  packing_received: 'Приём на упаковку',
  production: 'Выпуск продукции',
  transfer_out: 'Отправка',
  transfer_in: 'Приёмка',
  sale: 'Продажа',
  correction: 'Исправление'
}
const documentPath = (doc) => ({
  report: '/reports/',
  receipt: '/stock/receipts/',
  transfer: '/stock/transfers/',
  sale: '/stock/sales/'
}[doc.kind] || '') + (doc.doc_id || doc.id)

const centralTabs = [
  ['inventory', 'Остатки'],
  ['transfers', 'Перемещения'],
  ['sales', 'Продажи'],
  ['access', 'Доступ']
]
const payModes = Object.entries(payments)
const payBarClass = {card: 'cut', cash: 'pack', transfer: 'sew'}
const total = (rows, field) => rows.reduce((sum, r) => sum + (r[field] || 0), 0)
const input = (set, key) => e => set(f => ({...f, [key]: e.target.value}))
const nowrap = (content) => <span style={{whiteSpace: 'nowrap'}}>{content}</span>

function WarehouseForm({close, done}) {
  const model = useAction()
  const toast = useToast()
  const [data, set] = useState({name: 'Региональный склад', city: '', address: ''})

  return (
    <Dialog title="Добавить склад" closeDisabled={model.busy} close={close}>
      <form onSubmit={e => {
        e.preventDefault()
        model.run(async () => {
          const created = await api('/warehouses', 'POST', data)
          toast.success('Склад «' + created.city + '» добавлен')
          done(created)
        })
      }}>
        <div className="form-grid">
          <Field label="Город">
            <input required value={data.city} onChange={input(set, 'city')} maxLength="180" placeholder="Например: Казань"/>
          </Field>
          <Field label="Название">
            <input required value={data.name} onChange={input(set, 'name')} maxLength="180" placeholder="Региональный склад"/>
          </Field>
          <Field label="Адрес" wide>
            <input required value={data.address} onChange={input(set, 'address')} maxLength="180" placeholder="Улица, дом или ориентир"/>
          </Field>
        </div>
        <ErrorBox error={model.error}/>
        <FormActions busy={model.busy} cancel={close} submit="Добавить склад"/>
      </form>
    </Dialog>
  )
}

function CentralInventory({add, setAdd}) {
  const ws = useWorkspace()
  const isMaster = ws.user.role === 'master'
  const canWrite = roleCanWrite(ws.user)
  const internal = ws.warehouses.filter(w => ['cut', 'sew', 'pack'].includes(w.kind))
  const market = ws.warehouses.filter(w => !internal.includes(w))
  const retail = market.filter(w => w.kind !== 'raw')
  const moving = ws.in_transit
  const state = useFilters('central-stock', {search: ''})
  const rows = market.filter(w => matchesSearch(state.filters.search, w.name, w.city, w.address, purposes[w.kind]))

  const columns = [
    {
      label: 'Склад',
      width: canWrite ? '26%' : '30%',
      cell: w => (
        <>
          <a href={href('/stock/' + w.id)}>{w.name}</a>
          {w.address && <small className="cell-secondary">{w.address}</small>}
        </>
      )
    },
    {label: 'Город', width: '14%', cell: w => nowrap(w.city)},
    {label: 'Назначение', width: '21%', cell: w => w.kind === 'regional' ? 'Готовая продукция' : purposes[w.kind]},
    {
      label: 'Остаток',
      align: 'right',
      width: '13%',
      cell: w => w.kind === 'raw' ? number(w.positions) + ' поз.' : qty(w.quantity) + ' компл.'
    },
    {label: 'Стоимость', align: 'right', width: '14%', cell: w => money(w.value)},
    ...(canWrite ? [{
      label: 'Действия',
      align: 'right',
      width: '12%',
      cell: w => w.kind === 'finished'
        ? <Button kind="ghost" size="small" to="/stock/transfers/new">Переместить</Button>
        : w.kind === 'raw'
          ? <Button kind="ghost" size="small" to="/stock/receipts/new">Принять сырьё</Button>
          : null
    }] : [])
  ]

  const transitPath = routeWith('/stock/transfers', {status: 'in_transit'})

  return (
    <>
      {!isMaster && (
        <Card className="kpi-grid cols-3">
          <div className="kpi-item">
            <span className="kpi-label">Готовая продукция на складах</span>
            <strong className="kpi-value">{qty(total(retail, 'quantity'))} компл.</strong>
            <small className="kpi-meta">{retail.length} складов в {new Set(retail.map(w => w.city)).size} городах</small>
          </div>
          <div className="kpi-item">
            <span className="kpi-label">Стоимость готовой продукции</span>
            <strong className="kpi-value">{money(total(retail, 'value'))}</strong>
            <small className="kpi-meta">По учётной стоимости</small>
          </div>
          <div className="kpi-item">
            <span className="kpi-label">В пути</span>
            <strong className="kpi-value">
              {moving?.documents
                ? <a className="neutral-link" href={href(transitPath)}>{qty(moving.quantity)} компл.</a>
                : qty(moving?.quantity) + ' компл.'}
            </strong>
            <small className="kpi-meta">
              {moving?.documents
                ? <a href={href(transitPath)}>Ожидают приёмки: {number(moving.documents)}</a>
                : 'Открытых перемещений нет'}
            </small>
          </div>
        </Card>
      )}
      <Card
        className="warehouse-register"
        title={isMaster ? 'Склады · Иваново' : 'Склады по городам'}
        actions={ws.user.role === 'admin' && <Button kind="primary" onClick={() => setAdd(true)}>Добавить склад</Button>}
      >
        <RegistryTools state={state} total={rows.length} placeholder="Название, город или адрес"/>
        <Table label={isMaster ? 'Склады Иваново' : 'Склады по городам'} columns={columns} rows={rows} empty="Склады по этому запросу не найдены"/>
      </Card>
      <Card title="Внутренние запасы · Иваново">
        <Wip rows={internal} links/>
      </Card>
      {add && <WarehouseForm close={() => setAdd(false)} done={() => { ws.refresh(); setAdd(false) }}/>}
    </>
  )
}

export function CentralStock({tab = 'inventory'}) {
  const {user, today} = useWorkspace()
  const [add, setAdd] = useState(false)
  const [grant, setGrant] = useState(false)
  const tabs = centralTabs.filter(([id]) => user.role === 'admin' || (user.role === 'accountant' && id !== 'access') || id === 'inventory')
  if (!tabs.some(([id]) => id === tab)) return <ErrorBox error="Раздел недоступен для вашей роли."/>

  return (
    <Page
      title={tab === 'access' ? 'Доступ к складам' : 'Склады'}
      subtitle={tab === 'access' ? 'Именные учётные записи сотрудников' : 'Остатки и операции по площадкам · ' + dayText(today)}
      actions={
        tab === 'transfers'
          ? <Button kind="primary" to="/stock/transfers/new">Новое перемещение</Button>
          : tab === 'access'
            ? <Button kind="primary" onClick={() => setGrant(true)}>Назначить доступ</Button>
            : null
      }
    >
      {tabs.length > 1 && (
        <Tabs
          label="Разделы складского учёта"
          style="flat"
          items={tabs}
          value={tab}
          onChange={id => go('/stock' + (id === 'inventory' ? '' : '/' + id))}
        />
      )}
      {tab === 'inventory' && <CentralInventory add={add} setAdd={setAdd}/>}
      {tab === 'transfers' && <DocumentRegister kind="transfer"/>}
      {tab === 'sales' && <SalesOverview/>}
      {tab === 'access' && <WarehouseAccess grant={grant} setGrant={setGrant}/>}
    </Page>
  )
}

export function WarehouseDetail({id, regional = false}) {
  const ws = useWorkspace()
  const selection = useFilters('warehouse-tab-' + id, {tab: 'stock'})
  const tab = selection.filters.tab
  const stock = useFilters('warehouse-stock-' + id, {search: ''})
  const [pageSize, setPageSize] = useState(15)
  const request = useRemote('/warehouses/' + id)
  const incoming = useRemote(regional ? '/documents/transfer' : null, {status: 'in_transit', limit: 1})

  return (
    <Guard request={request}>
      {d => {
        const w = d.warehouse
        const rows = d.rows.filter(r => matchesSearch(stock.filters.search, r.name, r.size, r.sku, r.category))
        const tabs = [
          ['stock', 'Текущие остатки'],
          ['history', 'История движений'],
          ...(w.kind === 'raw' && roleCanWrite(ws.user) ? [['receipts', 'Документы поступления']] : [])
        ]
        const selected = tabs.some(([key]) => key === tab) ? tab : 'stock'
        const isRaw = w.kind === 'raw'
        const units = new Set(rows.map(r => r.unit))
        const singleUnit = units.size === 1 ? rows[0]?.unit : ''

        const columns = [
          ...(isRaw
            ? [
                {label: 'Материал', cell: r => <a href={href('/stock/1/items/' + r.item_id)}>{r.name}</a>},
                {label: 'Единица', cell: r => r.unit},
                {label: 'На начало дня', align: 'right', cell: r => qty(r.quantity - r.incoming + r.outgoing) + ' ' + r.unit}
              ]
            : [
                {label: 'Артикул', cell: r => nowrap(r.sku)},
                {label: 'Изделие', cell: itemText}
              ]),
          {label: 'Поступило сегодня', align: 'right', cell: r => qty(r.incoming) + ' ' + r.unit},
          {label: 'Выбыло сегодня', align: 'right', cell: r => qty(r.outgoing) + ' ' + r.unit},
          {label: 'Остаток', align: 'right', cell: r => <strong>{qty(r.quantity)} {r.unit}</strong>},
          {label: regional ? 'Цена продажи' : 'Учётная стоимость', align: 'right', cell: r => money(regional ? r.price : r.value)}
        ]

        const retailStockTotal = regional
          ? d.rows.reduce((sum, r) => sum + Math.round((r.quantity || 0) * (r.price || 0) / 1000), 0)
          : 0
        const inStockPositions = d.rows.filter(r => r.quantity > 0).length
        const transitDocs = incoming.data?.total || 0

        const footer = rows.length > 0 ? (
          <tr>
            <td colSpan={isRaw ? 2 : 2}><strong>Итого ({number(rows.length)} поз.)</strong></td>
            {isRaw && (
              <td className="right">
                {singleUnit ? qty(rows.reduce((s, r) => s + r.quantity - r.incoming + r.outgoing, 0)) + ' ' + singleUnit : '—'}
              </td>
            )}
            <td className="right">{singleUnit ? qty(total(rows, 'incoming')) + ' ' + singleUnit : '—'}</td>
            <td className="right">{singleUnit ? qty(total(rows, 'outgoing')) + ' ' + singleUnit : '—'}</td>
            <td className="right"><strong>{singleUnit ? qty(total(rows, 'quantity')) + ' ' + singleUnit : '—'}</strong></td>
            <td className="right">
              <strong>
                {regional
                  ? money(rows.reduce((s, r) => s + Math.round((r.quantity || 0) * (r.price || 0) / 1000), 0))
                  : money(total(rows, 'value'))}
              </strong>
            </td>
          </tr>
        ) : null

        return (
          <Page
            title={regional ? 'Остатки' : w.name}
            subtitle={w.city + ' · ' + w.address}
            actions={
              <>
                {isRaw && roleCanWrite(ws.user) && <Button kind="primary" to="/stock/receipts/new">Оформить приход</Button>}
                {w.kind === 'finished' && roleCanWrite(ws.user) && <Button kind="primary" to="/stock/transfers/new">Переместить</Button>}
                {regional && <Button kind="primary" to="/sales/new">Новая продажа</Button>}
              </>
            }
          >
            {regional && (
              <Card className="kpi-grid cols-4">
                <div className="kpi-item">
                  <span className="kpi-label">Позиций в наличии</span>
                  <strong className="kpi-value">{number(inStockPositions)}</strong>
                  <small className="kpi-meta">Всего в ассортименте: {number(d.rows.length)}</small>
                </div>
                <div className="kpi-item">
                  <span className="kpi-label">Остаток на складе</span>
                  <strong className="kpi-value">{qty(total(d.rows, 'quantity'))} компл.</strong>
                  <small className="kpi-meta">{w.city}</small>
                </div>
                <div className="kpi-item">
                  <span className="kpi-label">Оценка по прайсу</span>
                  <strong className="kpi-value">{money(retailStockTotal)}</strong>
                  <small className="kpi-meta">В розничных ценах</small>
                </div>
                <div className="kpi-item">
                  <span className="kpi-label">Приёмка отправок</span>
                  <strong className="kpi-value">
                    {transitDocs > 0
                      ? <a className="neutral-link" href={href(routeWith('/receiving', {status: 'in_transit'}))}>{number(transitDocs)} в пути</a>
                      : '0 в пути'}
                  </strong>
                  <small className="kpi-meta">
                    {transitDocs > 0
                      ? <a href={href(routeWith('/receiving', {status: 'in_transit'}))}>Перейти к приёмке</a>
                      : 'Ожидающих отправок нет'}
                  </small>
                </div>
              </Card>
            )}
            <Card>
              <Tabs value={selected} onChange={value => selection.change('tab', value)} items={tabs}/>
              {selected === 'stock' && (
                <>
                  <RegistryTools
                    state={stock}
                    total={rows.length}
                    placeholder={isRaw ? 'Материал, категория или артикул' : 'Изделие, размер или артикул'}
                  />
                  <Table
                    label="Текущие остатки"
                    rows={rows.slice((stock.page - 1) * pageSize, stock.page * pageSize)}
                    hasPager={rows.length > 0}
                    footer={footer}
                    empty={stock.filters.search ? 'Товары не найдены' : 'На этом складе пока нет остатков'}
                    columns={columns}
                  />
                  <Pager
                    page={stock.page}
                    size={pageSize}
                    change={stock.setPage}
                    onSizeChange={s => { setPageSize(s); stock.setPage(1) }}
                    total={rows.length}
                  />
                  {rows.length > 0 && <ActionRow><Download path={'/warehouses/' + id} options={stock.filters}/></ActionRow>}
                </>
              )}
              {selected === 'history' && <StockHistory id={id} items={d.rows}/>}
              {selected === 'receipts' && <DocumentRegister kind="receipt" inline/>}
            </Card>
          </Page>
        )
      }}
    </Guard>
  )
}

function StockHistory({id, items, material}) {
  const {today, user} = useWorkspace()
  const regional = user.role === 'regional'
  const [pageSize, setPageSize] = useState(15)
  const state = useFilters(material ? 'material-moves-' + material : 'stock-moves-' + id, {
    start: material ? today : '',
    end: material ? today : '',
    search: '',
    ...(!material ? {item: ''} : {})
  })
  const {filters, page, setPage, change} = state
  const {options, pending} = useSearchOptions(filters)
  const path = '/warehouses/' + id + '/movements'
  const query = {...options, ...(material ? {item: material} : {})}
  const moves = useRemote(path, {...query, limit: pageSize, offset: (page - 1) * pageSize})

  function moveLink(row) {
    if (row.kind === 'opening' || (user.role === 'master' && row.kind !== 'report')) return row.code
    const url = regional ? (row.kind === 'transfer' ? '/receiving/' : '/sales/') + row.doc_id : documentPath(row)
    return <a href={href(url)}>{row.code}</a>
  }

  return (
    <>
      <RegistryTools
        state={state}
        total={pending ? undefined : moves.data?.total}
        periodLabel={Boolean(material)}
        placeholder={material ? 'Номер документа' : 'Документ, изделие или артикул'}
      >
        <DateRange filters={filters} change={change}/>
        {!material && (
          <Field label="Товар" wide>
            <Select
              placeholder="Все товары"
              entries={items.map(r => [r.item_id, itemText(r)])}
              value={filters.item}
              onChange={e => change('item', e.target.value)}
            />
          </Field>
        )}
      </RegistryTools>
      <Guard request={pending ? {} : moves}>
        {m => (
          <>
            <Table
              label={material ? 'Движения материала' : 'История движений'}
              rows={m.rows}
              hasPager={m.total > 0}
              empty="Движений за выбранный период не найдено"
              columns={[
                {label: 'Дата и время', cell: r => nowrap(dateTime(r.happened_at))},
                {label: 'Документ', cell: moveLink},
                {label: 'Операция', cell: r => movementName[r.operation] || r.operation},
                ...(!material ? [{label: 'Товар', cell: itemText}] : []),
                {
                  label: 'Приход',
                  align: 'right',
                  cell: r => r.quantity > 0 ? <span className="positive">+{qty(r.quantity)} {r.unit}</span> : '—'
                },
                {
                  label: 'Расход',
                  align: 'right',
                  cell: r => r.quantity < 0 ? <span className="negative">−{qty(-r.quantity)} {r.unit}</span> : '—'
                },
                ...(!regional ? [{label: 'Стоимость', align: 'right', cell: r => money(r.value)}] : [])
              ]}
            />
            <Pager
              page={page}
              size={pageSize}
              total={m.total}
              change={setPage}
              onSizeChange={s => { setPageSize(s); setPage(1) }}
            />
            {m.total > 0 && <ActionRow><Download path={path} options={query}/></ActionRow>}
          </>
        )}
      </Guard>
    </>
  )
}

function DocumentFilters({state, kind, regional, total}) {
  const {warehouses} = useWorkspace()
  const {filters, change} = state
  return (
    <RegistryTools
      state={state}
      total={total}
      periodLabel={kind === 'sale'}
      placeholder={kind === 'receipt' ? 'Документ, поставщик или материал' : 'Документ, изделие или сотрудник'}
    >
      <DateRange filters={filters} change={change}/>
      {kind === 'transfer' && (
        <Field label="Статус">
          <Select
            placeholder="Все статусы"
            entries={[...(!regional ? [['draft', 'Черновик']] : []), ['in_transit', 'В пути'], ['received', 'Получено']]}
            value={filters.status}
            onChange={e => change('status', e.target.value)}
          />
        </Field>
      )}
      {!regional && kind !== 'receipt' && (
        <Field label="Склад" wide={kind === 'sale'}>
          <Select
            placeholder="Все склады"
            entries={warehouses.filter(w => w.kind === 'regional').map(w => [w.id, place(w)])}
            value={filters.warehouse}
            onChange={e => change('warehouse', e.target.value)}
          />
        </Field>
      )}
    </RegistryTools>
  )
}

function DocumentTable({kind, regional, page, size = 15, setPage, setSize, options, pending, request: externalRequest}) {
  const path = '/documents/' + kind
  const ownRequest = useRemote(externalRequest ? null : path, {...options, limit: size, offset: (page - 1) * size})
  const request = externalRequest || ownRequest

  const columns = [
    {
      label: 'Документ',
      cell: r => nowrap(<a href={href(regional ? (kind === 'sale' ? '/sales/' : '/receiving/') + r.id : documentPath(r))}>{r.code}</a>)
    },
    {label: 'Дата', cell: r => nowrap(kind === 'sale' ? dateTime(r.created_at) : dayText(r.date))},
    ...(kind === 'transfer'
      ? [{
          label: regional ? 'Отправитель' : 'Склад-получатель',
          cell: r => regional ? r.source_name + ' · ' + r.source_city : r.target_name + ' · ' + r.target_city
        }]
      : kind === 'sale' && !regional
        ? [{label: 'Город', cell: r => nowrap(r.source_city)}]
        : []),
    ...(kind === 'receipt'
      ? [{label: 'Поставщик', cell: r => r.supplier}, {label: 'Накладная', cell: r => r.reference}]
      : [{label: 'Комплектов', align: 'right', cell: r => qty(r.quantity)}]),
    {
      label: 'Сумма',
      align: 'right',
      cell: r => kind === 'transfer' && !regional && r.status !== 'draft'
        ? (
          <>
            <div>{money(r.total)}</div>
            <small className="cell-secondary">Учёт: {money(r.book_value)}</small>
          </>
        )
        : money(r.total)
    },
    {label: 'Статус', align: 'after-number', cell: r => <Status value={r.status} label={kind === 'sale' ? 'Оформлена' : undefined}/>},
    {label: 'Сотрудник', cell: r => nowrap(r.author)}
  ]

  return (
    <Guard request={pending ? {} : request}>
      {d => (
        <>
          <Table
            columns={columns}
            rows={d.rows}
            hasPager={d.total > 0}
            label="Журнал документов"
            empty="Документы по этому запросу не найдены"
          />
          <Pager
            page={page}
            size={size}
            total={d.total}
            change={setPage}
            onSizeChange={setSize ? s => { setSize(s); setPage(1) } : undefined}
          />
          {d.total > 0 && <ActionRow><Download path={path} options={options}/></ActionRow>}
        </>
      )}
    </Guard>
  )
}

function DocumentRegister({kind, regional = false, inline = false}) {
  const [size, setSize] = useState(15)
  const state = useFilters(kind + '-' + regional, {
    search: '',
    start: '',
    end: '',
    ...(kind === 'transfer' ? {status: ''} : {}),
    ...(!regional && kind === 'transfer' ? {warehouse: ''} : {})
  })
  const data = useSearchOptions(state.filters)
  const docsRequest = useRemote('/documents/' + kind, {...data.options, limit: size, offset: (state.page - 1) * size})

  const contents = (
    <>
      <DocumentFilters
        state={state}
        kind={kind}
        regional={regional}
        total={data.pending ? undefined : docsRequest.data?.total}
      />
      <DocumentTable
        kind={kind}
        regional={regional}
        page={state.page}
        size={size}
        setPage={state.setPage}
        setSize={setSize}
        request={docsRequest}
        {...data}
      />
    </>
  )
  return inline ? contents : <Card>{contents}</Card>
}

function BreakdownBars({rows, totalValue, labelFor, keyFor, metaFor, colorFor, onSelect}) {
  const maxVal = Math.max(1, ...rows.map(r => r.total || 0))
  const safeTotal = Math.max(1, totalValue || 0)

  return (
    <div className="cost-breakdown">
      {rows.map((r, idx) => {
        const share = Math.round((r.total || 0) / safeTotal * 100)
        const width = Math.max(2, Math.round((r.total || 0) / maxVal * 100))
        const label = labelFor(r)
        const meta = metaFor?.(r)
        return (
          <div key={keyFor(r, idx)} style={{display: 'grid', gap: 6}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12}}>
              <span>
                {onSelect
                  ? <button type="button" className="text-button" onClick={() => onSelect(r)}>{label}</button>
                  : <strong>{label}</strong>}
                {meta && <small className="muted" style={{marginLeft: 8}}>{meta}</small>}
              </span>
              <strong style={{whiteSpace: 'nowrap'}}>
                {money(r.total)} <span className="muted" style={{fontWeight: 400}}>({share}%)</span>
              </strong>
            </div>
            <div className="progress-track">
              <div className={'progress-fill ' + (colorFor?.(r, idx) || 'cut')} style={{width: width + '%'}}/>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SalesOverview({regional = false}) {
  const {today} = useWorkspace()
  const [size, setSize] = useState(15)
  const state = useFilters('sales-' + regional, {
    search: '',
    start: today.slice(0, 7) + '-01',
    end: today,
    ...(!regional ? {warehouse: ''} : {})
  })
  const data = useSearchOptions(state.filters)
  const request = useRemote('/sales-summary', data.options)
  const docsRequest = useRemote('/documents/sale', {...data.options, limit: size, offset: (state.page - 1) * size})

  return (
    <>
      <Card title={regional ? 'Продажи за период' : 'Сводка продаж'}>
        <DocumentFilters
          state={state}
          kind="sale"
          regional={regional}
          total={data.pending ? undefined : docsRequest.data?.total}
        />
        <Guard request={data.pending ? {} : request}>
          {d => {
            const avgCheck = d.documents ? Math.round(d.total / d.documents) : 0
            const payRows = d.payments || []
            const topItems = (d.items || []).slice(0, 5)
            const cityTotal = total(d.cities || [], 'total')
            return (
              <>
                <div
                  className={'kpi-grid ' + (regional ? 'cols-3' : 'cols-4')}
                  style={{border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-subtle)'}}
                >
                  <div className="kpi-item">
                    <span className="kpi-label">Сумма продаж</span>
                    <strong className="kpi-value">{money(d.total)}</strong>
                    <small className="kpi-meta">Средний чек: {d.documents ? money(avgCheck) : '—'}</small>
                  </div>
                  <div className="kpi-item">
                    <span className="kpi-label">Продано комплектов</span>
                    <strong className="kpi-value">{qty(d.quantity)}</strong>
                    <small className="kpi-meta">{regional ? 'Розничная реализация' : 'По всем выбранным складам'}</small>
                  </div>
                  <div className="kpi-item">
                    <span className="kpi-label">Документов</span>
                    <strong className="kpi-value">{number(d.documents)}</strong>
                    <small className="kpi-meta">Проведённые продажи</small>
                  </div>
                  {!regional && (
                    <div className="kpi-item">
                      <span className="kpi-label">Учётная стоимость</span>
                      <strong className="kpi-value">{money(d.cost)}</strong>
                      <small className="kpi-meta">Валовая разница: {money((d.total || 0) - (d.cost || 0))}</small>
                    </div>
                  )}
                </div>

                {(payRows.length > 0 || (!regional && d.cities.length > 0) || (regional && topItems.length > 0)) && (
                  <div className="grid-two">
                    {!regional && d.cities.length > 0 && (
                      <Card title="По складам">
                        <BreakdownBars
                          rows={d.cities}
                          totalValue={d.total}
                          keyFor={r => r.id}
                          labelFor={r => r.city}
                          metaFor={r => qty(r.quantity) + ' компл.'}
                          colorFor={() => 'sew'}
                          onSelect={r => state.change('warehouse', String(state.filters.warehouse) === String(r.id) ? '' : String(r.id))}
                        />
                      </Card>
                    )}
                    {payRows.length > 0 && (
                      <Card title="По способам оплаты">
                        <BreakdownBars
                          rows={payRows}
                          totalValue={d.total}
                          keyFor={r => r.payment}
                          labelFor={r => payments[r.payment] || r.payment}
                          metaFor={r => number(r.docs) + ' док.'}
                          colorFor={r => payBarClass[r.payment] || 'cut'}
                        />
                      </Card>
                    )}
                    {regional && topItems.length > 0 && (
                      <Card title="Популярные изделия">
                        <BreakdownBars
                          rows={topItems}
                          totalValue={d.total}
                          keyFor={r => r.id}
                          labelFor={itemText}
                          metaFor={r => qty(r.quantity) + ' компл.'}
                          colorFor={() => 'sew'}
                        />
                      </Card>
                    )}
                  </div>
                )}

                {!regional && d.cities.length > 0 && (
                  <Table
                    label="Сводка продаж по городам"
                    rows={d.cities}
                    footer={
                      <tr>
                        <td colSpan={2}><strong>Итого ({number(d.cities.length)} склад.)</strong></td>
                        <td className="right"><strong>{qty(d.quantity)}</strong></td>
                        <td className="right"><strong>{number(d.documents)}</strong></td>
                        <td className="right"><strong>100%</strong></td>
                        <td className="right"><strong>{money(d.total)}</strong></td>
                        <td className="right"><strong>{money(d.cost)}</strong></td>
                      </tr>
                    }
                    columns={[
                      {label: 'Город', cell: r => nowrap(r.city)},
                      {label: 'Склад', cell: r => <a href={href('/stock/' + r.id)}>{r.name}</a>},
                      {label: 'Комплектов', align: 'right', cell: r => qty(r.quantity)},
                      {label: 'Продаж', align: 'right', cell: r => number(r.docs)},
                      {
                        label: 'Доля',
                        align: 'right',
                        cell: r => number(cityTotal ? Math.round((r.total || 0) / cityTotal * 1000) / 10 : 0) + '%'
                      },
                      {label: 'Сумма', align: 'right', cell: r => <strong>{money(r.total)}</strong>},
                      {label: 'Учётная стоимость', align: 'right', cell: r => money(r.cost)}
                    ]}
                  />
                )}
              </>
            )
          }}
        </Guard>
      </Card>
      <Card title="Журнал продаж">
        <DocumentTable
          kind="sale"
          regional={regional}
          page={state.page}
          size={size}
          setPage={state.setPage}
          setSize={setSize}
          request={docsRequest}
          {...data}
        />
      </Card>
    </>
  )
}

export function RegionalRegister({kind}) {
  const {user} = useWorkspace()
  return (
    <Page
      title={kind === 'transfer' ? 'Приёмка' : 'Продажи'}
      subtitle={user.warehouse_name + ' · ' + user.city}
      actions={kind === 'sale' && <Button kind="primary" to="/sales/new">Новая продажа</Button>}
    >
      {kind === 'transfer' ? <DocumentRegister kind="transfer" regional/> : <SalesOverview regional/>}
    </Page>
  )
}

function GrantForm({rows, initial, close, done}) {
  const {warehouses} = useWorkspace()
  const state = useAction()
  const toast = useToast()
  const [data, set] = useState({
    staff_id: initial?.staff_id || '',
    warehouse_id: initial?.warehouse_id || '',
    email: '',
    password: ''
  })
  const person = rows.find(r => r.staff_id === Number(data.staff_id))

  return (
    <Dialog title={initial ? 'Изменить доступ' : 'Назначить доступ'} closeDisabled={state.busy} close={close}>
      <form onSubmit={e => {
        e.preventDefault()
        state.run(async () => {
          await api('/access', 'PUT', {
            staff_id: Number(data.staff_id),
            warehouse_id: Number(data.warehouse_id),
            ...(!person?.user_id ? {email: data.email, password: data.password} : {})
          })
          toast.success(initial ? 'Доступ к складу обновлён' : 'Доступ к складу назначен')
          done()
        })
      }}>
        <div className="form-grid">
          <Field label="Сотрудник">
            <SearchPicker
              disabled={Boolean(initial)}
              required
              placeholder="Выберите сотрудника"
              entries={rows
                .filter(r => r.staff_id === initial?.staff_id || (r.active && (!r.role || r.role === 'regional')))
                .map(r => [r.staff_id, r.name, false, r.position])}
              value={data.staff_id}
              onChange={e => set(f => ({...f, staff_id: e.target.value, email: '', password: ''}))}
            />
          </Field>
          <Field label="Склад">
            <SearchPicker
              required
              placeholder="Выберите склад"
              entries={warehouses.filter(w => w.kind === 'regional').map(w => [w.id, place(w), false, w.address])}
              value={data.warehouse_id}
              onChange={input(set, 'warehouse_id')}
            />
          </Field>
          {person && !person.user_id && (
            <>
              <Field label="Электронная почта">
                <input required type="email" value={data.email} onChange={input(set, 'email')}/>
              </Field>
              <Field label="Пароль" help="От 10 символов">
                <PasswordInput
                  required
                  autoComplete="new-password"
                  minLength="10"
                  maxLength="128"
                  value={data.password}
                  onChange={input(set, 'password')}
                />
              </Field>
            </>
          )}
        </div>
        <ErrorBox error={state.error}/>
        <FormActions busy={state.busy} cancel={close} submit={initial ? 'Сохранить изменения' : 'Назначить доступ'}/>
      </form>
    </Dialog>
  )
}

function WarehouseAccess({grant, setGrant}) {
  const {warehouses} = useWorkspace()
  const request = useRemote('/access')
  const toast = useToast()
  const state = useFilters('warehouse-access', {search: '', warehouse: ''})
  const {filters, change} = state
  const [remove, setRemove] = useState(null)

  return (
    <Guard request={request}>
      {staff => {
        const filtered = staff.filter(p =>
          p.role === 'regional'
          && (!filters.warehouse || p.warehouse_id === Number(filters.warehouse))
          && matchesSearch(filters.search, p.name, p.email, p.city)
        )
        return (
          <Card title="Назначения">
            <RegistryTools state={state} total={filtered.length} placeholder="Сотрудник, почта или город">
              <Field label="Склад" wide>
                <Select
                  placeholder="Все склады"
                  value={filters.warehouse}
                  onChange={e => change('warehouse', e.target.value)}
                  entries={warehouses.filter(w => w.kind === 'regional').map(w => [w.id, w.city])}
                />
              </Field>
            </RegistryTools>
            <Table
              rows={filtered}
              label="Назначения сотрудников"
              rowKey={r => r.staff_id}
              empty={filters.search || filters.warehouse ? 'Назначения по этому запросу не найдены' : 'Доступ к региональным складам пока не назначен'}
              columns={[
                {
                  label: 'Сотрудник',
                  width: '27%',
                  cell: r => (
                    <>
                      <strong>{r.name}</strong>
                      <small className="cell-secondary">{r.email}</small>
                    </>
                  )
                },
                {label: 'Склад', width: '14%', cell: r => nowrap(r.city || '—')},
                {label: 'Права', width: '29%', cell: r => r.active && r.warehouse_id ? 'Остатки, приёмка, продажи' : '—'},
                {
                  label: 'Статус',
                  width: '13%',
                  cell: r => (
                    <Status
                      value={r.active && r.warehouse_id ? 'posted' : 'inactive'}
                      label={r.active && r.warehouse_id ? 'Действует' : !r.active ? 'Уволен' : 'Нет доступа'}
                    />
                  )
                },
                {
                  label: 'Действия',
                  width: '17%',
                  cell: r => (
                    <div className="row-actions">
                      {r.active && <Button kind="ghost" size="small" onClick={() => setGrant(r)}>Изменить</Button>}
                      {r.warehouse_id && <Button kind="quiet-danger" size="small" onClick={() => setRemove(r)}>Отозвать</Button>}
                    </div>
                  )
                }
              ]}
            />
            {grant && (
              <GrantForm
                rows={staff}
                initial={grant === true ? null : grant}
                close={() => setGrant(false)}
                done={() => { request.refresh(); setGrant(false) }}
              />
            )}
            {remove && (
              <Confirm
                title="Отозвать доступ?"
                text={remove.name + ' больше не сможет войти на региональный склад.'}
                submit="Отозвать доступ"
                kind="danger"
                close={() => setRemove(null)}
                action={async () => {
                  await api('/access/' + remove.staff_id, 'DELETE')
                  toast.success('Доступ для ' + remove.name + ' отозван')
                  request.refresh()
                  setRemove(null)
                }}
              />
            )}
          </Card>
        )
      }}
    </Guard>
  )
}

const emptyLine = (key) => ({key, item_id: '', quantity: 1, price: ''})
const makeLines = (rows) => rows.map((l, i) => ({key: i, item_id: l.item_id, quantity: l.quantity / 1000, price: l.price / 100}))

function TransactionLines({lines, setLines, items, mode}) {
  const sale = mode === 'sale'
  const stocked = mode !== 'receipt'
  function setLine(key, props) { setLines(lines.map(l => l.key === key ? {...l, ...props} : l)) }
  function add() { setLines([...lines, emptyLine(Math.max(-1, ...lines.map(l => l.key)) + 1)]) }
  const used = lines.map(l => l.item_id)

  return (
    <div className="transaction-lines">
      {lines.map(l => {
        const item = items.find(x => x.id === l.item_id)
        const price = sale ? (item ? item.price / 100 : 0) : l.price
        const lineSum = Math.round((Number(price) || 0) * Number(l.quantity || 0) * 100)
        return (
          <div className={'transaction-line' + (lines.length > 1 ? ' can-remove' : '')} key={l.key}>
            <Field label={mode === 'receipt' ? 'Материал' : 'Товар'}>
              <SearchPicker
                required
                value={l.item_id}
                placeholder="Выберите позицию"
                entries={items
                  .filter(i => i.id === l.item_id || (!used.includes(i.id) && (!stocked || i.quantity > 0)))
                  .map(i => [
                    i.id,
                    mode === 'receipt' ? i.name : itemText(i),
                    false,
                    stocked
                      ? `${i.sku} · ост. ${qty(i.quantity)} ${i.unit}${sale ? ' · ' + money(i.price) : ''}`
                      : `${i.sku} · ${i.unit}`
                  ])}
                onChange={e => {
                  const id = Number(e.target.value)
                  const p = items.find(i => i.id === id)
                  setLine(l.key, {
                    item_id: id || '',
                    quantity: 1,
                    price: mode === 'transfer' && p?.quantity
                      ? Math.round(p.value * 1000 / p.quantity) / 100
                      : p?.price / 100 || ''
                  })
                }}
              />
            </Field>
            <Field label={'Количество' + (item ? ', ' + item.unit : '')}>
              <input
                required
                type="number"
                min={item?.unit === 'м' ? '.001' : '1'}
                step={item?.unit === 'м' ? '.001' : '1'}
                max={stocked && item ? Math.max(1, item.quantity / 1000) : 100000}
                value={l.quantity}
                onChange={e => setLine(l.key, {quantity: e.target.value})}
              />
            </Field>
            <Field label={sale ? 'Цена за комплект, ₽' : mode === 'transfer' ? 'Цена строки за ед., ₽' : 'Стоимость за ед., ₽'}>
              {sale
                ? <output className="control-output">{item ? money(item.price) : '—'}</output>
                : (
                  <input
                    required
                    type="number"
                    step=".01"
                    min=".01"
                    max="20000000"
                    value={price || ''}
                    onChange={e => setLine(l.key, {price: e.target.value})}
                  />
                )}
            </Field>
            <Field label="Сумма">
              <output className="control-output">{item || !sale ? money(lineSum) : '—'}</output>
            </Field>
            {lines.length > 1 && (
              <Button
                onClick={() => setLines(lines.filter(x => x.key !== l.key))}
                aria-label="Удалить позицию"
                className="icon-only"
                kind="quiet-danger"
              >
                ×
              </Button>
            )}
          </div>
        )
      })}
      {items.some(i => !used.includes(i.id) && (!stocked || i.quantity > 0)) && lines.every(l => l.item_id) && (
        <Button onClick={add}>Добавить позицию</Button>
      )}
    </div>
  )
}

function payloadLines(lines) {
  return lines.map(l => ({item_id: Number(l.item_id), quantity: l.quantity, price: l.price || 0}))
}

function TransactionEditor({mode, document, inventory}) {
  const ws = useWorkspace()
  const toast = useToast()
  const receipt = mode === 'receipt', sale = mode === 'sale'
  const [day, setDay] = useState(document?.date || ws.today)
  const [supplier, setSupplier] = useState(document?.supplier || '')
  const [reference, setReference] = useState(document?.reference || '')
  const [memo, setMemo] = useState(document?.memo || '')
  const [target, setTarget] = useState(document?.target_id || '')
  const [payment, setPayment] = useState('card')
  const [lines, setLines] = useState(() => document ? makeLines(document.lines) : [emptyLine(0)])
  const [requestKey] = useState(() => crypto.randomUUID())
  const [pending, setPending] = useState('')
  const state = useAction()

  const items = receipt ? ws.items.filter(i => i.kind === 'raw') : inventory.rows.map(r => ({...r, id: r.item_id}))
  const price = l => sale ? (items.find(i => i.id === l.item_id)?.price ?? 0) / 100 : Number(l.price || 0)
  const totalValue = lines.reduce((s, l) => s + Math.round(price(l) * Number(l.quantity || 0) * 100), 0)
  const title = sale
    ? 'Новая продажа'
    : receipt
      ? (document ? 'Поступление ' + document.code : 'Поступление сырья')
      : document ? 'Перемещение ' + document.code : 'Новое перемещение'
  const back = sale ? '/sales' : receipt ? '/stock/1' : '/stock/transfers'

  const hasOverdraw = sale && lines.some(l => {
    const i = items.find(x => x.id === l.item_id)
    return i && Number(l.quantity || 0) > i.quantity / 1000
  })

  const submit = async (post = true) => {
    let payload = {lines: payloadLines(lines), date: day, memo}
    if (receipt) payload = {...payload, supplier, reference}
    else if (sale) payload = {lines: payload.lines, payment, request_key: requestKey}
    else payload = {...payload, target_id: Number(target)}

    const url = sale ? '/sales' : (receipt ? '/receipts' : '/transfers') + (document ? '/' + document.id : '')
    const sending = pending === 'send'
    const response = await api(url + (sending ? '/send' : receipt ? '?post=' + post : ''), document && !sending ? 'PUT' : 'POST', payload)
    ws.refresh()
    setPending('')
    if (sale) toast.success('Продажа ' + response.code + ' оформлена')
    else if (receipt) toast.success(post ? 'Поступление ' + response.code + ' проведено' : 'Черновик поступления ' + response.code + ' сохранён')
    else toast.success(sending ? 'Перемещение ' + response.code + ' отправлено' : 'Черновик перемещения ' + response.code + ' сохранён')
    if (document) ws.refreshPage()
    go(sale ? '/sales/' + response.id : documentPath(response))
  }

  return (
    <Page
      title={title}
      subtitle={sale
        ? ws.user.warehouse_name + ' · ' + ws.user.city
        : (receipt ? 'Иваново · склад сырья' : 'Иваново · склад готовой продукции') + ' · ' + dayText(day)}
      actions={document && <Status value={document.status}/>}
    >
      <Card title={sale ? 'Товар и оплата' : receipt ? 'Поступление от поставщика' : 'Маршрут и товары'}>
        <form
          className="document-form"
          onSubmit={e => {
            e.preventDefault()
            if (hasOverdraw) return
            if (sale || (receipt && e.nativeEvent.submitter?.value !== 'draft')) setPending('post')
            else if (e.nativeEvent.submitter?.value === 'send') setPending('send')
            else state.run(() => submit(false))
          }}
        >
          {!sale && (
            <div className="form-grid route-fields">
              {receipt ? (
                <Field label="Поставщик">
                  <input required value={supplier} onChange={e => setSupplier(e.target.value)} maxLength="180" placeholder="Название поставщика"/>
                </Field>
              ) : (
                <Field label="Склад-получатель">
                  <SearchPicker
                    required
                    placeholder="Выберите склад"
                    value={target}
                    entries={ws.warehouses.filter(w => w.kind === 'regional').map(w => [w.id, place(w), false, w.address])}
                    onChange={e => setTarget(e.target.value)}
                  />
                </Field>
              )}
              <Field label={receipt ? 'Дата поступления' : 'Дата отправки'}>
                <DateControl
                  required
                  value={day}
                  min={ws.settings?.open_month && ws.settings.open_month + '-01'}
                  max={ws.today}
                  onChange={e => { if (e.target.value) setDay(e.target.value) }}
                />
              </Field>
              {receipt && (
                <Field label="Номер накладной" wide>
                  <input required maxLength="180" value={reference} onChange={e => setReference(e.target.value)} placeholder="Например: УПД № 1245"/>
                </Field>
              )}
            </div>
          )}

          <TransactionLines mode={mode} lines={lines} setLines={setLines} items={items}/>

          {sale && (
            <Field label="Способ оплаты">
              <Select value={payment} entries={payModes} onChange={e => setPayment(e.target.value)}/>
            </Field>
          )}

          <div className="document-total">
            <span>{sale ? 'К оплате' : 'Всего по документу'}</span>
            <strong>{money(totalValue)}</strong>
          </div>

          {!sale && !receipt && (
            <p className="inline-note info">
              Сумма накладной считается по цене строки; при отправке со склада в Иваново списывается фактическая учётная стоимость.
            </p>
          )}

          {sale && lines.some(l => l.item_id) && (
            <div className={hasOverdraw ? 'notice error' : 'inline-note info'}>
              {lines.filter(l => l.item_id).map(l => {
                const i = items.find(x => x.id === l.item_id)
                if (!i) return null
                const q = Number(l.quantity || 0)
                const rem = i.quantity / 1000 - q
                return (
                  <div key={l.key}>
                    {rem < 0
                      ? <>Недостаточно остатка «{itemText(i)}»: доступно {qty(i.quantity)} компл., указано {number(q)}.</>
                      : <>Доступно {qty(i.quantity)} компл. «{itemText(i)}». После продажи останется {number(rem)} компл.</>}
                  </div>
                )
              })}
            </div>
          )}

          {!sale && (
            <Field label="Комментарий (необязательно)">
              <textarea rows="3" maxLength="500" value={memo} onChange={e => setMemo(e.target.value)}/>
            </Field>
          )}

          <ErrorBox error={state.error}/>
          <ActionRow>
            <Button className="push-left" to={back}>Отмена</Button>
            {receipt && <Button type="submit" value="draft" disabled={state.busy}>Сохранить черновик</Button>}
            <Button type="submit" kind={document && !receipt ? 'secondary' : 'primary'} disabled={state.busy || hasOverdraw}>
              {sale ? 'Проверить продажу' : receipt ? 'Принять на склад' : 'Сохранить черновик'}
            </Button>
            {document && !receipt && (
              <Button type="submit" value="send" kind="primary" disabled={state.busy}>Подтвердить отправку</Button>
            )}
          </ActionRow>
        </form>
      </Card>

      {pending && (
        <Confirm
          close={() => setPending('')}
          title={sale ? 'Оформить продажу?' : receipt ? 'Провести поступление?' : 'Отправить перемещение?'}
          text={sale
            ? 'К оплате ' + money(totalValue) + '. Товары будут списаны со склада ' + ws.user.city + '.'
            : receipt
              ? 'Позиции из накладной будут зачислены на склад сырья.'
              : 'Товар будет списан в Иваново. Остатки склада назначения увеличатся после подтверждения получения.'}
          action={() => submit(true)}
          submit={sale ? 'Оформить продажу' : receipt ? 'Принять на склад' : 'Отправить'}
        />
      )}
    </Page>
  )
}

function ReceiveAction({document, refresh}) {
  const ws = useWorkspace()
  const toast = useToast()
  const [confirm, set] = useState(false)

  return (
    <>
      <Button kind="primary" onClick={() => set(true)}>Подтвердить получение</Button>
      {confirm && (
        <Confirm
          title="Подтвердить получение?"
          submit="Подтвердить получение"
          text="Проверьте фактическое количество каждой позиции. Подтверждение зачислит комплекты на ваш склад."
          close={() => set(false)}
          action={async () => {
            await api('/transfers/' + document.id + '/receive', 'POST')
            ws.refresh()
            toast.success('Приёмка ' + document.code + ' подтверждена')
            refresh()
            set(false)
          }}
        />
      )}
    </>
  )
}

function DocumentView({d}) {
  const ws = useWorkspace()
  const regional = ws.user.role === 'regional'
  const sale = d.kind === 'sale', transfer = d.kind === 'transfer', receipt = d.kind === 'receipt'
  const showBookValue = transfer && !regional && d.status !== 'draft'
  const title = (sale ? 'Продажа' : transfer ? (regional ? 'Приёмка' : 'Перемещение') : 'Поступление сырья') + ' ' + d.code
  const back = sale ? (regional ? '/sales' : '/stock/sales') : transfer ? (regional ? '/receiving' : '/stock/transfers') : '/stock/1'
  const at = useRemote(regional && transfer && d.status === 'in_transit' ? '/warehouses/' + ws.user.warehouse_id : null)

  const details = sale
    ? [
        ['Склад', d.source_name + ' · ' + d.source_city],
        ['Оплата', payments[d.payment]],
        ['Сотрудник', d.author]
      ]
    : transfer
      ? [
          ['Отправитель', d.source_name + ' · ' + d.source_city],
          ...(!regional ? [['Склад-получатель', d.target_name + ' · ' + d.target_city]] : []),
          ['Отправка', dayText(d.date)],
          ...(showBookValue ? [['Учётная стоимость списания', money(d.book_value)]] : [])
        ]
      : [
          ['Поставщик', d.supplier],
          ['Накладная', d.reference],
          ['Склад', d.target_name]
        ]

  return (
    <Page
      title={title}
      subtitle={sale ? d.source_city + ' · ' + dateTime(d.created_at) : transfer ? d.target_name + ' · ' + d.target_city : dayText(d.date)}
    >
      <Card
        className="print-document"
        title={sale ? 'Документ о продаже' : transfer ? 'Товары отправки' : 'Товары поступления'}
        actions={<Status value={d.status} label={sale ? 'Оформлена' : undefined}/>}
      >
        {receipt || !sale
          ? <Details values={details}/>
          : (
            <div className="print-heading">
              <h2>Документ о продаже {d.code}</h2>
              <p>{d.source_name} · {d.source_city} · {dateTime(d.created_at)}</p>
            </div>
          )}
        <Table
          rows={d.lines}
          label={sale ? 'Товары продажи' : 'Товары документа'}
          columns={[
            {label: receipt ? 'Материал' : 'Изделие', cell: r => r.name},
            ...(!receipt ? [{label: 'Размер', cell: r => nowrap(r.size)}] : []),
            {label: 'Количество', align: 'right', cell: r => qty(r.quantity) + ' ' + r.unit},
            {label: sale ? 'Цена за ед.' : transfer ? 'Цена строки за ед.' : 'Стоимость за ед.', align: 'right', cell: r => money(r.price)},
            {label: 'Сумма', align: 'right', cell: r => money(Math.round(r.price * r.quantity / 1000))},
            ...(showBookValue ? [{label: 'Учётная стоимость', align: 'right', cell: r => money(r.book_value)}] : []),
            ...(at.data ? [{
              label: 'После приёмки',
              align: 'right',
              cell: r => qty((at.data.rows.find(l => l.item_id === r.item_id)?.quantity || 0) + r.quantity) + ' компл.'
            }] : [])
          ]}
        />
        <div className="document-total">
          <span>{sale ? 'К оплате' : showBookValue ? 'Всего по документу' : 'Всего'}</span>
          <strong>{money(d.total)}</strong>
        </div>
        {showBookValue && (
          <p className="inline-note info">
            Сумма по строкам документа ({money(d.total)}) рассчитана по цене отправки; на баланс регионального склада приходуется учётная стоимость списания в Иваново ({money(d.book_value)}).
          </p>
        )}
        {sale && <Details values={details}/>}
        {d.memo && <p className="inline-note">{d.memo}</p>}
        {regional && transfer && d.status === 'in_transit' && (
          <p className="inline-note info">Сверьте количество каждой позиции перед подтверждением приёмки.</p>
        )}
        <ActionRow>
          <Button to={back} className="push-left">Назад</Button>
          {sale && <Button onClick={() => window.print()}>Распечатать</Button>}
          {regional && transfer && d.status === 'in_transit' && <ReceiveAction document={d} refresh={ws.refreshPage}/>}
        </ActionRow>
      </Card>
      <DocumentHistory document={d} hideCost={regional}/>
    </Page>
  )
}

export function TransactionRoute({mode, id}) {
  const ws = useWorkspace()
  const request = useRemote(id ? '/document/' + id : null)
  const inventory = useRemote(
    mode === 'sale' && !id
      ? '/warehouses/' + ws.user.warehouse_id
      : mode === 'transfer' && (!id || request.data?.status === 'draft')
        ? '/warehouses/5'
        : null
  )

  if (id) {
    return (
      <Guard request={request}>
        {d => {
          if (d.kind !== mode) return <ErrorBox error="Документ не найден."/>
          if (mode === 'receipt' && d.status === 'draft' && roleCanWrite(ws.user)) {
            return <TransactionEditor key={d.id + '-' + d.updated_at} mode={mode} document={d}/>
          }
          if (mode === 'transfer' && d.status === 'draft' && roleCanWrite(ws.user)) {
            return (
              <Guard request={inventory}>
                {w => <TransactionEditor key={d.id + '-' + d.updated_at} mode={mode} document={d} inventory={w}/>}
              </Guard>
            )
          }
          return <DocumentView key={d.id + '-' + d.status} d={d}/>
        }}
      </Guard>
    )
  }

  if (mode === 'sale' && ws.user.role !== 'regional') {
    return <ErrorBox error="Оформление продажи доступно только сотруднику регионального склада."/>
  }
  if ((mode === 'receipt' || mode === 'transfer') && !roleCanWrite(ws.user)) {
    return <ErrorBox error="Создание документа недоступно для вашей роли."/>
  }
  if (mode === 'receipt') return <TransactionEditor mode={mode}/>
  return <Guard request={inventory}>{w => <TransactionEditor mode={mode} inventory={w}/>}</Guard>
}

export function RawMaterial({id}) {
  const {today} = useWorkspace()
  const stock = useRemote('/warehouses/1')

  return (
    <Guard request={stock}>
      {d => {
        const material = d.rows.find(r => r.item_id === id)
        if (!material) return <ErrorBox error="Материал не найден."/>
        return (
          <Page title={material.name} subtitle={'Склад сырья · остатки на ' + dayText(today)}>
            <Card title="Остаток материала">
              <Table
                label="Остаток материала"
                rows={[material]}
                columns={[
                  {label: 'Материал', cell: r => r.name},
                  {label: 'Единица', cell: r => r.unit},
                  {label: 'На начало дня', align: 'right', cell: r => qty(r.quantity - r.incoming + r.outgoing) + ' ' + r.unit},
                  {label: 'Поступило', align: 'right', cell: r => qty(r.incoming) + ' ' + r.unit},
                  {label: 'Списано', align: 'right', cell: r => qty(r.outgoing) + ' ' + r.unit},
                  {label: 'Остаток', align: 'right', cell: r => <strong>{qty(r.quantity)} {r.unit}</strong>},
                  {label: 'Учётная стоимость', align: 'right', cell: r => money(r.value)}
                ]}
              />
            </Card>
            <Card title="Движения материала">
              <StockHistory id={1} material={id}/>
            </Card>
            <div className="left-actions">
              <Button to="/stock/1">Назад на склад</Button>
            </div>
          </Page>
        )
      }}
    </Guard>
  )
}
