"""Posting, costing and audit history shared by interactive and initial records."""

from datetime import date

from .db import STAGES, WAREHOUSES, line_cost, now, record, records, rounded, scalar, to_units, today

PREFIXES = {"report": "ОС", "receipt": "ПС", "transfer": "ПМ", "sale": "ПР", "opening": "ОВ"}
STOCK_SHORTAGE = "Недостаточно остатка"


class RuleViolation(Exception):
    def __init__(self, message, status=409):
        self.message = message
        self.status = status


def required(db, table, item_id):
    row = record(db, f"SELECT * FROM {table} WHERE id = ?", (item_id,))
    if not row:
        raise RuleViolation("Запись не найдена", 404)
    return row


def event(db, doc_id, actor, at, action, memo=""):
    db.execute(
        "INSERT INTO events(doc_id,actor_id,happened_at,action,memo) VALUES(?,?,?,?,?)",
        (doc_id, actor, at, action, memo),
    )


def new_document(db, kind, day, actor, at, **kwargs):
    doc_id = scalar(db, "SELECT COALESCE(MAX(id),0)+1 FROM documents")
    seq = scalar(db, "SELECT COUNT(*)+1 FROM documents WHERE kind = ?", (kind,))
    keys = ["id", "code", "kind", "date", "author_id", "created_at", "updated_at", "status", *kwargs]
    values = [doc_id, f"{PREFIXES[kind]}-{seq:06}", kind, day, actor, at, at, "draft", *kwargs.values()]
    db.execute(f"INSERT INTO documents({','.join(keys)}) VALUES({','.join('?' for _ in keys)})", values)
    event(db, doc_id, actor, at, "created")
    return doc_id


def past_day(day):
    if str(day) > today():
        raise RuleViolation("Дата не может быть позже сегодняшнего дня", 422)


def check_period(db, day):
    past_day(day)
    period = record(db, "SELECT value FROM settings WHERE key = 'open_month'")
    if period and str(day)[:7] < period["value"]:
        raise RuleViolation(f"Учётный период закрыт. Изменения доступны с {period['value']}.", 422)


def balance(db, warehouse, item_id):
    row = record(db, "SELECT quantity,value FROM balances WHERE warehouse_id=? AND item_id=?", (warehouse, item_id))
    return (row["quantity"], row["value"]) if row else (0, 0)


def movement(db, doc, warehouse, item_id, quantity, value, at, operation):
    current, total = balance(db, warehouse, item_id)
    final = current + quantity
    money = total + value
    if final < 0:
        item = required(db, "items", item_id)
        place = required(db, "warehouses", warehouse)
        raise RuleViolation(f"{STOCK_SHORTAGE}: {item['name']} · {place['name']}. Доступно {current / 1000:g} {item['unit']}.")
    if money < 0 or (final == 0 and money != 0):
        raise RuleViolation("Движение нельзя провести с текущей учётной стоимостью")
    db.execute(
        """INSERT INTO balances VALUES(?,?,?,?) ON CONFLICT(warehouse_id,item_id)
           DO UPDATE SET quantity=excluded.quantity,value=excluded.value""",
        (warehouse, item_id, final, money),
    )
    db.execute(
        """INSERT INTO movements(warehouse_id,item_id,doc_id,happened_at,operation,quantity,value)
           VALUES(?,?,?,?,?,?,?)""",
        (warehouse, item_id, doc, at, operation, quantity, value),
    )


def withdraw(db, doc, warehouse, item_id, quantity, at, operation):
    current, value = balance(db, warehouse, item_id)
    cost = rounded(value * quantity, current) if current >= quantity else 0
    movement(db, doc, warehouse, item_id, -quantity, -cost, at, operation)
    return cost


def set_status(db, doc, status, actor, at, memo=""):
    db.execute("UPDATE documents SET status=?, updated_at=? WHERE id=?", (status, at, doc))
    event(db, doc, actor, at, status, memo)


def get_document(db, doc_id, kind=None):
    doc = required(db, "documents", doc_id)
    if kind and doc["kind"] != kind:
        raise RuleViolation("Документ не найден", 404)
    return doc


def set_lines(db, doc_id, lines, item_kind, price_source=False):
    seen = set()
    for line in lines:
        item = required(db, "items", line.item_id)
        if item["kind"] != item_kind or item["id"] in seen:
            raise RuleViolation("Выберите подходящие позиции без повторов", 422)
        seen.add(item["id"])
        qty = to_units(line.quantity)
        if item["unit"] not in ("м", "кг") and qty % 1000:
            raise RuleViolation(f"Для позиции «{item['name']}» укажите целое количество", 422)
        price = (to_units(line.price, 100) if line.price > 0 else item["price"]) if price_source else to_units(line.price, 100)
        if price <= 0:
            raise RuleViolation("Укажите стоимость за единицу товара", 422)
        db.execute("INSERT INTO lines(doc_id,item_id,quantity,price) VALUES(?,?,?,?)", (doc_id, item["id"], qty, price))


def doc_lines(db, doc_id):
    return records(db, "SELECT * FROM lines WHERE doc_id=? ORDER BY id", (doc_id,))


def latest_spec(db, item_id, day):
    spec = record(
        db, "SELECT * FROM specs WHERE product_id=? AND effective<=? ORDER BY version DESC LIMIT 1", (item_id, str(day))
    )
    if not spec:
        raise RuleViolation("На дату отчёта для изделия нет действующей спецификации", 422)
    return spec


def populate_report(db, doc_id, payload):
    seen = set()
    for row in payload.lines:
        item = required(db, "items", row.item_id)
        if item["kind"] != "product" or item["id"] in seen:
            raise RuleViolation("Выберите готовые изделия без повторов", 422)
        if payload.stage != "pack" and row.prepared:
            raise RuleViolation("Передача в упаковку доступна только в отчёте упаковки", 422)
        seen.add(item["id"])
        spec = latest_spec(db, item["id"], payload.date)
        rate = scalar(db, "SELECT amount FROM rates WHERE spec_id=? AND stage=?", (spec["id"], payload.stage))
        line = db.execute(
            "INSERT INTO lines(doc_id,item_id,quantity,spec_id,prepared) VALUES(?,?,?,?,?)",
            (doc_id, item["id"], row.quantity * 1000, spec["id"], row.prepared * 1000),
        ).lastrowid
        workers = set()
        for a in row.assignments:
            person = required(db, "staff", a.staff_id)
            if not person["active"] or person["stage"] != payload.stage or a.staff_id in workers:
                raise RuleViolation("Укажите действующих исполнителей выбранного этапа без повторов", 422)
            if person["hired_on"] > str(payload.date):
                raise RuleViolation(f"{person['name']} ещё не работал на дату отчёта", 422)
            workers.add(a.staff_id)
            db.execute("INSERT INTO assignments(line_id,staff_id,quantity,rate) VALUES(?,?,?,?)", (line, a.staff_id, a.quantity * 1000, rate))
        if sum(a.quantity for a in row.assignments) > row.quantity:
            raise RuleViolation("Распределено больше комплектов, чем указано в выработке", 422)
        for material in records(db, "SELECT * FROM norms WHERE spec_id=? AND stage=?", (spec["id"], payload.stage)):
            db.execute(
                "INSERT INTO material_snapshots(line_id,item_id,norm,quantity) VALUES(?,?,?,?)",
                (line, material["item_id"], material["quantity"], material["quantity"] * row.quantity),
            )


def save_report(db, payload, actor, doc_id=None, at=None, historical=False, role=None):
    at = at or now()
    day = str(payload.date)
    if not historical:
        check_period(db, day)
    source_wh = payload.source_id or WAREHOUSES["raw"]
    place = required(db, "warehouses", source_wh)
    if role == "master" and place["kind"] == "regional":
        raise RuleViolation("Выбранный склад недоступен для мастера смены", 403)
    if doc_id is None:
        doc_id = new_document(db, "report", day, actor, at, stage=payload.stage, shift=payload.shift, source_id=source_wh, memo=payload.memo)
    else:
        doc = get_document(db, doc_id, "report")
        if doc["status"] != "draft":
            raise RuleViolation("Проведённый отчёт редактируется через исправление")
        db.execute("DELETE FROM assignments WHERE line_id IN (SELECT id FROM lines WHERE doc_id=?)", (doc_id,))
        db.execute("DELETE FROM material_snapshots WHERE line_id IN (SELECT id FROM lines WHERE doc_id=?)", (doc_id,))
        db.execute("DELETE FROM lines WHERE doc_id=?", (doc_id,))
        db.execute("UPDATE documents SET date=?,stage=?,shift=?,source_id=?,memo=?,updated_at=? WHERE id=?", (day,payload.stage,payload.shift,source_wh,payload.memo,at,doc_id))
        event(db, doc_id, actor, at, "updated")
    populate_report(db, doc_id, payload)
    return doc_id


def post_report(db, doc_id, actor, at=None, historical=False):
    at = at or now()
    doc = get_document(db, doc_id, "report")
    if doc["status"] != "draft":
        raise RuleViolation("Отчёт уже проведён или исправлен")
    if not historical:
        check_period(db, doc["date"])
    stage = doc["stage"]
    source_wh = doc["source_id"] or WAREHOUSES["raw"]
    for line in doc_lines(db, doc_id):
        item_id, quantity = line["item_id"], line["quantity"]
        workers = records(db, """
            SELECT a.*,s.active,s.stage FROM assignments a JOIN staff s ON s.id=a.staff_id WHERE line_id=?""", (line["id"],))
        if sum(a["quantity"] for a in workers) != quantity:
            name = required(db, "items", item_id)["name"]
            raise RuleViolation(f"Распределите всю выработку «{name}» между исполнителями")
        if any(not a["active"] or a["stage"] != stage for a in workers):
            raise RuleViolation("В отчёте есть сотрудник, который больше не работает на выбранном этапе")
        cost = sum(line_cost(a["quantity"], a["rate"]) for a in workers)
        for m in records(db, "SELECT * FROM material_snapshots WHERE line_id=?", (line["id"],)):
            used = withdraw(db, doc_id, source_wh, m["item_id"], m["quantity"], at, "material")
            cost += used
            db.execute("UPDATE material_snapshots SET value=? WHERE line_id=? AND item_id=?", (used, line["id"], m["item_id"]))
        if stage == "sew":
            cost += withdraw(db, doc_id, WAREHOUSES["cut"], item_id, quantity, at, "stage_use")
        if stage == "pack":
            if line["prepared"]:
                entering = withdraw(db, doc_id, WAREHOUSES["sew"], item_id, line["prepared"], at, "packing_sent")
                movement(db, doc_id, WAREHOUSES["pack"], item_id, line["prepared"], entering, at, "packing_received")
            cost += withdraw(db, doc_id, WAREHOUSES["pack"], item_id, quantity, at, "stage_use")
        destination = WAREHOUSES["finished" if stage == "pack" else stage]
        movement(db, doc_id, destination, item_id, quantity, cost, at, "production")
        db.execute("UPDATE lines SET book_value=? WHERE id=?", (cost, line["id"]))
    set_status(db, doc_id, "posted", actor, at)


def correct_report(db, doc_id, actor, reason):
    doc = get_document(db, doc_id, "report")
    if doc["status"] != "posted":
        raise RuleViolation("Исправление доступно для проведённого отчёта")
    check_period(db, doc["date"])
    at = now()
    # Reverse in reverse order so the internal packaging movement cancels correctly.
    for m in records(db, "SELECT * FROM movements WHERE doc_id=? ORDER BY id DESC", (doc_id,)):
        movement(db, doc_id, m["warehouse_id"], m["item_id"], -m["quantity"], -m["value"], at, "correction")
    set_status(db, doc_id, "corrected", actor, at, reason)
    replacement = new_document(db, "report", doc["date"], actor, at, stage=doc["stage"], shift=doc["shift"], source_id=doc["source_id"], memo=reason, source_doc=doc_id)
    for line in doc_lines(db, doc_id):
        new_line = db.execute(
            "INSERT INTO lines(doc_id,item_id,quantity,spec_id,prepared) VALUES(?,?,?,?,?)",
            (replacement, line["item_id"], line["quantity"], line["spec_id"], line["prepared"]),
        ).lastrowid
        db.execute("INSERT INTO assignments(line_id,staff_id,quantity,rate) SELECT ?,staff_id,quantity,rate FROM assignments WHERE line_id=?", (new_line, line["id"]))
        db.execute("INSERT INTO material_snapshots(line_id,item_id,norm,quantity) SELECT ?,item_id,norm,quantity FROM material_snapshots WHERE line_id=?", (new_line, line["id"]))
    return replacement


def save_receipt(db, payload, actor, at=None, historical=False, post=True, doc_id=None):
    at = at or now()
    target_wh = payload.target_id or WAREHOUSES["raw"]
    required(db, "warehouses", target_wh)
    if not historical:
        check_period(db, payload.date)
        existing=record(db,"""
            SELECT code FROM documents WHERE kind='receipt' AND id!=?
              AND search_text(trim(supplier))=search_text(trim(?)) AND search_text(trim(reference))=search_text(trim(?))
        """,(doc_id or 0,payload.supplier,payload.reference))
        if existing:
            raise RuleViolation(f"Накладная уже добавлена в поступлении {existing['code']}")
    if doc_id is None:
        doc_id = new_document(db, "receipt", str(payload.date), actor, at, target_id=target_wh,
                              memo=payload.memo, supplier=payload.supplier, reference=payload.reference)
    else:
        doc = get_document(db, doc_id, "receipt")
        if doc["status"] != "draft":
            raise RuleViolation("Редактировать можно только черновик поступления")
        db.execute("DELETE FROM lines WHERE doc_id=?", (doc_id,))
        db.execute("UPDATE documents SET date=?,target_id=?,memo=?,supplier=?,reference=?,updated_at=? WHERE id=?",
                   (str(payload.date),target_wh,payload.memo,payload.supplier,payload.reference,at,doc_id))
        event(db, doc_id, actor, at, "updated")
    set_lines(db, doc_id, payload.lines, "raw")
    if post:
        for line in doc_lines(db, doc_id):
            movement(db, doc_id, target_wh, line["item_id"], line["quantity"],
                     line_cost(line["quantity"], line["price"]), at, "receipt")
        set_status(db, doc_id, "posted", actor, at)
    return doc_id


def save_transfer(db, payload, actor, doc_id=None, at=None):
    at = at or now()
    target = required(db, "warehouses", payload.target_id)
    if target["kind"] != "regional":
        raise RuleViolation("Выберите региональный склад", 422)
    if doc_id is None:
        doc_id = new_document(db, "transfer", str(payload.date), actor, at, source_id=WAREHOUSES["finished"], target_id=target["id"], memo=payload.memo)
    else:
        doc = get_document(db, doc_id, "transfer")
        if doc["status"] != "draft":
            raise RuleViolation("Редактировать можно только черновик перемещения")
        db.execute("DELETE FROM lines WHERE doc_id=?", (doc_id,))
        db.execute("UPDATE documents SET target_id=?,memo=?,date=?,updated_at=? WHERE id=?", (target["id"], payload.memo, str(payload.date), at, doc_id))
        event(db, doc_id, actor, at, "updated")
    set_lines(db, doc_id, payload.lines, "product")
    return doc_id


def send_transfer(db, doc_id, actor, at=None, historical=False):
    at = at or now()
    doc = get_document(db, doc_id, "transfer")
    if doc["status"] != "draft":
        raise RuleViolation("Отправка уже зарегистрирована")
    if not historical:
        check_period(db, doc["date"])
    for line in doc_lines(db, doc_id):
        cost = withdraw(db, doc_id, doc["source_id"], line["item_id"], line["quantity"], at, "transfer_out")
        db.execute("UPDATE lines SET book_value=? WHERE id=?", (cost, line["id"]))
    set_status(db, doc_id, "in_transit", actor, at)


def receive_transfer(db, doc_id, actor, at=None):
    at = at or now()
    doc = get_document(db, doc_id, "transfer")
    if doc["status"] != "in_transit":
        raise RuleViolation("Подтвердить можно только перемещение в пути")
    for line in doc_lines(db, doc_id):
        movement(db, doc_id, doc["target_id"], line["item_id"], line["quantity"], line["book_value"], at, "transfer_in")
    set_status(db, doc_id, "received", actor, at)


def save_sale(db, payload, actor, warehouse, at=None):
    at = at or now()
    existing = record(db, "SELECT id,payment,memo FROM documents WHERE kind='sale' AND source_id=? AND author_id=? AND reference=?", (warehouse, actor, payload.request_key))
    if existing:
        saved = doc_lines(db, existing["id"])
        expected = [
            (l.item_id, to_units(l.quantity), to_units(l.price, 100) if l.price > 0 else required(db, "items", l.item_id)["price"])
            for l in payload.lines
        ]
        if existing["payment"] != payload.payment or existing["memo"] != payload.memo or [(l["item_id"], l["quantity"], l["price"]) for l in saved] != expected:
            raise RuleViolation("Новая продажа требует нового подтверждения")
        return existing["id"]
    place = required(db, "warehouses", warehouse)
    if place["kind"] not in ("regional", "finished"):
        raise RuleViolation("Продажа доступна только со склада готовой продукции или регионального склада", 422)
    doc_id = new_document(db, "sale", at[:10], actor, at, source_id=warehouse, payment=payload.payment, reference=payload.request_key, memo=payload.memo)
    set_lines(db, doc_id, payload.lines, "product", price_source=True)
    for line in doc_lines(db, doc_id):
        cost = withdraw(db, doc_id, warehouse, line["item_id"], line["quantity"], at, "sale")
        db.execute("UPDATE lines SET book_value=? WHERE id=?", (cost, line["id"]))
    set_status(db, doc_id, "posted", actor, at)
    return doc_id


def save_recipe(db, item_id, payload, effective=None):
    item = required(db, "items", item_id)
    if item["kind"] != "product":
        raise RuleViolation("Спецификация создаётся только для изделия", 422)
    effective = effective or today()
    version = scalar(db, "SELECT COALESCE(MAX(version),0)+1 FROM specs WHERE product_id=?", (item_id,))
    sid = db.execute("INSERT INTO specs(product_id,version,effective) VALUES(?,?,?)", (item_id,version,effective)).lastrowid
    seen = set()
    for norm in payload.norms:
        material = required(db, "items", norm.item_id)
        key = (norm.item_id, norm.stage)
        q = to_units(norm.quantity)
        if material["kind"] != "raw" or key in seen or (material["unit"] not in ("м", "кг") and q % 1000):
            raise RuleViolation("Нормы должны содержать уникальные материалы по этапам и подходящие единицы", 422)
        seen.add(key)
        db.execute("INSERT INTO norms VALUES(?,?,?,?)", (sid,norm.item_id,norm.stage,q))
    for stage in STAGES:
        db.execute("INSERT INTO rates VALUES(?,?,?)", (sid,stage,to_units(getattr(payload,stage),100)))
    return sid
