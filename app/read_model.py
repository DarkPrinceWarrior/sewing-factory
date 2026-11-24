"""Queries for the registers, dashboards and document cards."""
from calendar import monthrange

from .db import line_cost, record, records, scalar, search_text, today
from .operations import RuleViolation, get_document

ROLE_NAMES = {"admin":"Администратор","accountant":"Бухгалтер","master":"Мастер смены","regional":"Сотрудник склада"}
STATUS = {"draft":"Черновик","posted":"Проведён","in_transit":"В пути","received":"Получено","corrected":"Исправлен"}
STAGE_NAME = {"cut":"Раскрой","sew":"Пошив","pack":"Упаковка","warehouse":"Склад","office":"Управление"}
KIND = {"report":"Отчёт за смену","receipt":"Поступление сырья","transfer":"Перемещение","sale":"Продажа","opening":"Начальные остатки"}

BASE_DOC = """
    SELECT d.id,d.kind,d.code,d.status,d.date,d.created_at,d.updated_at,d.stage,d.shift,
           COALESCE(d.source_id, CASE WHEN d.kind='report' THEN 1 END) source_id,d.target_id,
           u.name author, d.supplier,d.reference,d.payment, sw.city source_city, sw.name source_name, tw.city target_city, tw.name target_name,
           d.source_doc, src.code source_code, rep.id replacement_id, rep.code replacement_code,
           COALESCE(l.quantity,0) quantity,COALESCE(l.total,0) total,COALESCE(l.cost,0) book_value,
           COALESCE(wages.amount,0)+COALESCE(hw.amount,0) wages,COALESCE(hw.minutes,0) hourly_minutes
      FROM documents d JOIN users u ON u.id=d.author_id
      LEFT JOIN warehouses sw ON sw.id=COALESCE(d.source_id, CASE WHEN d.kind='report' THEN 1 END)
      LEFT JOIN warehouses tw ON tw.id=d.target_id
      LEFT JOIN documents src ON src.id=d.source_doc
      LEFT JOIN (SELECT source_doc, MAX(id) id, MAX(code) code FROM documents WHERE source_doc IS NOT NULL GROUP BY source_doc) rep ON rep.source_doc=d.id
      LEFT JOIN (SELECT doc_id,SUM(quantity) quantity,SUM((quantity*price+500)/1000) total,SUM(book_value) cost
                   FROM lines GROUP BY doc_id) l ON l.doc_id=d.id
      LEFT JOIN (SELECT l.doc_id,SUM((a.quantity*a.rate+500)/1000) amount
                   FROM lines l JOIN assignments a ON a.line_id=l.id GROUP BY l.doc_id) wages ON wages.doc_id=d.id
      LEFT JOIN (SELECT doc_id,SUM(amount) amount,SUM(minutes) minutes
                   FROM hourly_works GROUP BY doc_id) hw ON hw.doc_id=d.id
"""


def document_scope(user, kind):
    role = user["role"]
    if role == "regional":
        depot = user["warehouse_id"]
        if kind == "transfer":
            return "d.status IN ('in_transit','received') AND d.target_id=?", [depot]
        if kind == "sale":
            return "d.source_id=?", [depot]
        raise RuleViolation("Раздел недоступен для регионального склада", 403)
    if role == "master" and kind not in ("report","opening"):
        raise RuleViolation("Операция недоступна для мастера смены", 403)
    return "1=1", []


def guard_document(user, doc):
    if user["role"] == "regional":
        allowed = (doc["kind"]=="transfer" and doc["status"] in {"in_transit","received"} and doc["target_id"]==user["warehouse_id"]) or (
            doc["kind"]=="sale" and doc["source_id"]==user["warehouse_id"])
        if not allowed:
            raise RuleViolation("Документ не найден", 404)
    elif user["role"] == "master" and doc["kind"] not in {"report","opening"}:
        raise RuleViolation("Документ не найден", 404)


def document_filters(user, kind, start="", end="", stage="", status="", warehouse=0, search=""):
    scope, args = document_scope(user, kind)
    filters = ["d.kind=?", scope]
    args.insert(0,kind)
    if start and end and start>end:
        raise RuleViolation("Начало периода должно быть раньше его окончания",422)
    for column,value,operator in [("date",start,">="),("date",end,"<="),("stage",stage,"="),("status",status,"=")]:
        if value:
            filters.append(f"d.{column}{operator}?")
            args.append(value)
    if warehouse:
        filters.append("d.source_id=?" if kind=="sale" else "d.target_id=?")
        args.append(warehouse)
    for word in search_text(search).split():
        filters.append("""(
          instr(search_text(d.code || ' ' || d.date || ' ' || d.memo || ' ' ||
               COALESCE(d.supplier,'') || ' ' || CASE WHEN d.kind='receipt' THEN COALESCE(d.reference,'') ELSE '' END),?) > 0
          OR EXISTS (SELECT 1 FROM users a WHERE a.id=d.author_id AND instr(search_text(a.name),?)>0)
          OR EXISTS (SELECT 1 FROM warehouses p WHERE p.id IN (d.source_id,d.target_id)
                     AND instr(search_text(p.city || ' ' || p.name),?)>0)
          OR EXISTS (SELECT 1 FROM lines searched JOIN items i ON i.id=searched.item_id WHERE searched.doc_id=d.id
                     AND instr(search_text(i.name || ' ' || i.size || ' ' || i.sku),?)>0)
        )""")
        args.extend([word]*4)
    return " WHERE " + " AND ".join(filters), args


def list_documents(db, user, kind, start="", end="", stage="", status="", warehouse=0, search="", limit=0, offset=0):
    where, args = document_filters(user,kind,start,end,stage,status,warehouse,search)
    total = scalar(db, f"SELECT count(*) FROM documents d {where}", args)
    pagination = " LIMIT ? OFFSET ?" if limit else ""
    if limit:
        args += [limit,offset]
    rows = records(db, BASE_DOC + where + " ORDER BY d.date DESC,d.created_at DESC,d.id DESC" + pagination,args)
    if kind=="sale":
        for row in rows:
            row.pop("reference",None)
    if user["role"]=="regional":
        for row in rows:
            row.pop("book_value",None)
    return {"rows":rows,"total":total}


def detail(db, user, doc_id):
    source = get_document(db,doc_id)
    guard_document(user,source)
    d = record(db, """
        SELECT d.id,d.kind,d.code,d.status,d.date,d.created_at,d.updated_at,d.stage,d.shift,
               COALESCE(d.source_id, CASE WHEN d.kind='report' THEN 1 END) source_id,d.target_id,
               u.name author, d.supplier,d.reference,d.payment, sw.city source_city, sw.name source_name, tw.city target_city, tw.name target_name,
               d.source_doc, src.code source_code,
               (SELECT MAX(r.id) FROM documents r WHERE r.source_doc=d.id) replacement_id,
               (SELECT MAX(r.code) FROM documents r WHERE r.source_doc=d.id) replacement_code,
               COALESCE((SELECT SUM(quantity) FROM lines WHERE doc_id=d.id),0) quantity,
               COALESCE((SELECT SUM((quantity*price+500)/1000) FROM lines WHERE doc_id=d.id),0) total,
               COALESCE((SELECT SUM(book_value) FROM lines WHERE doc_id=d.id),0) book_value,
               COALESCE((SELECT SUM((a.quantity*a.rate+500)/1000) FROM lines l JOIN assignments a ON a.line_id=l.id WHERE l.doc_id=d.id),0)
                 + COALESCE((SELECT SUM(amount) FROM hourly_works WHERE doc_id=d.id),0) wages,
               COALESCE((SELECT SUM(minutes) FROM hourly_works WHERE doc_id=d.id),0) hourly_minutes
          FROM documents d JOIN users u ON u.id=d.author_id
          LEFT JOIN warehouses sw ON sw.id=COALESCE(d.source_id, CASE WHEN d.kind='report' THEN 1 END)
          LEFT JOIN warehouses tw ON tw.id=d.target_id
          LEFT JOIN documents src ON src.id=d.source_doc
         WHERE d.id=?
    """, (doc_id,))
    d.update({k:source[k] for k in ("memo","supplier","reference","payment","source_doc")})
    if d["kind"] == "sale":
        d.pop("reference",None)
    d["lines"] = records(db, """
        SELECT l.*,i.name,i.size,i.unit,i.sku,s.version,
               COALESCE(NULLIF(s.name,''), 'Спецификация ' || s.version) spec_name
        FROM lines l JOIN items i ON i.id=l.item_id
        LEFT JOIN specs s ON s.id=l.spec_id WHERE l.doc_id=? ORDER BY l.id""", (doc_id,))
    source_wh = d["source_id"] or 1
    for l in d["lines"]:
        l["assignments"] = records(db, """
            SELECT a.staff_id,a.quantity,a.rate,p.name FROM assignments a JOIN staff p ON p.id=a.staff_id WHERE a.line_id=?""", (l["id"],))
        l["materials"] = records(db, """
            SELECT m.*,i.name,i.unit,COALESCE(b.quantity,0) available FROM material_snapshots m JOIN items i ON i.id=m.item_id
            LEFT JOIN balances b ON b.item_id=m.item_id AND b.warehouse_id=?
            WHERE m.line_id=? ORDER BY m.item_id""",(source_wh,l["id"]))
    d["hourly_works"] = records(db, """
        SELECT h.id,h.staff_id,h.work_type,h.minutes,h.hourly_rate,h.amount,p.name,p.position,p.stage
        FROM hourly_works h JOIN staff p ON p.id=h.staff_id WHERE h.doc_id=? ORDER BY h.id""", (doc_id,))
    moves = """
        SELECT m.*,i.name,i.size,i.unit,w.name warehouse,w.city,
               (SELECT COALESCE(SUM(previous.quantity),0) FROM movements previous
                WHERE previous.warehouse_id=m.warehouse_id AND previous.item_id=m.item_id AND previous.id<=m.id) balance_after
        FROM movements m JOIN items i ON i.id=m.item_id JOIN warehouses w ON w.id=m.warehouse_id WHERE doc_id=?
    """
    if user["role"]=="regional":
        d.pop("book_value",None)
        for l in d["lines"]:
            l.pop("book_value",None)
        d["movements"] = records(db,moves+" AND m.warehouse_id=? ORDER BY m.id",(doc_id,user["warehouse_id"]))
        for m in d["movements"]:
            m.pop("value",None)
    elif user["role"]=="master":
        d["movements"] = records(db,moves+" AND w.kind!='regional' ORDER BY m.id",(doc_id,))
    else:
        d["movements"] = records(db,moves+" ORDER BY m.id",(doc_id,))
    d["events"] = records(db, """
        SELECT e.action,e.happened_at,e.memo,u.name actor FROM events e JOIN users u ON u.id=e.actor_id
        WHERE e.doc_id=? ORDER BY e.id""",(doc_id,))
    return d


def stocks(db,user,warehouse_id):
    w=record(db,"SELECT * FROM warehouses WHERE id=?",(warehouse_id,))
    if not w or (user["role"]=="regional" and w["id"]!=user["warehouse_id"]) or (
            user["role"]=="master" and w["kind"]=="regional"):
        raise RuleViolation("Склад не найден",404)
    day=today()
    rows=records(db, """
        SELECT i.id item_id,i.kind,i.name,i.sku,i.size,i.unit,i.category,i.price,
               COALESCE(b.quantity,0) quantity,COALESCE(b.value,0) value,
               COALESCE(a.incoming,0) incoming,COALESCE(a.outgoing,0) outgoing
          FROM items i LEFT JOIN balances b ON b.item_id=i.id AND b.warehouse_id=?
          LEFT JOIN (SELECT item_id,SUM(CASE WHEN quantity>0 THEN quantity ELSE 0 END) incoming,
                    SUM(CASE WHEN quantity<0 THEN -quantity ELSE 0 END) outgoing
                      FROM movements WHERE warehouse_id=? AND happened_at>=? GROUP BY item_id) a ON a.item_id=i.id
          WHERE (i.kind=? AND (b.item_id IS NOT NULL OR a.item_id IS NOT NULL))
             OR COALESCE(b.quantity,0) > 0 OR a.item_id IS NOT NULL
          ORDER BY i.id
        """, (warehouse_id,warehouse_id,day,"raw" if w["kind"]=="raw" else "product"))
    if user["role"]=="regional":
        for r in rows:
            r.pop("value",None)
    return {"warehouse": w, "day":day, "rows":rows}


def warehouse_summary(db,user):
    if user["role"]=="regional":
        filter,params="WHERE w.id=?",(user["warehouse_id"],)
    elif user["role"]=="master":
        filter,params="WHERE w.kind!='regional'",()
    else:
        filter,params="",()
    rows=records(db,"""
        SELECT w.*,COALESCE(SUM(b.quantity),0) quantity,COALESCE(SUM(b.value),0) value,
               SUM(CASE WHEN b.quantity>0 THEN 1 ELSE 0 END) positions
        FROM warehouses w LEFT JOIN balances b ON b.warehouse_id=w.id """+filter+" GROUP BY w.id ORDER BY w.id",params)
    if user["role"]=="regional":
        for r in rows:
            r.pop("value",None)
    return rows


def warehouse_history(db,user,wid,start,end,item,limit,offset,search=""):
    warehouse=stocks(db,user,wid)["warehouse"]
    filters=["m.warehouse_id=?"]
    params=[wid]
    if start:
        filters+=["m.happened_at>=?"]
        params+=[start]
    if end:
        filters+=["m.happened_at<?"]
        params+=[end+"T24"]
    if item:
        filters+=["m.item_id=?"]
        params+=[item]
    for word in search_text(search).split():
        filters.append("instr(search_text(i.name || ' ' || i.size || ' ' || i.sku || ' ' || d.code),?)>0")
        params.append(word)
    where=" WHERE "+" AND ".join(filters)
    source=""" FROM movements m JOIN items i ON i.id=m.item_id
        JOIN documents d ON d.id=m.doc_id JOIN users u ON u.id=d.author_id"""
    total=scalar(db,"SELECT COUNT(*)"+source+where,params)
    paging=" LIMIT ? OFFSET ?" if limit else ""
    rows=records(db,"SELECT m.*,i.name,i.size,i.unit,d.code,d.kind,u.name actor"+
                 source+where+" ORDER BY m.happened_at DESC,m.id DESC"+paging,
                 [*params,limit,offset] if limit else params)
    if user["role"]=="regional":
        for r in rows:
            r.pop("value",None)
    return {"warehouse":warehouse,"total":total,"rows":rows}


def overview(db,user,day):
    q=records(db,"""
        SELECT d.stage,SUM(l.quantity) quantity,COUNT(DISTINCT d.id) documents
        FROM documents d JOIN lines l ON l.doc_id=d.id WHERE d.date=? AND d.kind='report' AND d.status='posted' GROUP BY d.stage
    """,(day,))
    draft_stages=records(db,"""
        SELECT d.stage,SUM(l.quantity) quantity,COUNT(DISTINCT d.id) documents
        FROM documents d JOIN lines l ON l.doc_id=d.id WHERE d.date=? AND d.kind='report' AND d.status='draft' GROUP BY d.stage
    """,(day,))
    wages=scalar(db,"""
        SELECT COALESCE(SUM((a.quantity*a.rate+500)/1000),0) FROM assignments a JOIN lines l ON a.line_id=l.id
        JOIN documents d ON d.id=l.doc_id WHERE d.kind='report' AND d.status='posted' AND d.date=?
    """,(day,)) + scalar(db,"""
        SELECT COALESCE(SUM(h.amount),0) FROM hourly_works h
        JOIN documents d ON d.id=h.doc_id WHERE d.kind='report' AND d.status='posted' AND d.date=?
    """,(day,))
    day_reports=records(db, BASE_DOC + """
        WHERE d.kind='report' AND d.date=? AND d.status IN ('posted','draft')
        ORDER BY d.created_at DESC, d.id DESC LIMIT 100
    """,(day,))
    reports=[r for r in day_reports if r["status"]=="posted"][:50]
    day_drafts=[r for r in day_reports if r["status"]=="draft"][:50]
    day_reports=day_reports[:50]
    pending_total=scalar(db,"SELECT count(*) FROM documents d WHERE d.kind='report' AND d.status='draft'")
    pending_rows=records(db, BASE_DOC + """
        WHERE d.kind='report' AND d.status='draft'
        ORDER BY CASE WHEN d.date=? THEN 0 ELSE 1 END, d.date DESC, d.created_at DESC, d.id DESC
        LIMIT 10
    """,(day,))
    pending={"rows":pending_rows,"total":pending_total}
    wip=records(db,"""
        SELECT w.id,w.kind,COALESCE(SUM(m.quantity),0) quantity FROM warehouses w
        LEFT JOIN movements m ON m.warehouse_id=w.id AND m.happened_at < ?
        WHERE w.kind IN ('cut','sew','pack') GROUP BY w.id ORDER BY w.id
    """,(day+"T24",))
    return {"day":day,"stages":q,"draft_stages":draft_stages,"wages":wages,"reports":reports,
            "day_drafts":day_drafts,"day_reports":day_reports,"pending":pending,"wip":wip}


def catalog_specs(db):
    return records(db, """
        SELECT id,product_id,version,COALESCE(NULLIF(name,''), 'Спецификация ' || version) name,effective
        FROM specs ORDER BY product_id, version DESC
    """)


def payroll(db,start,end,stage="",staff=0,include_zero=False):
    month=start[:7]
    piece={r["staff_id"]: r for r in records(db,"""
      SELECT a.staff_id,SUM(a.quantity) quantity,SUM((a.quantity*a.rate+500)/1000) amount
      FROM assignments a JOIN lines l ON l.id=a.line_id JOIN documents d ON d.id=l.doc_id
      WHERE d.status='posted' AND d.date BETWEEN ? AND ? GROUP BY a.staff_id
    """,(start,end))}
    hourly={r["staff_id"]: r for r in records(db,"""
      SELECT h.staff_id,SUM(h.minutes) minutes,SUM(h.amount) amount
      FROM hourly_works h JOIN documents d ON d.id=h.doc_id
      WHERE d.status='posted' AND d.date BETWEEN ? AND ? GROUP BY h.staff_id
    """,(start,end))}
    docs_map={r["staff_id"]: r["documents"] for r in records(db,"""
      SELECT staff_id,COUNT(DISTINCT doc_id) documents FROM (
        SELECT a.staff_id,l.doc_id FROM assignments a JOIN lines l ON l.id=a.line_id
        JOIN documents d ON d.id=l.doc_id WHERE d.status='posted' AND d.date BETWEEN ? AND ?
        UNION
        SELECT h.staff_id,h.doc_id FROM hourly_works h
        JOIN documents d ON d.id=h.doc_id WHERE d.status='posted' AND d.date BETWEEN ? AND ?
      ) GROUP BY staff_id
    """,(start,end,start,end))}
    adj_map={r["staff_id"]: r for r in records(db,"SELECT * FROM payroll_adjustments WHERE month=?",(month,))}
    sql="SELECT id,name,stage,position,active,travel_eligible,travel_amount FROM staff WHERE 1=1"
    params=[]
    if stage:
        sql+=" AND stage=?"
        params.append(stage)
    if staff:
        sql+=" AND id=?"
        params.append(staff)
    rows=[]
    for p in records(db,sql+" ORDER BY name",params):
        sid=p["id"]
        pr=piece.get(sid)
        hr=hourly.get(sid)
        adj=adj_map.get(sid)
        piece_amount=pr["amount"] if pr else 0
        quantity=pr["quantity"] if pr else 0
        hourly_amount=hr["amount"] if hr else 0
        hourly_minutes=hr["minutes"] if hr else 0
        accrual=piece_amount+hourly_amount
        travel_override=adj["travel"] if adj else None
        if travel_override is not None:
            travel=travel_override
        elif p["travel_eligible"] and (p["active"] or accrual>0):
            travel=p["travel_amount"]
        else:
            travel=0
        debt=adj["debt"] if adj else 0
        advance=adj["advance"] if adj else 0
        ndfl=adj["ndfl"] if adj else 0
        memo=adj["memo"] if adj else ""
        net_total=accrual+travel-debt-advance-ndfl
        if not include_zero and not staff and not any((accrual,travel,debt,advance,ndfl)):
            continue
        rows.append({
            "id": sid, "name": p["name"], "stage": p["stage"], "position": p["position"],
            "active": p["active"], "month": month, "quantity": quantity,
            "piece_amount": piece_amount, "hourly_minutes": hourly_minutes, "hourly_amount": hourly_amount,
            "accrual": accrual, "amount": accrual,
            "travel_eligible": bool(p["travel_eligible"]),
            "default_travel": p["travel_amount"] if p["travel_eligible"] else 0,
            "travel_override": travel_override, "travel": travel,
            "debt": debt, "advance": advance, "ndfl": ndfl, "net_total": net_total,
            "memo": memo, "documents": docs_map.get(sid, 0),
        })
    rows.sort(key=lambda r: (-r["accrual"], -r["net_total"], r["name"]))
    return rows


def staff_history(db,staff_id,start,end):
    return records(db,"""
        SELECT d.id,d.date,d.code,d.stage,d.shift,l.item_id,i.name,i.size,a.quantity,a.rate,(a.rate*a.quantity+500)/1000 amount
        FROM assignments a JOIN lines l ON l.id=a.line_id JOIN documents d ON d.id=l.doc_id JOIN items i ON i.id=l.item_id
        WHERE a.staff_id=? AND d.status='posted' AND d.date BETWEEN ? AND ? ORDER BY d.date DESC,d.id DESC
        """,(staff_id,start,end))


def staff_hourly_history(db,staff_id,start,end):
    return records(db,"""
        SELECT d.id,d.date,d.code,d.stage,d.shift,h.work_type,h.minutes,h.hourly_rate,h.amount
        FROM hourly_works h JOIN documents d ON d.id=h.doc_id
        WHERE h.staff_id=? AND d.status='posted' AND d.date BETWEEN ? AND ? ORDER BY d.date DESC,d.id DESC
        """,(staff_id,start,end))


def month_summary(db,month):
    y,m=map(int,month.split("-"))
    start=f"{month}-01"
    end=f"{month}-{monthrange(y,m)[1]}T24"
    flows=records(db,"""
        SELECT w.id,w.name,w.kind,
          COALESCE(SUM(CASE WHEN m.happened_at<? THEN m.quantity ELSE 0 END),0) opening,
          COALESCE(SUM(CASE WHEN m.happened_at>=? AND m.quantity>0 THEN m.quantity ELSE 0 END),0) incoming,
          COALESCE(SUM(CASE WHEN m.happened_at>=? AND m.quantity<0 THEN -m.quantity ELSE 0 END),0) outgoing,
          COALESCE(SUM(m.quantity),0) closing
        FROM warehouses w LEFT JOIN movements m ON m.warehouse_id=w.id AND m.happened_at<?
        WHERE w.kind IN ('cut','sew','pack','finished') GROUP BY w.id ORDER BY w.id
    """,(start,start,start,end))
    def sum_where(sql, params):
        return scalar(db,"SELECT COALESCE("+sql+",0)",params)
    opening=sum_where("(SELECT SUM(value) FROM movements WHERE warehouse_id IN (2,3,4) AND happened_at<?)",(start,))
    closing=sum_where("(SELECT SUM(value) FROM movements WHERE warehouse_id IN (2,3,4) AND happened_at<?)",(end,))
    materials=sum_where("(SELECT -SUM(m.value) FROM movements m JOIN documents d ON d.id=m.doc_id JOIN items i ON i.id=m.item_id WHERE i.kind='raw' AND (m.operation='material' OR (m.operation='correction' AND d.kind='report')) AND m.happened_at>=? AND m.happened_at<?)",(start,end))
    salary=sum(row["amount"] for row in payroll(db,start,end[:10]))
    overhead=record(db,"SELECT * FROM overhead WHERE month=?",(month,))
    completed=scalar(db,"SELECT COALESCE(SUM(l.quantity),0) FROM lines l JOIN documents d ON d.id=l.doc_id WHERE d.kind='report' AND d.status='posted' AND d.stage='pack' AND d.date BETWEEN ? AND ?",(start,end[:10]))
    expense=overhead["amount"] if overhead else 0
    return {"month": month,"flows":flows,"opening":opening,"closing":closing,"material":materials,"wages":salary,
            "overhead":expense,"overhead_details":overhead["details"] if overhead else "",
            "total":opening+materials+salary+expense-closing,"completed":completed}


def sales_summary(db,user,start,end,warehouse_id=0,search=""):
    where,args=document_filters(user,"sale",start,end,status="posted",warehouse=warehouse_id,search=search)
    grouped=records(db,"""
        SELECT w.id,w.city,w.name,COUNT(DISTINCT d.id) docs,SUM(l.quantity) quantity,
               SUM((l.quantity*l.price+500)/1000) total,SUM(l.book_value) cost
        FROM documents d JOIN lines l ON l.doc_id=d.id JOIN warehouses w ON w.id=d.source_id
    """+where+" GROUP BY w.id ORDER BY total DESC",args)
    items=records(db,"""
        SELECT i.id,i.name,i.size,SUM(l.quantity) quantity,SUM((l.quantity*l.price+500)/1000) total,SUM(l.book_value) cost
        FROM documents d JOIN lines l ON l.doc_id=d.id JOIN items i ON i.id=l.item_id
    """+where+" GROUP BY i.id ORDER BY quantity DESC,i.name",args)
    payments=records(db,"""
        SELECT COALESCE(d.payment,'card') payment,COUNT(DISTINCT d.id) docs,SUM(l.quantity) quantity,
               SUM((l.quantity*l.price+500)/1000) total
        FROM documents d JOIN lines l ON l.doc_id=d.id
    """+where+" GROUP BY d.payment ORDER BY total DESC",args)
    result={"cities":grouped,"items":items,"payments":payments,"quantity":sum(r["quantity"] for r in grouped),
            "total":sum(r["total"] for r in grouped),"cost":sum(r["cost"] for r in grouped),"documents":sum(r["docs"] for r in grouped)}
    if user["role"]=="regional":
        result.pop("cost",None)
        for row in grouped:
            row.pop("cost",None)
        for row in items:
            row.pop("cost",None)
    return result
