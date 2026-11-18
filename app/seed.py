"""Reproducible operating history for a fictional Ivanovo textile factory."""

from datetime import date, timedelta
from decimal import Decimal
from random import Random

from .db import now, STAGES, WAREHOUSES, line_cost, password_hash, scalar, today
from .operations import (
    balance, movement, new_document, post_report, receive_transfer, save_receipt,
    save_recipe, save_report, save_sale, save_transfer, send_transfer, set_status,
)
from .schemas import ItemLine, Receipt, Recipe, Report, Sale, Transfer

MATERIALS = [
    ("Бязь набивная", "м", "Ткани", 14800),
    ("Поплин мерсеризованный", "м", "Ткани", 18500),
    ("Сатин хлопковый", "м", "Ткани", 25400),
    ("Ткань перкаль", "м", "Ткани", 20200),
    ("Нитки белые 40/2", "м", "Нитки", 15),
    ("Нитки графит 40/2", "м", "Нитки", 17),
    ("Молния потайная · 50 см", "шт.", "Фурнитура", 2200),
    ("Этикетка вшивная", "шт.", "Маркировка", 230),
    ("Пакет для комплекта", "шт.", "Упаковка", 1320),
    ("Вкладыш с составом", "шт.", "Упаковка", 370),
    ("Коробка транспортная", "шт.", "Упаковка", 5800),
    ("Резинка бельевая 10 мм", "м", "Фурнитура", 620),
]
MODELS = [
    ("Шахматы", 1, 1990), ("Каролина", 2, 2690), ("Аниме", 1, 2190),
    ("СДЖ", 1, 1950), ("Полдень", 3, 3590), ("Лён и небо", 4, 2990),
    ("Мята", 2, 2790), ("Волга", 4, 3290),
]
SIZES = ["1,5-спальный", "Двуспальный", "Евро"]
SUPPLIERS = ["Текстильная линия", "Волжская фурнитура", "Швейкомплект", "Партия Ткани", "Северная упаковка"]
FIRST = ["Елена", "Вера", "Алёна", "Анастасия", "Светлана", "Марина", "Юлия", "Наталья", "Ирина", "Людмила", "Ольга", "Татьяна", "Екатерина", "Надежда", "Галина", "Алина"]
LAST = ["Крылова", "Степанова", "Соловьёва", "Котова", "Смирнова", "Фролова", "Мальцева", "Морозова", "Антонова", "Романова", "Полянская", "Лобанова", "Виноградова", "Киселёва", "Рябова", "Корнеева"]


def timestamp(day, hour, minute=0):
    return f"{day}T{hour:02}:{minute:02}:00+03:00"


def fill_regional_stock(db, day, at):
    """Seed stocked retail locations through ordinary document movements."""
    products = [row[0] for row in db.execute("SELECT id FROM items WHERE kind='product' ORDER BY id")]
    for warehouse in range(6, 10):
        if sum(balance(db, warehouse, item)[0] for item in products) >= 120_000:
            continue
        selected = sorted(products, key=lambda item: (balance(db, warehouse, item)[0], -balance(db, 5, item)[0]))
        lines = []
        for item in selected:
            quantity, cost = balance(db, 5, item)
            if quantity < 34_000:
                continue
            price = (Decimal(cost) * 10 / quantity).quantize(Decimal(".01"))
            lines.append(ItemLine(item_id=item, quantity=22, price=price))
            if len(lines) == 6:
                break
        if lines:
            dispatch = Transfer(date=day, target_id=warehouse, lines=lines, memo="Пополнение базового ассортимента")
            document = save_transfer(db, dispatch, 2, at=at)
            send_transfer(db, document, 2, at=at, historical=True)
            receive_transfer(db, document, warehouse - 3, at=at)


def seed(db):
    if scalar(db, "SELECT count(*) FROM settings WHERE key='seeded'"):
        return
    random = Random(420183)
    end = date.fromisoformat(today())
    start = min(date(2025, 1, 1), end.replace(day=1))
    db.executemany("INSERT INTO warehouses VALUES(?,?,?,?,?)", [
        (1, "Склад сырья", "Иваново", "Промышленная площадка · корпус 1", "raw"),
        (2, "Склад кроя", "Иваново", "Производство · раскройный цех", "cut"),
        (3, "Склад пошива", "Иваново", "Производство · швейный цех", "sew"),
        (4, "Склад упаковки", "Иваново", "Производство · участок упаковки", "pack"),
        (5, "Склад готовой продукции", "Иваново", "Промышленная площадка · корпус 2", "finished"),
        (6, "Региональный склад", "Москва", "Капотня · складской комплекс", "regional"),
        (7, "Региональный склад", "Санкт-Петербург", "Фрунзенский район · складской комплекс", "regional"),
        (8, "Региональный склад", "Ярославль", "Фрунзенский район · распределительный склад", "regional"),
        (9, "Региональный склад", "Нижний Новгород", "Канавинский район · распределительный склад", "regional"),
    ])
    people = [
        ("Оксана Евгеньевна", "office", "Главный бухгалтер"), ("Ирина Воронова", "office", "Администратор"),
        ("Сергей Синицын", "office", "Мастер смены"), ("Анна Павлова", "warehouse", "Кладовщик"),
        ("Дмитрий Суриков", "warehouse", "Кладовщик"), ("Мария Калашникова", "warehouse", "Кладовщик"),
        ("Илья Новиков", "warehouse", "Кладовщик"),
    ]
    workers = {}
    for i, (stage, position) in enumerate(zip(STAGES, ["Закройщик","Швея","Упаковщик"])):
        workers[stage] = list(range(len(people)+1, len(people)+17))
        people.extend((f"{first} {LAST[(j+i*5)%16]}", stage, position) for j, first in enumerate(FIRST))
    people += [("Арен Мартиросян","cut","Закройщик"),("Манвел Саркисян","sew","Швея"),("Ситора Каримова","pack","Упаковщик"),("Фарид Хамиди","cut","Закройщик"),("Лейла Юсупова","pack","Упаковщик"),
               ("Павел Белов","warehouse","Кладовщик"),("Виктория Громова","warehouse","Кладовщик"),("Андрей Жуков","office","Технолог")]
    for i, (name, stage, position) in enumerate(people,1):
        signed = start - timedelta(days=random.randint(50, 900))
        db.execute("INSERT INTO staff VALUES(?,?,?,?,?,1)", (i,name,stage,position,str(signed)))
        if i > 55 and stage in workers:
            workers[stage].append(i)
    accounts = [
        (1, "Ирина В.", "admin@factory.local", "admin", 2),
        (2, "Оксана Е.", "oksana@factory.local", "accountant", 1),
        (3, "Анна П.", "moscow@factory.local", "regional", 4),
        (4, "Дмитрий С.", "petersburg@factory.local", "regional", 5),
        (5, "Мария К.", "yaroslavl@factory.local", "regional", 6),
        (6, "Илья Н.", "nizhny@factory.local", "regional", 7),
        (7, "Сергей С.", "master@factory.local", "master", 3),
    ]
    for uid,name,email,role,employee in accounts:
        db.execute("INSERT INTO users VALUES(?,?,?,?,?,?)", (uid,name,email,password_hash("Ivanovo!2026"),role,employee))
    for warehouse, user in enumerate(range(3,7),6):
        db.execute("INSERT INTO grants VALUES(?,?,?,1)", (user,warehouse,timestamp(start,8)))
    for mid,(name,unit,category,cost) in enumerate(MATERIALS,1):
        db.execute("INSERT INTO items VALUES(?,?,?,?,?,?,?,?)", (mid,"raw",f"МТ-{mid:03}",name,"",unit,category,cost))
    products = []
    for ix, (name, fabric, price) in enumerate(MODELS):
        for sx,size in enumerate(SIZES):
            pid = 100 + ix*3+sx
            products.append(pid)
            db.execute("INSERT INTO items VALUES(?,?,?,?,?,?,?,?)",(pid,"product",f"КПБ-{ix+1:02}{sx+1}",name,size,"компл.","Постельное бельё",(price+sx*250)*100))
            norms = [
                {"item_id":fabric,"stage":"cut","quantity":Decimal("6.40")+Decimal("0.48")*sx+Decimal("0.03")*ix},
                {"item_id":5 if ix%2==0 else 6,"stage":"sew","quantity":78+sx*7},
                {"item_id":7,"stage":"sew","quantity":1},{"item_id":8,"stage":"sew","quantity":1},
                {"item_id":9,"stage":"pack","quantity":1},{"item_id":10,"stage":"pack","quantity":1},
            ]
            for version, effective in [(1,str(start)), (2,"2025-07-01"), (3,"2026-03-01")]:
                if effective < str(start) or effective > str(end):
                    continue
                recipe = Recipe(norms=norms,cut=18+sx+2*(version-1),sew=65+sx*5+ix+2*(version-1),pack=8+version-1)
                save_recipe(db,pid,recipe,effective)
    opening = new_document(db,"opening",str(start),1,timestamp(start,7),memo="Остатки по инвентаризации на начало учёта")
    for mid,(_,unit,_,price) in enumerate(MATERIALS,1):
        qty = (random.randint(3400,5400) if mid<=4 else random.randint(120000,185000) if mid<=6 else random.randint(2500,4200))*1000
        movement(db,opening,1,mid,qty,line_cost(qty,price),timestamp(start,7),"opening")
    for pid in products:
        for w in range(2,10):
            qty = random.randint(7,18) if w<=4 else random.randint(35,62) if w==5 else random.randint(15,36)
            cost = [0,0,800,1040,1040,1090,1090,1090,1090,1090][w]*100
            movement(db,opening,w,pid,qty*1000,qty*cost,timestamp(start,7),"opening")
    set_status(db,opening,"posted",1,timestamp(start,7))
    scheduled = {}
    num = 0
    day = start
    while day <= end:
        for tid,actor in scheduled.pop(day,[]):
            receive_transfer(db,tid,actor,timestamp(day,8,15))
        if day.weekday() < 5:
            restock = []
            for mid,(_,_,_,price) in enumerate(MATERIALS,1):
                available, _ = balance(db,1,mid)
                limit = 2300 if mid<=4 else 46000 if mid<=6 else 520
                if available < limit*1000:
                    qty = random.randint(3150,5600) if mid<=4 else random.randint(135000,220000) if mid<=6 else random.randint(1800,3500)
                    restock.append(ItemLine(item_id=mid,quantity=qty,price=Decimal(price+random.randint(-6,8) if price>100 else price)/100))
            if restock:
                receipt = Receipt(date=day,supplier=SUPPLIERS[num%len(SUPPLIERS)],reference=f"УПД № {day.strftime('%y%m%d')}-{num%9+1}",lines=restock,memo="Принято по накладной поставщика")
                save_receipt(db,receipt,2,timestamp(day,8,25),historical=True)
            if day == end:
                subset = [100,105]
                quantities = [120,80]
            else:
                subset = random.sample(products,random.choice([2,3,3,4]))
                quantities = [random.randint(36,96) for _ in subset]
            sewed = [qty-random.randrange(0,3) for qty in quantities]
            packed = [qty-random.randrange(0,3) for qty in sewed]
            if day == end and len(subset)==2:
                sewed = [100,80]
                packed = [90,70]
            for stage, counts, hour in zip(STAGES,[quantities,sewed,packed],[9,13,16]):
                lines = []
                for pid,qty in zip(subset,counts):
                    assigned = random.sample(workers[stage],2 if qty>55 else 1)
                    divis = [qty] if len(assigned)==1 else [qty//2,qty-qty//2]
                    lines.append({"item_id":pid,"quantity":qty,"prepared":sewed[subset.index(pid)] if day==end and stage=="pack" else qty if stage=="pack" else 0,
                                  "assignments":[{"staff_id":a,"quantity":b} for a,b in zip(assigned,divis)]})
                doc = save_report(db,Report(date=day,stage=stage,lines=lines),2,at=timestamp(day,hour,20),historical=True)
                post_report(db,doc,2,timestamp(day,hour,26),historical=True)
            num += 1
            if num%5!=4 or day==end:
                for w in ([6,7] if day==end else [6+num%4,6+(num+1)%4]):
                    available = [(pid, balance(db,5,pid)[0]//1000) for pid in products]
                    ranked = [pair for pair in sorted(available,key=lambda pair:pair[1],reverse=True) if pair[1]>20][:12]
                    if not ranked:
                        continue
                    shipment = [ItemLine(item_id=pid,quantity=min(qty-12,random.randint(17,42)),price=random.choice([1120,1250,1420,1580]))
                                for pid,qty in random.sample(ranked,min(len(ranked),random.randint(3,5)))]
                    ship = Transfer(date=day,target_id=w,lines=shipment,memo="Пополнение запаса по ассортименту")
                    tid = save_transfer(db,ship,2,at=timestamp(day,16,45))
                    send_transfer(db,tid,2,timestamp(day,16,53),historical=True)
                    if day == end and w==6:
                        receive_transfer(db,tid,w-3,timestamp(day,17,3))
                    else:
                        scheduled.setdefault(day+timedelta(days=1 if w in (6,8) else 2),[]).append((tid,w-3))
        for w in range(6,10):
            for attempt in range(random.randint(2,5)):
                options = [pid for pid in products if balance(db,w,pid)[0]>=1000]
                if not options:
                    continue
                lines = [ItemLine(item_id=pid,quantity=min(random.randint(1,14),balance(db,w,pid)[0]//1000))
                         for pid in random.sample(options, min(len(options), random.choice([1,1,2,3])))]
                payload = Sale(warehouse_id=w,payment=random.choice(["card","card","card","cash"]),request_key=f"history-{w}-{day.isoformat()}-{attempt}",lines=lines)
                save_sale(db,payload,w-3,w,timestamp(day, min(20, 16+attempt), random.randrange(1,58)))
        day += timedelta(days=1)
    fill_regional_stock(db, end, now())
    for stage in STAGES:
        lines = [{"item_id":100 if stage=="cut" else 105,"quantity":240 if stage=="cut" else 12,
                  "prepared":12 if stage=="pack" else 0,"assignments":[]}]
        save_report(db,Report(date=end,stage=stage,lines=lines,memo="Сверка выработки с журналом участка"),2,
                    at=timestamp(end,19,30),historical=True)
    save_transfer(db,Transfer(date=end,target_id=6,memo="Поставка к следующей смене",lines=[{"item_id":100,"quantity":18,"price":1120}]),2,at=timestamp(end,19,40))
    month = start.replace(day=1)
    while month <= end:
        db.execute("INSERT INTO overhead VALUES(?,?,?)",(str(month)[:7],random.randint(85_000,165_000)*100,"Электроэнергия, обслуживание оборудования и расходы цехов"))
        month=(month+timedelta(days=32)).replace(day=1)
    db.executemany("INSERT INTO settings VALUES(?,?)", [("seeded","1"),("open_month",str(end)[:7]),("company","Швейная фабрика"),("language","Русский")])
