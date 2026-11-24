# Карта визуального контроля качества (Visual Map)

Документ фиксирует сквозной визуальный, адаптивный и ролевой аудит интерфейса «Швейная фабрика» после полного UX/UI редизайна (разделённые мобильные карточки, плоские формы, отдельная страница `#/more`, одноколоночный вход и единые итоги).

- **Контуры проверки:** Mobile `390×844 @2x` и `360×800 @2x`; Desktop `1440×900` и `1280×900` + `@media print`.
- **Роли:** `admin` (`Ирина В.`), `accountant` (`Оксана Е.`), `master` (`Сергей С.`), `regional` (`Москва`, `Санкт-Петербург`).
- **Стенд проверки:** изолированная база `/tmp/sf_redesign_qa.sqlite3` (`ops/render/build_seed.py`), отдельный QA-сервер `127.0.0.1:8099` (`data/factory.sqlite3` не затрагивалась).
- **Архитектура редизайна (`web/`):**
  - **Разделённые карточки (`DataCard` / `SummaryCard`)**: на `<= 768px` все реестры и таблицы переведены с монолитной обёртки `.table-frame.mobile-cards` на `.mobile-card-list` (`gap: 10px`) с самостоятельными белыми карточками `.data-card` и лавандовой карточкой итогов `SummaryCard` (`.data-card-summary`); на десктопе `>= 769px` сохранены чистые `<table>`.
  - **Плоские формы и документы (`.form-flat`, `.doc-view-flat`)**: убраны внешние `.surface-panel` вокруг форм (`#/reports/new`, `#/reports/:id`, `#/stock/receipts/new`, `#/stock/transfers/new`, `#/sales/new`, `#/catalog/new`, `#/profile`) и документов просмотра на мобильном (`DocumentView`), `0` вложенных рамок.
  - **Навигация и состояния**: вместо шторки `MoreSheet` внедрена полноценная страница `#/more` (`MorePage`) для всех ролей; `Login` переведён в чистый одноколоночный центрированный формат без фиолетового блока `.login-description`; `AccessDenied` и `NotFound` сведены к минималистичному `.minimal-state`; удалены дублирующие кнопки «Назад» в теле экранов; `PwaInstallGuide` автоматически закрывается при смене маршрута.
  - **Секции, фильтры и документы**: `RegistryTools` поддерживает `periodPlacement="header"` (строка периода под тулбаром в `#/payroll`, `#/people/:id`, `#/stock/1/items/:id`, продажах); `DocumentHistory` выводит заголовок, счётчик и «Развернуть/Свернуть» в одну строку; на `#/stock` блок «Внутренние запасы · Иваново» вынесен наверх до «Склады по городам», а вкладки склада сокращены до `Остатки` / `Движения` / `Поступления`; `useAnchoredPopover` ограничивает `.picker-menu` внутри `dialog[open]` выше `.dialog-footer` с зазором `8px`.

---

## Матрица покрытия и оценок (Финал редизайна — Раунд 2)

| Поток | Охваченные экраны, вкладки, модалки и роли | Вьюпорты | Проверок | Итог |
| --- | --- | --- | ---: | --- |
| **Rows 1–5 (Mobile QA 1)** | `#/` (Login без фиолетового блока), `#/more` (`admin`/`regional`), `PwaInstallGuide`, `OfflineBanner`, `AccessDenied`, `NotFound`; `#/overview` (с данными/пустой/календарь); `#/reports`, `#/reports/new`, черновик `ОС-001488` (Выработка / Материалы / Оплата смены: `DataCard` распределения без наложений + full-width «Назначить исполнителя» + «Грузчик»), проведённый `ОС-001485`, движения и все 5 модалок ОС (`SearchPicker` с зазором `8px` над футером); `#/stock` («Внутренние запасы · Иваново» сверху), `#/stock/1` (`Остатки`/`Движения`/`Поступления` без обрезки), `#/stock/1/items/1`, `#/stock/receipts/new` (`.form-flat`), `ПС-000253` (`.doc-view-flat`, «Реквизиты поступления», `SummaryCard`) | `390×844 @2x`, `360×800 @2x` | **64 / 64** | **10/10** (`0` дефектов) |
| **Rows 6–10 (Mobile QA 2)** | `#/stock/5`, `#/stock/transfers`, `#/stock/transfers/new` (`.form-flat`), `#/stock/transfers/:id` (`.doc-view-flat`), `#/stock/sales`, `#/sales/new`, `#/sales/:id` (`SummaryCard` без лишней линии), `#/stock/access`; `#/catalog`, `#/catalog/new` (`.form-flat`), `#/catalog/100` (Спецификация + Техкарта + `NewMaterialDialog`); `#/people`, `#/people/59` (Фарид Хамиди: сдельная + грузчик + проезд + 2 `SummaryCard`), `#/payroll` (7 колонок / мобильные карточки + модалка корректировки на 1-м экране `390×844`); `#/month` (Выпуск + Себестоимость); `#/profile` (`.form-flat`, полноширинные кнопки `.form-actions`); роли `moscow` (`#/`, `#/more`, `#/receiving`, `#/receiving/:id`, `#/sales`, `#/sales/new`, `#/sales/:id`) и `master` (`#/`, `#/more`, `#/stock`, `#/payroll` → `AccessDenied`) | `390×844 @2x`, `360×800 @2x` | **62 / 62** | **10/10** (`0` дефектов) |
| **Desktop QA + Print (`visual-qa`)** | `#/` Login, `#/overview`, `#/reports`, черновик `ОС-001488`, проведённый `ОС-001485`, `#/stock`, `#/stock/receipts/new` (`.form-flat`, ровная линия над `2×225px` `.action-pair`), `ПС-000253`, `#/payroll`, `#/catalog/new` (`.form-flat`, `2×225px` `.action-pair`), `#/profile`, `#/sales/:id` + `@media print` чека продажи (`sidebarHidden: true`, `topbarHidden: true`, `visiblePrintButtons: 0`) | `1440×900`, `1280×900` | **24 / 24** + print | **10/10** (`0` дефектов) |
| **Ролевой и регрессионный аудит (`role-auditor`)** | `pytest` (22 теста), все 5 аккаунтов (`admin`, `accountant`, `master`, `moscow`, `petersburg`), `#/more`, `AccessDenied` / `NotFound`, автозакрытие `PwaInstallGuide` при смене маршрута, вкладки `#/stock/1` и `#/regional`, сквозной write-E2E (отчёт «грузчик» 30 мин → проведение → ведомость + 13% НДФЛ → 7-колоночный Excel → выход через `#/more`) | API + Mobile `390`/`360` | **22 pytest** + E2E | **10/10** (`0` дефектов) |

---

## История исправлений редизайна (Раунд 1 → Раунд 2)

1. **Однострочные `SummaryCard`** (`web/style.css`): `border-top` применяется только к `.data-card-summary-row.is-strong:not(:first-child)` — убрана лишняя верхняя черта в `ПС-000253`, `#/sales/:id`, `#/receiving/:id`, `#/month` («Себестоимость»).
2. **Ghost-действия в `.section-head`** (`web/style.css`): на `<= 640px` ссылки «Все за день» и «Открыть склады» на `#/overview` остаются в одну строку справа от заголовка (вертикальный стек только для не-ghost кнопок).
3. **Вкладки склада без обрезки** (`web/warehouse.jsx`): в `WarehouseDetail` сокращены до `Остатки` / `Движения` / `Поступления` (`390px`: `sw=362/cw=362`, `360px`: `sw=332/cw=332`).
4. **`SearchPicker` внутри диалогов** (`web/ui.jsx`, `web/style.css`): `useAnchoredPopover` на `<= 768px` вычисляет верх `.dialog-footer` / `.sheet-footer` и ограничивает `maxHeight` с зазором `8px` над кнопками «Отмена / Сохранить».
5. **`PwaInstallGuide`** (`web/main.jsx`): автоматическое закрытие при изменении маршрута `path`.
6. **Формы и кнопки** (`web/style.css`, `web/production.jsx`, `web/warehouse.jsx`, `web/directory.jsx`):
   - На десктопе `.action-pair` (`2×225px`) больше не обрезает верхний `border-top` в `#/stock/receipts/new` и не растягивается на `1136px` в `#/catalog/new`.
   - На мобильном в `#/profile` кнопки под ставкой грузчика переведены в `.form-actions` (`100%` ширины); в `ReportEditor` кнопка «Назначить исполнителя» получила `.mobile-full-action`; в `TransactionLines` поле «Сумма» при одной строке занимает всю ширину.
   - Убрана двойная точка `шт..` в уведомлении на вкладке «Материалы» черновика.
   - Заголовок мобильного `DocumentView` `DataCard` переведён на чистые структурные подписи (`Реквизиты поступления`, `Маршрут перемещения`, `Детали продажи`), а `.card-title h2` на мобильном выровнен до `16px`.

---

## Финальная верификация сборки и инвариантов
- **Статика `web/`:** `0` `<select>`, `0` `<details>`/`<summary>`, `0` «ШФ», `0` `.table-frame.mobile-cards`, `0` `.login-description`.
- **Сборка:** `npm run build` — **OK за `977ms`** (`dist/assets/index-D6TFYUwZ.js` `477.02 kB` / gzip `137.92 kB`, `dist/assets/index-CuZ78DFb.css` `97.56 kB` / gzip `18.28 kB`).
- **Бэкенд-тесты:** `uv run pytest -q` — **22 passed**.
- **DOM и консоль по всем 150 снимкам (`64 + 62 + 24`):** `0` `consoleErrors`, `0` `pageErrors`, `0` `overflowX`, `0` `mergedCards`, `0` `nestedBoxes`, `0` `textOverlap`, `0` `redundantBackButtons`, `0` `emptyCardActions`.
