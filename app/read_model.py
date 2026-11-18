"""Queries for the registers, dashboards and document cards."""
from calendar import monthrange

from .db import line_cost, record, records, scalar, search_text, today
from .operations import RuleViolation, get_document

ROLE_NAMES = {"admin":"Администратор","accountant":"Бухгалтер","master":"Мастер смены","regional":"Сотрудник склада"}
STATUS = {"draft":"Черновик","posted":"Проведён","in_transit":"В пути","received":"Получено","corrected":"Исправлен"}
STAGE_NAME = {"cut":"Раскрой","sew":"Пошив","pack":"Упаковка","warehouse":"Склад","office":"Управление"}
KIND = {"report":"Отчёт за смену","receipt":"Поступление сырья","transfer":"Перемещение","sale":"Продажа","opening":"Начальные остатки"}

BASE_DOC = """
    SELECT d.id,d.kind,d.code,d.status,d.date,d.created_at,d.updated_at,d.stage,d.shift,d.source_id,d.target_id,
           u.name author, d.supplier,d.reference,d.payment, sw.city source_city, sw.name source_name, tw.city target_city, tw.name target_name,
           d.source_doc, src.code source_code, rep.id replacement_id, rep.code replacement_code,
           COALESCE(l.quantity,0) quantity,COALESCE(l.total,0) total,COALESCE(l.cost,0) book_value,
           COALESCE(wages.amount,0) wages
      FROM documents d JOIN users u ON u.id=d.author_id
      LEFT JOIN warehouses sw ON sw.id=d.source_id LEFT JOIN warehouses tw ON tw.id=d.target_id
      LEFT JOIN documents src ON src.id=d.source_doc
      LEFT JOIN (SELECT source_doc, MAX(id) id, MAX(code) code FROM documents WHERE source_doc IS NOT NULL GROUP BY source_doc) rep ON rep.source_doc=d.id
      LEFT JOIN (SELECT doc_id,SUM(quantity) quantity,SUM((quantity*price+500)/1000) total,SUM(book_value) cost
                   FROM lines GROUP BY doc_id) l ON l.doc_id=d.id
      LEFT JOIN (SELECT l.doc_id,SUM((a.quantity*a.rate+500)/1000) amount
                   FROM lines l JOIN assignments a ON a.line_id=l.id GROUP BY l.doc_id) wages ON wages.doc_id=d.id
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
    d = record(db, BASE_DOC+" WHERE d.id=?", (doc_id,))
    d.update({k:source[k] for k in ("memo","supplier","reference","payment","source_doc")})
    if d["kind"] == "sale":
        d.pop("reference",None)
    d["lines"] = records(db, """
        SELECT l.*,i.name,i.size,i.unit,i.sku,s.version FROM lines l JOIN items i ON i.id=l.item_id
          LEFT JOIN specs s ON s.id=l.spec_id WHERE l.doc_id=? ORDER BY l.id""", (doc_id,))
    for l in d["lines"]:
        l["assignments"] = records(db, """
            SELECT a.staff_id,a.quantity,a.rate,p.name FROM assignments a JOIN staff p ON p.id=a.staff_id WHERE a.line_id=?""", (l["id"],))
        l["materials"] = records(db, """
            SELECT m.*,i.name,i.unit,COALESCE(b.quantity,0) available FROM material_snapshots m JOIN items i ON i.id=m.item_id
            LEFT JOIN balances b ON b.item_id=m.item_id AND b.warehouse_id=1
            WHERE m.line_id=? ORDER BY m.item_id""",(l["id"],))
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
        SELECT i.id item_id,i.name,i.sku,i.size,i.unit,i.category,i.price,
               COALESCE(b.quantity,0) quantity,COALESCE(b.value,0) value,
               COALESCE(a.incoming,0) incoming,COALESCE(a.outgoing,0) outgoing
          FROM items i LEFT JOIN balances b ON b.item_id=i.id AND b.warehouse_id=?
          LEFT JOIN (SELECT item_id,SUM(CASE WHEN quantity>0 THEN quantity ELSE 0 END) incoming,
                    SUM(CASE WHEN quantity<0 THEN -quantity ELSE 0 END) outgoing
                      FROM movements WHERE warehouse_id=? AND happened_at>=? GROUP BY item_id) a ON a.item_id=i.id
          WHERE i.kind=? AND (b.item_id IS NOT NULL OR a.item_id IS NOT NULL) ORDER BY i.id
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
    wages=scalar(db,"""
        SELECT COALESCE(SUM((a.quantity*a.rate+500)/1000),0) FROM assignments a JOIN lines l ON a.line_id=l.id
        JOIN documents d ON d.id=l.doc_id WHERE d.kind='report' AND d.status='posted' AND d.date=?
    """,(day,))
    reports=list_documents(db,user,"report",start=day,end=day,status="posted",limit=3)["rows"]
    pending=list_documents(db,user,"report",status="draft",limit=3)
    wip=records(db,"""
        SELECT w.id,w.kind,COALESCE(SUM(m.quantity),0) quantity FROM warehouses w
        LEFT JOIN movements m ON m.warehouse_id=w.id AND m.happened_at < ?
        WHERE w.kind IN ('cut','sew','pack') GROUP BY w.id ORDER BY w.id
    """,(day+"T24",))
    return {"day":day,"stages":q,"wages":wages,"reports":reports,"pending":pending,"wip":wip}


def payroll(db,start,end,stage="",staff=0):
    sql="""
      SELECT p.id,p.name,p.stage,p.position,SUM(a.quantity) quantity,SUM((a.quantity*a.rate+500)/1000) amount,
             COUNT(DISTINCT d.id) documents
      FROM assignments a JOIN staff p ON p.id=a.staff_id JOIN lines l ON l.id=a.line_id
      JOIN documents d ON d.id=l.doc_id WHERE d.status='posted' AND d.date BETWEEN ? AND ?
    """
    params=[start,end]
    if stage:
        sql+=" AND p.stage=?"
        params.append(stage)
    if staff:
        sql+=" AND p.id=?"
        params.append(staff)
    return records(db,sql+" GROUP BY p.id ORDER BY amount DESC,p.name",params)


def staff_history(db,staff_id,start,end):
    return records(db,"""
        SELECT d.id,d.date,d.code,d.stage,d.shift,l.item_id,i.name,i.size,a.quantity,a.rate,(a.rate*a.quantity+500)/1000 amount
        FROM assignments a JOIN lines l ON l.id=a.line_id JOIN documents d ON d.id=l.doc_id JOIN items i ON i.id=l.item_id
        WHERE a.staff_id=? AND d.status='posted' AND d.date BETWEEN ? AND ? ORDER BY d.date DESC,d.id DESC
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
    materials=sum_where("(SELECT -SUM(m.value) FROM movements m JOIN documents d ON d.id=m.doc_id WHERE warehouse_id=1 AND (operation='material' OR (operation='correction' AND d.kind='report')) AND happened_at>=? AND happened_at<?)",(start,end))
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
