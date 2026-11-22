from contextlib import asynccontextmanager, closing
from datetime import date
from io import BytesIO
from typing import Annotated, Literal
from urllib.parse import quote
import hashlib
import os
import secrets
import sqlite3
import time

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from starlette.datastructures import MutableHeaders

from . import operations as ops, read_model as read, schemas as model
from .db import ROOT, SCHEMA, connect, now, password_hash, password_matches, record, records, matches_search, to_units, today, transaction
from .seed import seed


@asynccontextmanager
async def lifespan(_app):
    with closing(connect()) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(SCHEMA)
        with transaction(db):
            seed(db)
    yield


class PWAHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = MutableHeaders(scope=message)
                if path.startswith("/api/"):
                    headers.setdefault("cache-control", "no-store")
                elif status == 200:
                    if path == "/sw.js":
                        headers["content-type"] = "application/javascript; charset=utf-8"
                        headers["cache-control"] = "no-cache"
                        headers["service-worker-allowed"] = "/"
                    elif path == "/manifest.webmanifest":
                        headers["content-type"] = "application/manifest+json; charset=utf-8"
                        headers["cache-control"] = "no-cache"
                    elif path.startswith("/assets/"):
                        headers["cache-control"] = "public, max-age=31536000, immutable"
                    elif path.startswith("/icons/"):
                        headers["cache-control"] = "public, max-age=86400"
                    elif path in ("/", "/index.html"):
                        headers["cache-control"] = "no-cache"
            await send(message)

        await self.app(scope, receive, send_wrapper)


app = FastAPI(title="Швейная фабрика", lifespan=lifespan)
app.add_middleware(PWAHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=500)
COOKIE = "factory_session"
SESSION_TTL = 60*60*24*7
Date = date | None
DocKind = Literal["report","receipt","transfer","sale"]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]


@app.exception_handler(ops.RuleViolation)
async def invalid_rule(_request, e):
    return JSONResponse({"detail":e.message},status_code=e.status)


@app.exception_handler(sqlite3.IntegrityError)
async def constraint_error(_request, _error):
    return JSONResponse({"detail":"Такая запись уже существует или связана с проведённым документом."}, status_code=409)


def get_db():
    with closing(connect()) as db:
        yield db


DB = Annotated[sqlite3.Connection, Depends(get_db)]


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(request: Request, db: DB):
    token = request.cookies.get(COOKIE,"")
    identity = record(db,"""
        SELECT u.id,u.name,u.email,u.role,u.staff_id,p.stage staff_stage,g.warehouse_id,w.city,w.name warehouse_name
        FROM sessions s JOIN users u ON u.id=s.user_id
          LEFT JOIN grants g ON g.user_id=u.id LEFT JOIN warehouses w ON w.id=g.warehouse_id
          LEFT JOIN staff p ON p.id=u.staff_id
        WHERE s.digest=? AND s.expires>? AND (p.id IS NULL OR p.active=1)""",
        (digest(token),int(time.time()))) if token else None
    if not identity:
        raise HTTPException(401,"Войдите в рабочее пространство")
    if identity["role"]=="regional" and (not identity["warehouse_id"] or (identity["staff_id"] and identity["staff_stage"]!="warehouse")):
        raise HTTPException(403,"Доступ к складу не назначен")
    return {**identity,"role_name":read.ROLE_NAMES[identity["role"]]}


User = Annotated[dict, Depends(current_user)]


def allow(user,*roles):
    if user["role"] not in roles:
        raise HTTPException(403,"Недостаточно прав для этого действия")


def is_secure_cookie(request: Request):
    return (
        os.environ.get("COOKIE_SECURE", "").lower() == "true"
        or request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower() == "https"
    )


def set_cookie(request,response,token):
    response.set_cookie(COOKIE,token,max_age=SESSION_TTL,httponly=True,samesite="strict",secure=is_secure_cookie(request),path="/")


@app.get("/api/health")
def health(db: DB):
    return {"status":"ok","date":today()}


@app.post("/api/login")
def login(data: model.Login, request: Request, response: Response, db: DB):
    u=record(db,"""SELECT u.*,p.active,p.stage staff_stage,g.warehouse_id FROM users u LEFT JOIN staff p ON u.staff_id=p.id
                   LEFT JOIN grants g ON g.user_id=u.id WHERE email=?""",(data.email.strip().lower(),))
    if not u or not password_matches(data.password,u["password"]) or u["active"]==0:
        raise HTTPException(401,"Неверная почта или пароль")
    if u["role"]=="regional" and (not u["warehouse_id"] or (u["staff_id"] and u["staff_stage"]!="warehouse")):
        raise HTTPException(403,"Доступ к складу не назначен")
    token=secrets.token_urlsafe(32)
    with transaction(db):
        db.execute("DELETE FROM sessions WHERE expires<=?",(int(time.time()),))
        db.execute("INSERT INTO sessions VALUES(?,?,?)",(digest(token),u["id"],int(time.time())+SESSION_TTL))
    set_cookie(request,response,token)
    return {"ok":True}


@app.post("/api/logout")
def logout(request: Request, response: Response, db: DB):
    token=request.cookies.get(COOKIE,"")
    if token:
        with transaction(db):
            db.execute("DELETE FROM sessions WHERE digest=?",(digest(token),))
    response.delete_cookie(COOKIE,path="/",httponly=True,samesite="strict",secure=is_secure_cookie(request))
    return {"ok":True}


@app.post("/api/password")
def change_password(payload: model.Password, request: Request, response: Response, db: DB, user: User):
    token=secrets.token_urlsafe(32)
    with transaction(db):
        u=ops.required(db,"users",user["id"])
        if not password_matches(payload.old,u["password"]):
            raise HTTPException(422,"Текущий пароль указан неверно")
        db.execute("UPDATE users SET password=? WHERE id=?",(password_hash(payload.new),user["id"]))
        db.execute("DELETE FROM sessions WHERE user_id=?",(user["id"],))
        db.execute("INSERT INTO sessions VALUES(?,?,?)",(digest(token),user["id"],int(time.time())+SESSION_TTL))
    set_cookie(request,response,token)
    return {"ok":True}


@app.get("/api/workspace")
def workspace(db: DB, user: User):
    info={"user":user,"today":today(),"warehouses":read.warehouse_summary(db,user)}
    if user["role"]=="regional":
        info["items"]=records(db,"SELECT id,name,size,sku,unit,price FROM items WHERE kind='product' ORDER BY id")
        return info
    if user["role"] != "master":
        info["in_transit"]=record(db,"""
          SELECT COUNT(DISTINCT d.id) documents,COALESCE(SUM(l.quantity),0) quantity
          FROM documents d JOIN lines l ON l.doc_id=d.id WHERE d.kind='transfer' AND d.status='in_transit'
        """)
    info.update({"items":records(db,"""SELECT i.*,(SELECT MAX(version) FROM specs s WHERE s.product_id=i.id) version
             FROM items i ORDER BY i.id"""),"staff":records(db,"SELECT * FROM staff ORDER BY name"),
                 "settings":dict(db.execute("SELECT key,value FROM settings WHERE key!='seeded'").fetchall())})
    return info


@app.get("/api/overview")
def overview(db: DB, user: User, day: Date=None):
    allow(user,"admin","accountant","master")
    return read.overview(db,user,str(day or today()))


@app.get("/api/documents/{kind}")
def documents(kind: DocKind, db: DB, user: User, start: Date=None, end: Date=None,
              stage:str="", status:str="", warehouse:int=0, search:Annotated[str,Query(max_length=100)]="",
              limit:Limit=15,offset:Offset=0,xlsx:bool=False):
    q=read.list_documents(db,user,kind,str(start or ""),str(end or ""),stage,status,warehouse,search,0 if xlsx else limit,offset)
    if xlsx:
        headers=["Документ","Дата","Статус","Автор"]
        if kind=="report":
            title="Отчёты за смену"
            headers+=["Этап","Выработка, компл.","Начислено, ₽"]
            extra=lambda d: [read.STAGE_NAME[d["stage"]],d["quantity"]/1000,d["wages"]/100 if d["status"]!="draft" else None]
        elif kind=="receipt":
            title="Поступления сырья"
            headers+=["Поставщик","Накладная","Сумма, ₽"]
            extra=lambda d: [d["supplier"],d["reference"],d["total"]/100]
        elif kind=="transfer":
            title="Складские перемещения"
            headers+=["Отправитель","Город назначения","Комплектов","Сумма, ₽"]
            extra=lambda d: [d["source_city"],d["target_city"],d["quantity"]/1000,d["total"]/100]
        else:
            title="Продажи"
            headers+=["Город","Комплектов","Сумма, ₽"]
            extra=lambda d: [d["source_city"],d["quantity"]/1000,d["total"]/100]
        return export_xlsx(title,headers,
            [[d["code"],d["date"],read.STATUS.get(d["status"],d["status"]),d["author"],*extra(d)] for d in q["rows"]])
    return q


@app.get("/api/document/{doc_id}")
def document(doc_id: int, db: DB, user: User):
    return read.detail(db,user,doc_id)


@app.post("/api/reports")
def create_report(data: model.Report, db: DB, user: User, post:bool=False):
    allow(user,"admin","accountant","master")
    with transaction(db):
        doc=ops.save_report(db,data,user["id"],role=user["role"])
        if post:
            ops.post_report(db,doc,user["id"])
    return read.detail(db,user,doc)


@app.put("/api/reports/{doc_id}")
def update_report(doc_id:int,data:model.Report,db:DB,user:User,post:bool=False):
    allow(user,"admin","accountant","master")
    with transaction(db):
        ops.save_report(db,data,user["id"],doc_id,role=user["role"])
        if post:
            ops.post_report(db,doc_id,user["id"])
    return read.detail(db,user,doc_id)


@app.post("/api/reports/preview")
def preview_report(data: model.Report, db: DB, user: User):
    allow(user,"admin","accountant","master")
    with transaction(db):
        db.execute("SAVEPOINT preview")
        try:
            doc=ops.save_report(db,data,user["id"],role=user["role"])
            return read.detail(db,user,doc)
        finally:
            db.execute("ROLLBACK TO preview")
            db.execute("RELEASE preview")


@app.post("/api/reports/{doc_id}/correct")
def correct_report(doc_id:int,data:model.Correction,db:DB,user:User):
    allow(user,"admin","accountant")
    with transaction(db):
        result=ops.correct_report(db,doc_id,user["id"],data.reason.strip())
    return read.detail(db,user,result)


@app.get("/api/warehouses/{warehouse_id}")
def warehouse(warehouse_id:int,db:DB,user:User,search:Annotated[str,Query(max_length=100)]="",xlsx:bool=False):
    data=read.stocks(db,user,warehouse_id)
    if search:
        data["rows"]=[r for r in data["rows"] if matches_search(search,r["name"],r["size"],r["sku"],r["category"])]
    if xlsx:
        regional=user["role"]=="regional"
        return export_xlsx("Остатки — "+data["warehouse"]["city"],
            ["Код","Наименование","Размер","Единица","На начало дня","Поступило сегодня","Выбыло сегодня","Остаток",
             "Розничная цена, ₽" if regional else "Учётная стоимость, ₽"],
            [[r["sku"],r["name"],r["size"],r["unit"],(r["quantity"]-r["incoming"]+r["outgoing"])/1000,r["incoming"]/1000,
              r["outgoing"]/1000,r["quantity"]/1000,(r["price"] if regional else r["value"])/100] for r in data["rows"]])
    return data


@app.get("/api/warehouses/{warehouse_id}/movements")
def warehouse_movements(warehouse_id:int,db:DB,user:User,start:Date=None,end:Date=None,item:int=0,
                        search:Annotated[str,Query(max_length=100)]="",limit:Limit=20,offset:Offset=0,xlsx:bool=False):
    data=read.warehouse_history(db,user,warehouse_id,str(start or ""),str(end or ""),item,0 if xlsx else limit,offset,search)
    if xlsx:
        regional=user["role"]=="regional"
        headers=["Документ","Время","Товар","Размер","Единица","Приход","Расход"]
        if not regional:
            headers.append("Стоимость движения, ₽")
        rows=[[r["code"],r["happened_at"],r["name"],r["size"],r["unit"],
               max(0,r["quantity"])/1000,max(0,-r["quantity"])/1000,
               *([] if regional else [r["value"]/100])] for r in data["rows"]]
        return export_xlsx("Складские движения — "+data["warehouse"]["city"],headers,rows)
    return data


@app.post("/api/warehouses")
def add_warehouse(data:model.Warehouse,db:DB,user:User):
    allow(user,"admin")
    with transaction(db):
        i=db.execute("INSERT INTO warehouses(name,city,address,kind) VALUES(?,?,?,'regional')",
            (data.name.strip(),data.city.strip(),data.address.strip())).lastrowid
    return ops.required(db,"warehouses",i)


@app.get("/api/access")
def get_access(db:DB,user:User):
    allow(user,"admin")
    return records(db,"""
        SELECT p.id staff_id,p.name,p.position,p.active,u.id user_id,u.email,g.warehouse_id,g.granted_at,w.city,
               COALESCE(u.role,'') role
        FROM staff p LEFT JOIN users u ON u.staff_id=p.id LEFT JOIN grants g ON g.user_id=u.id
        LEFT JOIN warehouses w ON w.id=g.warehouse_id WHERE p.stage='warehouse' ORDER BY p.name
    """)


@app.put("/api/access")
def grant_access(data:model.Access,db:DB,user:User):
    allow(user,"admin")
    with transaction(db):
        w=ops.required(db,"warehouses",data.warehouse_id)
        p=ops.required(db,"staff",data.staff_id)
        if w["kind"]!="regional" or not p["active"] or p["stage"]!="warehouse":
            raise HTTPException(422,"Выберите действующего кладовщика и региональный склад")
        account=record(db,"SELECT id,role FROM users WHERE staff_id=?",(p["id"],))
        if not account:
            if not (data.email and data.password):
                raise HTTPException(422,"Укажите почту и пароль для новой учётной записи")
            uid=db.execute("INSERT INTO users(name,email,password,role,staff_id) VALUES(?,?,?,'regional',?)",
                (p["name"],data.email.strip().lower(),password_hash(data.password),p["id"])).lastrowid
        else:
            if account["role"]!="regional":
                raise HTTPException(422,"Эта учётная запись имеет другую роль")
            uid=account["id"]
        db.execute("""INSERT INTO grants VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
            warehouse_id=excluded.warehouse_id,granted_at=excluded.granted_at,granted_by=excluded.granted_by""",
            (uid,w["id"],now(),user["id"]))
        db.execute("DELETE FROM sessions WHERE user_id=?",(uid,))
    return {"ok":True}


@app.delete("/api/access/{staff_id}")
def revoke_access(staff_id:int,db:DB,user:User):
    allow(user,"admin")
    with transaction(db):
        account=record(db,"SELECT id FROM users WHERE staff_id=? AND role='regional'",(staff_id,))
        if not account:
            raise HTTPException(404,"Доступ не найден")
        db.execute("DELETE FROM grants WHERE user_id=?",(account["id"],))
        db.execute("DELETE FROM sessions WHERE user_id=?",(account["id"],))
    return {"ok":True}


@app.post("/api/receipts")
def receipt(data:model.Receipt,db:DB,user:User,post:bool=True):
    allow(user,"admin","accountant")
    with transaction(db):
        d=ops.save_receipt(db,data,user["id"],post=post)
    return read.detail(db,user,d)


@app.put("/api/receipts/{doc_id}")
def update_receipt(doc_id:int,data:model.Receipt,db:DB,user:User,post:bool=False):
    allow(user,"admin","accountant")
    with transaction(db):
        d=ops.save_receipt(db,data,user["id"],doc_id=doc_id,post=post)
    return read.detail(db,user,d)


@app.post("/api/transfers")
def new_transfer(data:model.Transfer,db:DB,user:User):
    allow(user,"admin","accountant")
    with transaction(db):
        ops.check_period(db,data.date)
        d=ops.save_transfer(db,data,user["id"])
    return read.detail(db,user,d)


@app.put("/api/transfers/{doc_id}")
def change_transfer(doc_id:int,data:model.Transfer,db:DB,user:User):
    allow(user,"admin","accountant")
    with transaction(db):
        ops.check_period(db,data.date)
        ops.save_transfer(db,data,user["id"],doc_id)
    return read.detail(db,user,doc_id)


@app.post("/api/transfers/{doc_id}/send")
def send_transfer(doc_id:int,db:DB,user:User,data:model.Transfer | None=None):
    allow(user,"admin","accountant")
    with transaction(db):
        if data is not None:
            ops.check_period(db,data.date)
            ops.save_transfer(db,data,user["id"],doc_id)
        ops.send_transfer(db,doc_id,user["id"])
    return read.detail(db,user,doc_id)


@app.post("/api/transfers/{doc_id}/receive")
def receive_transfer(doc_id:int,db:DB,user:User):
    allow(user,"regional")
    with transaction(db):
        doc=ops.get_document(db,doc_id,"transfer")
        read.guard_document(user,doc)
        ops.receive_transfer(db,doc_id,user["id"])
    return read.detail(db,user,doc_id)


@app.post("/api/materials")
def add_material(data:model.RawMaterial,db:DB,user:User):
    allow(user,"admin","accountant")
    with transaction(db):
        sku=data.sku.strip()
        if not sku:
            seq=db.execute("SELECT COUNT(*)+1 FROM items WHERE kind='raw'").fetchone()[0]
            while True:
                candidate=f"RAW-{seq:03}"
                if not record(db,"SELECT 1 FROM items WHERE sku=?",(candidate,)):
                    sku=candidate
                    break
                seq+=1
        elif record(db,"SELECT 1 FROM items WHERE sku=?",(sku,)):
            raise HTTPException(409,"Материал с таким артикулом уже существует")
        item_id=db.execute(
            "INSERT INTO items(kind,sku,name,size,unit,category,price) VALUES('raw',?,?,'',?,?,?)",
            (sku,data.name.strip(),data.unit,data.category.strip(),to_units(data.price,100)),
        ).lastrowid
    return ops.required(db,"items",item_id)


@app.post("/api/sales")
def add_sale(data:model.Sale,db:DB,user:User):
    allow(user,"regional","admin","accountant")
    if user["role"]=="regional":
        if data.warehouse_id is not None and data.warehouse_id!=user["warehouse_id"]:
            raise HTTPException(403,"Продажа доступна только на вашем складе")
        warehouse_id=user["warehouse_id"]
    else:
        warehouse_id=data.warehouse_id or ops.WAREHOUSES["finished"]
    with transaction(db):
        doc=ops.save_sale(db,data,user["id"],warehouse_id)
    return read.detail(db,user,doc)


@app.get("/api/sales-summary")
def sales_summary(db:DB,user:User,start:Date=None,end:Date=None,warehouse:int=0,search:Annotated[str,Query(max_length=100)]=""):
    allow(user,"admin","accountant","regional")
    return read.sales_summary(db,user,str(start or ""),str(end or ""),warehouse,search)


@app.get("/api/catalog/{item_id}")
def product(item_id:int,db:DB,user:User):
    allow(user,"admin","accountant","master")
    item=ops.required(db,"items",item_id)
    if item["kind"]!="product":
        raise HTTPException(404,"Изделие не найдено")
    versions=records(db,"SELECT * FROM specs WHERE product_id=? ORDER BY version DESC",(item_id,))
    for v in versions:
        v["norms"]=records(db,"SELECT n.*,i.name,i.sku,i.unit FROM norms n JOIN items i ON i.id=n.item_id WHERE n.spec_id=? ORDER BY stage,i.id",(v["id"],))
        v["rates"]=dict(db.execute("SELECT stage,amount FROM rates WHERE spec_id=?",(v["id"],)).fetchall())
    return {"item":item,"versions":versions}


@app.post("/api/catalog")
def add_product(data:model.Product,db:DB,user:User):
    allow(user,"admin","accountant")
    if data.price<=0:
        raise HTTPException(422,"Укажите розничную цену больше нуля")
    with transaction(db):
        i=db.execute("INSERT INTO items(kind,sku,name,size,unit,category,price) VALUES('product',?,?,?,'компл.',?,?)",
            (data.sku.strip(),data.name.strip(),data.size.strip(),data.category.strip(),to_units(data.price,100))).lastrowid
        ops.save_recipe(db,i,data)
    return {"id":i}


@app.post("/api/catalog/{item_id}/versions")
def add_version(item_id:int,data:model.Recipe,db:DB,user:User):
    allow(user,"admin","accountant")
    with transaction(db):
        recipe=ops.save_recipe(db,item_id,data)
    return {"id":recipe}


@app.post("/api/staff")
def add_staff(data:model.Staff,db:DB,user:User):
    allow(user,"admin","accountant")
    with transaction(db):
        ops.past_day(data.hired_on)
        i=db.execute("INSERT INTO staff(name,stage,position,hired_on,active) VALUES(?,?,?,?,?)",
            (data.name.strip(),data.stage,data.position.strip(),str(data.hired_on),data.active)).lastrowid
    return {"id":i}


@app.put("/api/staff/{staff_id}")
def update_staff(staff_id:int,data:model.Staff,db:DB,user:User):
    allow(user,"admin","accountant")
    with transaction(db):
        ops.required(db,"staff",staff_id)
        ops.past_day(data.hired_on)
        name=data.name.strip()
        db.execute("UPDATE staff SET name=?,stage=?,position=?,hired_on=?,active=? WHERE id=?",
            (name,data.stage,data.position.strip(),str(data.hired_on),data.active,staff_id))
        db.execute("UPDATE users SET name=? WHERE staff_id=?",(name,staff_id))
        if not data.active:
            db.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE staff_id=?)",(staff_id,))
        if data.stage!="warehouse":
            db.execute("DELETE FROM grants WHERE user_id IN (SELECT id FROM users WHERE staff_id=? AND role='regional')",(staff_id,))
            db.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE staff_id=? AND role='regional')",(staff_id,))
    return {"id":staff_id}


@app.get("/api/staff/{staff_id}")
def staff(staff_id:int,db:DB,user:User,start:Date=None,end:Date=None,xlsx:bool=False):
    allow(user,"admin","accountant","master")
    current=today()
    p=ops.required(db,"staff",staff_id)
    if user["role"]=="master":
        if xlsx:
            allow(user,"admin","accountant")
        return {"staff":p,"rows":[]}
    hist=read.staff_history(db,staff_id,str(start or current[:7]+"-01"),str(end or current))
    if xlsx:
        return export_xlsx("Начисления сотрудника",["Дата","Документ","Изделие","Размер","Количество","Расценка, ₽","Начислено, ₽"],
            [[r["date"],r["code"],r["name"],r["size"],r["quantity"]/1000,r["rate"]/100,r["amount"]/100] for r in hist])
    return {"staff":p,"rows":hist}


@app.get("/api/payroll")
def payroll(db:DB,user:User,start:Date=None,end:Date=None,stage:str="",
            search:Annotated[str,Query(max_length=100)]="",xlsx:bool=False):
    allow(user,"admin","accountant")
    current=today()
    data=read.payroll(db,str(start or current[:7]+"-01"),str(end or current),stage)
    if search:
        data=[r for r in data if matches_search(search,r["name"],r["position"])]
    if xlsx:
        return export_xlsx("Сдельная зарплата",["Сотрудник","Этап","Комплектов","Начислено, ₽","Отчётов"],
            [[r["name"],read.STAGE_NAME[r["stage"]],r["quantity"]/1000,r["amount"]/100,r["documents"]] for r in data])
    return data


@app.get("/api/month")
def month(db:DB,user:User,month:Annotated[str,Query(pattern=r"^20\d\d-(0[1-9]|1[0-2])$")],xlsx:bool=False):
    allow(user,"admin","accountant")
    data=read.month_summary(db,month)
    if xlsx:
        rows=[[r["name"],r["opening"]/1000,r["incoming"]/1000,r["outgoing"]/1000,r["closing"]/1000] for r in data["flows"]]
        book=workbook_sheet("Выпуск и остатки",["Склад","На начало","Приход","Расход","На конец"],rows)
        page=book.create_sheet("Себестоимость")
        page.append(["Статья","Сумма, ₽"])
        for label,key in [("НЗП на начало","opening"),("Материалы","material"),("Сдельные начисления","wages"),("Прочие затраты","overhead"),("НЗП на конец","closing"),("Себестоимость выпуска","total")]:
            page.append([label,data[key]/100])
        return send_book(book,"Итоги месяца — "+month)
    return data


def workbook_sheet(title,headers,rows):
    wb=Workbook()
    ws=wb.active
    ws.title=title
    ws.append(headers)
    for col in ws[1]:
        col.fill=PatternFill("solid",fgColor="6F38E9")
        col.font=Font(color="FFFFFF",bold=True)
        ws.column_dimensions[col.column_letter].width=min(36,max(19,len(str(col.value))+4))
    for row in rows:
        ws.append(row)
        for cell in ws[ws.max_row]:
            if isinstance(cell.value,str):
                cell.data_type="s"
    ws.freeze_panes="A2"
    ws.auto_filter.ref=ws.dimensions
    return wb


def send_book(book,filename):
    output=BytesIO()
    book.save(output)
    output.seek(0)
    return StreamingResponse(output,media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition":f"attachment; filename=export.xlsx; filename*=UTF-8''{quote(filename+'.xlsx',safe='')}"})


def export_xlsx(filename,headers,rows):
    return send_book(workbook_sheet("Реестр",headers,rows),filename)


dist=ROOT / "dist"
public_dir=ROOT / "web" / "public"


def _resolve_static_file(*parts):
    for base in (dist, public_dir):
        candidate = (base.joinpath(*parts)).resolve()
        if candidate.is_relative_to(base.resolve()) and candidate.is_file():
            return candidate
    return None


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    target = _resolve_static_file("sw.js")
    if not target:
        raise HTTPException(404, "Service worker not found")
    return FileResponse(
        target,
        media_type="application/javascript; charset=utf-8",
        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
    )


@app.get("/manifest.webmanifest", include_in_schema=False)
def web_manifest():
    target = _resolve_static_file("manifest.webmanifest")
    if not target:
        raise HTTPException(404, "Web manifest not found")
    return FileResponse(
        target,
        media_type="application/manifest+json; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/icons/{filename:path}", include_in_schema=False)
def pwa_icon(filename: str):
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(404, "Icon not found")
    target = _resolve_static_file("icons", filename)
    if not target:
        raise HTTPException(404, "Icon not found")
    media = "image/png" if target.suffix == ".png" else "image/svg+xml" if target.suffix == ".svg" else None
    return FileResponse(target, media_type=media, headers={"Cache-Control": "public, max-age=86400"})


if dist.exists():
    app.mount("/",StaticFiles(directory=dist,html=True),name="desktop")
