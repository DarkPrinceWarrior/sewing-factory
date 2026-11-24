import io
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.db import connect, records, today
from app.main import app


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    with pytest.MonkeyPatch.context() as env:
        env.setenv("FACTORY_DB", str(tmp_path_factory.mktemp("factory") / "data.sqlite3"))
        with TestClient(app) as client:
            yield client


def login(client, prefix):
    client.cookies.clear()
    result = client.post("/api/login", json={"email":prefix+"@factory.local","password":"Ivanovo!2026"})
    assert result.status_code == 200
    return client.get("/api/workspace").json()


def amount(client, depot, item):
    rows = client.get(f"/api/warehouses/{depot}").json()["rows"]
    return next((row["quantity"] for row in rows if row["item_id"] == item), 0)


def test_seed_and_exports(client):
    ws = login(client, "admin")
    assert len(ws["staff"]) >= 60
    assert len(ws["warehouses"]) == 9
    assert len([i for i in ws["items"] if i["kind"] == "product"]) == 24
    since = client.get("/api/documents/report?start=2025-01-01&end=2025-01-31").json()
    assert since["total"] > 40
    assert client.get("/api/documents/sale").json()["total"] > 5000
    res = client.get("/api/documents/report?start=2025-01-01&end=2025-01-31&xlsx=true")
    file = load_workbook(io.BytesIO(res.content), data_only=True)
    assert file.active.max_row == since["total"] + 1
    with connect() as db:
        assert not records(db, """
          SELECT b.warehouse_id,b.item_id FROM balances b LEFT JOIN
            (SELECT warehouse_id,item_id,SUM(quantity) q,SUM(value) v
             FROM movements GROUP BY warehouse_id,item_id) m
          USING (warehouse_id,item_id) WHERE b.quantity != m.q OR b.value != m.v
        """)
        assert not records(db, "SELECT * FROM balances WHERE quantity<0 OR value<0")


def test_report_posts_effects_together(client):
    ws = login(client, "oksana")
    worker = next(p for p in ws["staff"] if p["stage"] == "cut")
    item, fabric = 100, 1
    raw_before, output_before = amount(client, 1, fabric), amount(client, 2, item)
    payload = {"date": today(), "stage": "cut", "lines": [{"item_id": item, "quantity": 5}]}
    count = client.get("/api/documents/report").json()["total"]
    preview = client.post("/api/reports/preview", json=payload)
    assert preview.status_code == 200
    assert preview.json()["lines"][0]["materials"][0]["quantity"] > 0
    assert client.get("/api/documents/report").json()["total"] == count
    rejected = client.post("/api/reports?post=true", json=payload)
    assert rejected.status_code == 409
    assert client.get("/api/documents/report").json()["total"] == count
    assert amount(client,1,fabric) == raw_before

    payload["lines"][0]["assignments"] = [{"staff_id": worker["id"], "quantity": 5}]
    report = client.post("/api/reports?post=true", json=payload)
    assert report.status_code == 200, report.text
    report = report.json()
    assert report["status"] == "posted"
    assert amount(client, 2, item) == output_before + 5000
    assert amount(client,1,fabric) == raw_before - report["lines"][0]["materials"][0]["quantity"]
    assert report["wages"] == report["lines"][0]["assignments"][0]["rate"] * 5

    correction = client.post(f'/api/reports/{report["id"]}/correct', json={"reason":"Уточнена выработка смены"})
    assert correction.status_code == 200, correction.text
    corr = correction.json()
    assert corr["source_doc"] == report["id"]
    assert corr["source_code"] == report["code"]
    original_after = client.get(f'/api/document/{report["id"]}').json()
    assert original_after["replacement_id"] == corr["id"]
    assert original_after["replacement_code"] == corr["code"]
    listed = client.get(f'/api/documents/report?search={report["code"]}').json()["rows"]
    assert any(r["id"] == report["id"] and r["replacement_id"] == corr["id"] for r in listed)
    assert amount(client,2,item) == output_before
    assert amount(client,1,fabric) == raw_before


def test_transfer_and_sale_respect_warehouse_scope(client):
    ws = login(client, "admin")
    item = 100
    finished, moscow = amount(client,5,item), amount(client,6,item)
    payload = {"date":today(),"target_id":6,"lines":[{"item_id":item,"quantity":3,"price":"1590"}]}
    draft = client.post("/api/transfers", json=payload)
    assert draft.status_code == 200, draft.text
    doc = draft.json()["id"]
    assert amount(client,5,item) == finished
    assert amount(client,6,item) == moscow

    payload["lines"][0]["quantity"] = 4
    sent = client.post(f"/api/transfers/{doc}/send", json=payload)
    assert sent.status_code == 200 and sent.json()["status"] == "in_transit"
    assert amount(client,5,item) == finished - 4000
    assert amount(client,6,item) == moscow
    assert client.post(f"/api/transfers/{doc}/send").status_code == 409

    ws = login(client, "petersburg")
    assert [w["id"] for w in ws["warehouses"]] == [7]
    assert client.get("/api/warehouses/6").status_code == 404
    assert client.get(f"/api/document/{doc}").status_code == 404
    assert client.post(f"/api/transfers/{doc}/receive").status_code == 404
    assert client.get("/api/payroll").status_code == 403
    assert client.get("/api/access").status_code == 403

    login(client, "moscow")
    received = client.post(f"/api/transfers/{doc}/receive")
    assert received.status_code == 200 and received.json()["status"] == "received"
    assert amount(client,6,item) == moscow + 4000
    assert client.post(f"/api/transfers/{doc}/receive").status_code == 409
    sale = {"payment":"card","request_key":str(uuid4()),"lines":[{"item_id":item,"quantity":2}]}
    assert client.post("/api/sales", json={**sale,"warehouse_id":7}).status_code == 403
    sold = client.post("/api/sales", json=sale)
    assert sold.status_code == 200, sold.text
    assert sold.json()["total"] == 398000
    assert client.post("/api/sales", json=sale).json()["id"] == sold.json()["id"]
    assert amount(client,6,item) == moscow + 2000
    sale["request_key"] = str(uuid4())
    sale["lines"][0]["quantity"] = 100000
    assert client.post("/api/sales", json=sale).status_code == 409
    assert amount(client,6,item) == moscow + 2000


def test_revoke_access_invalidates_existing_session(client):
    login(client, "moscow")
    cookie = client.cookies.get("factory_session")
    login(client, "admin")
    assert client.delete("/api/access/4").status_code == 200
    with TestClient(app, cookies={"factory_session":cookie}) as former:
        assert former.get("/api/workspace").status_code == 401
    result = client.put("/api/access",json={"staff_id":4,"warehouse_id":6})
    assert result.status_code == 200
    login(client, "moscow")


def test_raw_stock_draft_then_receipt(client):
    login(client, "oksana")
    start = amount(client, 1, 1)
    payload = {"date":today(),"supplier":"Текстильная линия","reference":"УПД-149-Н",
               "lines":[{"item_id":1,"quantity":"200.25","price":"154.20"}]}
    draft = client.post("/api/receipts?post=false", json=payload)
    assert draft.status_code == 200, draft.text
    doc = draft.json()
    assert doc["status"] == "draft"
    assert amount(client, 1, 1) == start
    posted = client.put(f'/api/receipts/{doc["id"]}?post=true', json=payload)
    assert posted.status_code == 200, posted.text
    assert posted.json()["movements"][0]["balance_after"] == start+200250
    assert amount(client, 1, 1) == start+200250
    assert client.put(f'/api/receipts/{doc["id"]}?post=true', json=payload).status_code == 409
    assert amount(client, 1, 1) == start+200250


def test_document_search_and_sales_summary_use_the_same_scope(client):
    login(client, "admin")
    q = {"search":"шахматы москва","warehouse":6,"start":"2026-01-01","limit":3}
    journal = client.get("/api/documents/sale",params=q).json()
    assert journal["total"] > 3
    assert all(row["source_city"]=="Москва" for row in journal["rows"])
    summary = client.get("/api/sales-summary",params=q).json()
    assert summary["documents"] == journal["total"]
    assert len(summary["cities"]) == 1
    assert sum(p["docs"] for p in summary["payments"]) == summary["documents"]
    assert sum(p["total"] for p in summary["payments"]) == summary["total"]
    export = client.get("/api/documents/sale",params={**q,"xlsx":"true"})
    rows = list(load_workbook(io.BytesIO(export.content),data_only=True).active.values)
    assert len(rows) == journal["total"]+1
    assert round(sum(row[-1] for row in rows[1:])*100) == summary["total"]
    assert "filename*=UTF-8" in export.headers["Content-Disposition"]

    login(client, "petersburg")
    assert client.get("/api/documents/sale",params=q).json()["total"] == 0
    assert client.get("/api/sales-summary",params=q).json()["documents"] == 0


def test_search_on_stock_and_movements_exports_filtered_records(client):
    login(client,"moscow")
    path="/api/warehouses/6"
    search={"search":"ШАХМАТЫ спальный"}
    stock=client.get(path,params=search).json()["rows"]
    assert len(stock)==2
    workbook=load_workbook(io.BytesIO(client.get(path,params={**search,"xlsx":"true"}).content),data_only=True)
    rows=list(workbook.active.values)
    assert rows[0][-1]=="Розничная цена, ₽"
    assert {row[0] for row in rows[1:]}=={item["sku"] for item in stock}
    assert sorted(row[-1] for row in rows[1:])==sorted(r["price"]/100 for r in stock)
    path+="/movements"
    movements=client.get(path,params={**search,"limit":2}).json()
    assert movements["total"]>2
    rows=list(load_workbook(io.BytesIO(client.get(path,params={**search,"xlsx":"true"}).content)).active.values)
    assert len(rows)==movements["total"]+1
    assert "Стоимость движения, ₽" not in rows[0]


def test_duplicate_receipt_and_payroll_scope(client):
    login(client,"oksana")
    payload={"date":today(),"supplier":"Партия Ткани","reference":"УПД-1880",
             "lines":[{"item_id":1,"quantity":"1.25","price":"150.00"}]}
    before=amount(client,1,1)
    assert client.post("/api/receipts",json=payload).status_code==200
    duplicated=client.post("/api/receipts",json={**payload,"supplier":"партия ткани","reference":"упд-1880"})
    assert duplicated.status_code==409
    assert amount(client,1,1)==before+1250
    q={"search":"фарид","start":"2025-01-01","end":today()}
    payroll=client.get("/api/payroll",params=q).json()
    assert [r["id"] for r in payroll]==[59]
    rows=list(load_workbook(io.BytesIO(client.get("/api/payroll",params={**q,"xlsx":"true"}).content)).active.values)
    assert len(rows)==3
    assert list(rows[0])==["Сотрудник","Начисление, ₽","Проезд, ₽","Долг, ₽","Аванс, ₽","НДФЛ, ₽","Итого, ₽"]
    assert rows[-1][0]=="Итого"
    login(client,"master")
    master_staff=client.get("/api/staff/59").json()
    assert master_staff["rows"]==[] and master_staff["hourly_rows"]==[] and master_staff["summary"] is None
    assert client.get("/api/staff/59?xlsx=true").status_code==403


def test_role_boundaries_matrix(client):
    login(client, "admin")
    report_id = client.get("/api/documents/report?status=posted&limit=1").json()["rows"][0]["id"]
    draft_transfer_id = client.get("/api/documents/transfer?status=draft&limit=1").json()["rows"][0]["id"]
    receipt_id = client.get("/api/documents/receipt?limit=1").json()["rows"][0]["id"]
    sale_id = client.get("/api/documents/sale?limit=1").json()["rows"][0]["id"]

    # Master boundaries
    ws_master = login(client, "master")
    assert "in_transit" not in ws_master
    assert all(w["kind"] != "regional" for w in ws_master["warehouses"])
    assert client.get("/api/overview").status_code == 200
    assert client.get("/api/catalog/100").status_code == 200
    assert client.get("/api/warehouses/1").status_code == 200
    assert client.get("/api/warehouses/6").status_code == 404
    assert client.get("/api/payroll").status_code == 403
    assert client.get(f"/api/month?month={today()[:7]}").status_code == 403
    assert client.post(f"/api/reports/{report_id}/correct", json={"reason": "test"}).status_code == 403
    for kind in ("receipt", "transfer", "sale"):
        assert client.get(f"/api/documents/{kind}").status_code == 403
    assert client.get(f"/api/document/{receipt_id}").status_code == 404
    assert client.get(f"/api/document/{draft_transfer_id}").status_code == 404
    assert client.get(f"/api/document/{sale_id}").status_code == 404
    assert client.get("/api/sales-summary").status_code == 403
    assert client.get("/api/access").status_code == 403
    assert client.post("/api/warehouses", json={"city": "Тверь", "name": "Склад", "address": "Улица 1"}).status_code == 403
    assert client.post("/api/receipts", json={"date": today(), "supplier": "S", "reference": "R", "lines": [{"item_id": 1, "quantity": 1, "price": 10}]}).status_code == 403
    assert client.post("/api/transfers", json={"date": today(), "target_id": 6, "lines": [{"item_id": 100, "quantity": 1, "price": 10}]}).status_code == 403
    assert client.post("/api/catalog", json={"sku": "X-1", "name": "Test", "size": "Евро", "category": "КПБ", "price": 100, "cut": 10, "sew": 20, "pack": 5, "norms": [{"item_id": 1, "stage": "cut", "quantity": 1}, {"item_id": 5, "stage": "sew", "quantity": 1}, {"item_id": 9, "stage": "pack", "quantity": 1}]}).status_code == 403
    assert client.post("/api/catalog/100/versions", json={"cut": 10, "sew": 20, "pack": 5, "norms": [{"item_id": 1, "stage": "cut", "quantity": 1}, {"item_id": 5, "stage": "sew", "quantity": 1}, {"item_id": 9, "stage": "pack", "quantity": 1}]}).status_code == 403
    assert client.post("/api/staff", json={"name": "Новый", "stage": "cut", "position": "Закройщик", "hired_on": today(), "active": True}).status_code == 403
    assert client.put("/api/staff/59", json={"name": "Фарид Хамиди", "stage": "cut", "position": "Закройщик", "hired_on": "2025-01-01", "active": True}).status_code == 403
    assert client.post("/api/sales", json={"payment": "card", "request_key": str(uuid4()), "lines": [{"item_id": 100, "quantity": 1}]}).status_code == 403
    # Opening document (id=1) movements must exclude regional warehouses for master
    opening = client.get("/api/document/1")
    if opening.status_code == 200 and opening.json()["kind"] == "opening":
        assert all(m["warehouse_id"] <= 5 for m in opening.json()["movements"])

    # Accountant boundaries
    login(client, "oksana")
    assert client.get("/api/access").status_code == 403
    assert client.put("/api/access", json={"staff_id": 4, "warehouse_id": 6}).status_code == 403
    assert client.delete("/api/access/4").status_code == 403
    assert client.post("/api/warehouses", json={"city": "Тверь", "name": "Склад", "address": "Улица 1"}).status_code == 403
    assert client.post("/api/sales", json={"warehouse_id": 1, "payment": "card", "request_key": str(uuid4()), "lines": [{"item_id": 100, "quantity": 1}]}).status_code == 422
    assert client.post("/api/transfers", json={"date": "2025-01-01", "target_id": 6, "lines": [{"item_id": 100, "quantity": 1, "price": 100}]}).status_code == 422
    assert client.post("/api/catalog", json={"sku": "ZERO-1", "name": "Zero", "size": "Евро", "category": "КПБ", "price": 0, "cut": 10, "sew": 20, "pack": 5, "norms": [{"item_id": 1, "stage": "cut", "quantity": 1}, {"item_id": 5, "stage": "sew", "quantity": 1}, {"item_id": 9, "stage": "pack", "quantity": 1}]}).status_code == 422

    # Regional boundaries
    ws_reg = login(client, "moscow")
    assert [w["id"] for w in ws_reg["warehouses"]] == [6]
    assert "value" not in ws_reg["warehouses"][0]
    assert "staff" not in ws_reg and "settings" not in ws_reg
    moscow_stock = client.get("/api/warehouses/6").json()["rows"]
    assert moscow_stock and all("value" not in r for r in moscow_stock)
    moscow_moves = client.get("/api/warehouses/6/movements?limit=5").json()["rows"]
    assert moscow_moves and all("value" not in r for r in moscow_moves)
    moscow_sales = client.get("/api/documents/sale?limit=5").json()["rows"]
    assert moscow_sales and all("book_value" not in r for r in moscow_sales)
    moscow_sale_detail = client.get(f"/api/document/{moscow_sales[0]['id']}").json()
    assert "book_value" not in moscow_sale_detail
    assert all("book_value" not in l for l in moscow_sale_detail["lines"])
    assert all("value" not in m for m in moscow_sale_detail["movements"])
    moscow_summary = client.get("/api/sales-summary").json()
    assert "cost" not in moscow_summary and all("cost" not in c for c in moscow_summary["cities"])
    assert client.get("/api/overview").status_code == 403
    assert client.get("/api/documents/report").status_code == 403
    assert client.get("/api/documents/receipt").status_code == 403
    assert client.get("/api/documents/transfer?status=draft").json()["total"] == 0
    assert client.get(f"/api/document/{draft_transfer_id}").status_code == 404
    assert client.get("/api/warehouses/1").status_code == 404
    assert client.get("/api/warehouses/7").status_code == 404
    assert client.get("/api/catalog/100").status_code == 403
    assert client.get("/api/staff/59").status_code == 403
    assert client.get("/api/payroll").status_code == 403
    assert client.get(f"/api/month?month={today()[:7]}").status_code == 403
    assert client.get("/api/access").status_code == 403
    assert client.post("/api/warehouses", json={"city": "Тверь", "name": "Склад", "address": "Улица 1"}).status_code == 403


def test_access_reassignment_staff_stage_and_password_rotation(client):
    # 1. Warehouse reassignment invalidates old session and switches warehouse
    login(client, "moscow")
    old_cookie = client.cookies.get("factory_session")
    login(client, "admin")
    assert client.put("/api/access", json={"staff_id": 4, "warehouse_id": 7}).status_code == 200
    with TestClient(app, cookies={"factory_session": old_cookie}) as stale:
        assert stale.get("/api/workspace").status_code == 401
    ws = login(client, "moscow")
    assert [w["id"] for w in ws["warehouses"]] == [7]

    # 2. Moving regional keeper's staff stage off 'warehouse' revokes grant & session
    moscow_cookie = client.cookies.get("factory_session")
    login(client, "admin")
    staff_info = client.get("/api/staff/4").json()["staff"]
    assert client.put("/api/staff/4", json={
        "name": staff_info["name"], "stage": "office", "position": staff_info["position"],
        "hired_on": staff_info["hired_on"], "active": True,
    }).status_code == 200
    with TestClient(app, cookies={"factory_session": moscow_cookie}) as stale:
        assert stale.get("/api/workspace").status_code == 401
    client.cookies.clear()
    assert client.post("/api/login", json={"email": "moscow@factory.local", "password": "Ivanovo!2026"}).status_code == 403

    # Restore staff stage and original warehouse grant
    login(client, "admin")
    assert client.put("/api/staff/4", json={
        "name": staff_info["name"], "stage": "warehouse", "position": staff_info["position"],
        "hired_on": staff_info["hired_on"], "active": True,
    }).status_code == 200
    assert client.put("/api/access", json={"staff_id": 4, "warehouse_id": 6}).status_code == 200

    # 3. Password change invalidates old sessions and keeps current session valid
    login(client, "moscow")
    first_cookie = client.cookies.get("factory_session")
    login(client, "moscow")
    assert client.post("/api/password", json={"old": "Ivanovo!2026", "new": "NewSecret!2026"}).status_code == 200
    assert client.get("/api/workspace").status_code == 200
    with TestClient(app, cookies={"factory_session": first_cookie}) as stale:
        assert stale.get("/api/workspace").status_code == 401
    client.cookies.clear()
    assert client.post("/api/login", json={"email": "moscow@factory.local", "password": "Ivanovo!2026"}).status_code == 401
    assert client.post("/api/login", json={"email": "moscow@factory.local", "password": "NewSecret!2026"}).status_code == 200
    # Restore default password
    assert client.post("/api/password", json={"old": "NewSecret!2026", "new": "Ivanovo!2026"}).status_code == 200


def test_session_cookie_secure_flag_matches_transport(client, monkeypatch):
    client.cookies.clear()
    http_login = client.post("/api/login", json={"email": "admin@factory.local", "password": "Ivanovo!2026"})
    assert http_login.status_code == 200
    assert "secure" not in http_login.headers["set-cookie"].lower()

    client.cookies.clear()
    https_login = client.post(
        "/api/login",
        json={"email": "admin@factory.local", "password": "Ivanovo!2026"},
        headers={"X-Forwarded-Proto": "https, http"},
    )
    assert https_login.status_code == 200
    assert "secure" in https_login.headers["set-cookie"].lower()

    https_logout = client.post("/api/logout", headers={"X-Forwarded-Proto": "https"})
    assert https_logout.status_code == 200
    assert "secure" in https_logout.headers["set-cookie"].lower()

    monkeypatch.setenv("COOKIE_SECURE", "true")
    env_login = client.post("/api/login", json={"email": "admin@factory.local", "password": "Ivanovo!2026"})
    assert env_login.status_code == 200
    assert "secure" in env_login.headers["set-cookie"].lower()


def test_flexible_spec_norms_zero_and_multiple_materials(client):
    ws = login(client, "oksana")
    cutter = next(p for p in ws["staff"] if p["stage"] == "cut" and p["active"])
    # 1. Create product with 0 material norms
    created = client.post("/api/catalog", json={
        "sku": "FLEX-001", "name": "Наволочка без списания", "size": "50×70", "category": "Постельное бельё",
        "price": "590.00", "cut": "15.00", "sew": "35.00", "pack": "10.00", "norms": [],
    })
    assert created.status_code == 200, created.text
    pid = created.json()["id"]
    detail = client.get(f"/api/catalog/{pid}").json()
    assert detail["versions"][0]["norms"] == []

    # Post cut report with 0 materials
    rep = client.post("/api/reports?post=true", json={
        "date": today(), "stage": "cut",
        "lines": [{"item_id": pid, "quantity": 4, "assignments": [{"staff_id": cutter["id"], "quantity": 4}]}],
    })
    assert rep.status_code == 200, rep.text
    assert rep.json()["lines"][0]["materials"] == []
    assert rep.json()["wages"] == 6000

    # 2. Add spec version with 0 materials on cut, 2 materials on sew, fractional kg material on pack
    kg_mat = client.post("/api/materials", json={"name": "Наполнитель холлофайбер", "unit": "кг", "category": "Наполнители"})
    assert kg_mat.status_code == 200, kg_mat.text
    kg_id = kg_mat.json()["id"]
    ver = client.post(f"/api/catalog/{pid}/versions", json={
        "cut": "15.00", "sew": "40.00", "pack": "12.00",
        "norms": [
            {"item_id": 5, "stage": "sew", "quantity": "12.500"},
            {"item_id": 7, "stage": "sew", "quantity": 2},
            {"item_id": kg_id, "stage": "pack", "quantity": "0.375"},
        ],
    })
    assert ver.status_code == 200, ver.text
    updated = client.get(f"/api/catalog/{pid}").json()
    assert len(updated["versions"][0]["norms"]) == 3


def test_report_custom_source_warehouse_and_correction(client):
    ws = login(client, "oksana")
    cutter = next(p for p in ws["staff"] if p["stage"] == "cut" and p["active"])
    raw_before = amount(client, 1, 1)
    cut_raw_before = amount(client, 2, 1)

    # Receive fabric directly onto warehouse 2 (Склад кроя)
    rec = client.post("/api/receipts", json={
        "date": today(), "supplier": "Склад-поставщик", "reference": f"УПД-CUT-{uuid4().hex[:6]}",
        "target_id": 2, "lines": [{"item_id": 1, "quantity": "50.000", "price": "150.00"}],
    })
    assert rec.status_code == 200, rec.text
    assert rec.json()["target_id"] == 2
    assert amount(client, 2, 1) == cut_raw_before + 50000
    assert amount(client, 1, 1) == raw_before

    # Preview report using source_id=2 checks availability on warehouse 2
    payload = {
        "date": today(), "stage": "cut", "source_id": 2,
        "lines": [{"item_id": 100, "quantity": 2, "assignments": [{"staff_id": cutter["id"], "quantity": 2}]}],
    }
    prev = client.post("/api/reports/preview", json=payload)
    assert prev.status_code == 200, prev.text
    assert prev.json()["source_id"] == 2
    assert prev.json()["source_name"] == "Склад кроя"
    assert prev.json()["lines"][0]["materials"][0]["available"] == cut_raw_before + 50000

    # Post withdraws from warehouse 2, leaving warehouse 1 unchanged
    posted = client.post("/api/reports?post=true", json=payload)
    assert posted.status_code == 200, posted.text
    doc = posted.json()
    used_qty = doc["lines"][0]["materials"][0]["quantity"]
    assert doc["source_id"] == 2
    assert amount(client, 2, 1) == cut_raw_before + 50000 - used_qty
    assert amount(client, 1, 1) == raw_before

    # Correction restores warehouse 2 and preserves source_id=2 on replacement draft
    corr = client.post(f"/api/reports/{doc['id']}/correct", json={"reason": "Проверка склада списания"})
    assert corr.status_code == 200, corr.text
    assert corr.json()["source_id"] == 2
    assert amount(client, 2, 1) == cut_raw_before + 50000

    # Master cannot pick a regional warehouse as source_id
    login(client, "master")
    forbidden = client.post("/api/reports/preview", json={**payload, "source_id": 6})
    assert forbidden.status_code == 403


def test_overview_shows_first_of_month_drafts_and_posted_reports(client):
    ws = login(client, "oksana")
    cutter = next(p for p in ws["staff"] if p["stage"] == "cut" and p["active"])
    first_day = today()[:7] + "-01"
    before = client.get(f"/api/overview?day={first_day}").json()
    before_cut = next((s["quantity"] for s in before["stages"] if s["stage"] == "cut"), 0)

    draft = client.post("/api/reports", json={
        "date": first_day, "stage": "cut",
        "lines": [{"item_id": 100, "quantity": 7, "assignments": [{"staff_id": cutter["id"], "quantity": 7}]}],
    })
    assert draft.status_code == 200, draft.text
    draft_id = draft.json()["id"]

    ov_draft = client.get(f"/api/overview?day={first_day}").json()
    assert any(r["id"] == draft_id for r in ov_draft["day_drafts"])
    assert any(r["id"] == draft_id and r["status"] == "draft" for r in ov_draft["day_reports"])
    assert any(s["stage"] == "cut" and s["quantity"] >= 7000 for s in ov_draft["draft_stages"])
    assert ov_draft["pending"]["rows"][0]["date"] == first_day
    assert any(r["id"] == draft_id for r in ov_draft["pending"]["rows"])

    posted = client.put(f"/api/reports/{draft_id}?post=true", json={
        "date": first_day, "stage": "cut",
        "lines": [{"item_id": 100, "quantity": 7, "assignments": [{"staff_id": cutter["id"], "quantity": 7}]}],
    })
    assert posted.status_code == 200, posted.text

    ov_posted = client.get(f"/api/overview?day={first_day}").json()
    after_cut = next((s["quantity"] for s in ov_posted["stages"] if s["stage"] == "cut"), 0)
    assert after_cut == before_cut + 7000
    assert any(r["id"] == draft_id and r["status"] == "posted" for r in ov_posted["reports"])
    assert any(r["id"] == draft_id and r["status"] == "posted" for r in ov_posted["day_reports"])


def test_manual_raw_material_creation_and_receipt_target_warehouse(client):
    login(client, "master")
    assert client.post("/api/materials", json={"name": "Запрещённый"}).status_code == 403
    login(client, "moscow")
    assert client.post("/api/materials", json={"name": "Запрещённый"}).status_code == 403

    login(client, "oksana")
    mat = client.post("/api/materials", json={"name": "Лента атласная 20 мм", "unit": "рул.", "category": "Фурнитура"})
    assert mat.status_code == 200, mat.text
    created = mat.json()
    assert created["kind"] == "raw" and created["sku"].startswith("RAW-")
    assert client.post("/api/materials", json={"name": "Дубль", "sku": created["sku"]}).status_code == 409

    kg_mat = client.post("/api/materials", json={"name": "Синтепон 200", "unit": "кг", "category": "Утеплитель"}).json()
    rec = client.post("/api/receipts", json={
        "date": today(), "supplier": "ИвТекс", "reference": f"УПД-KG-{uuid4().hex[:6]}",
        "target_id": 3, "lines": [{"item_id": kg_mat["id"], "quantity": "12.345", "price": "320.00"}],
    })
    assert rec.status_code == 200, rec.text
    assert amount(client, 3, kg_mat["id"]) == 12345


def test_ivanovo_sale_editable_price_memo_and_scope(client):
    login(client, "admin")
    item = 100
    before = amount(client, 5, item)
    key = str(uuid4())
    payload = {
        "payment": "transfer", "request_key": key, "memo": "Оптовый заказ · клиент ООО Альфа",
        "lines": [{"item_id": item, "quantity": 2, "price": "1750.50"}],
    }
    sold = client.post("/api/sales", json=payload)
    assert sold.status_code == 200, sold.text
    doc = sold.json()
    assert doc["source_id"] == 5
    assert doc["source_city"] == "Иваново"
    assert doc["total"] == 350100
    assert doc["memo"] == payload["memo"]
    assert amount(client, 5, item) == before - 2000

    # Idempotency: identical retry returns same document; changing price or memo rejects with 409
    assert client.post("/api/sales", json=payload).json()["id"] == doc["id"]
    assert client.post("/api/sales", json={**payload, "memo": "Другой комментарий"}).status_code == 409
    assert client.post("/api/sales", json={**payload, "lines": [{"item_id": item, "quantity": 2, "price": "1800.00"}]}).status_code == 409

    # Ivanovo sales appear in central summary, journal, and xlsx
    summary = client.get("/api/sales-summary", params={"warehouse": 5}).json()
    assert summary["documents"] >= 1
    assert any(c["id"] == 5 and c["city"] == "Иваново" for c in summary["cities"])
    journal = client.get("/api/documents/sale", params={"warehouse": 5}).json()
    assert any(r["id"] == doc["id"] for r in journal["rows"])
    export = client.get("/api/documents/sale", params={"warehouse": 5, "xlsx": "true"})
    rows = list(load_workbook(io.BytesIO(export.content), data_only=True).active.values)
    assert len(rows) == journal["total"] + 1
    assert any(row[0] == doc["code"] and row[4] == "Иваново" for row in rows[1:])

    # Regional still cannot see Ivanovo sales or cost
    login(client, "moscow")
    assert client.get(f"/api/document/{doc['id']}").status_code == 404
    assert client.get("/api/documents/sale", params={"warehouse": 5}).json()["total"] == 0
    assert client.get("/api/sales-summary", params={"warehouse": 5}).json()["documents"] == 0


def test_gzip_and_pwa_headers(client, tmp_path):
    from fastapi import FastAPI
    from fastapi.middleware.gzip import GZipMiddleware
    from fastapi.staticfiles import StaticFiles
    from app.db import ROOT
    from app.main import PWAHeadersMiddleware

    # 1. GZip + no-store on API responses
    login(client, "admin")
    ws_res = client.get("/api/workspace", headers={"Accept-Encoding": "gzip"})
    assert ws_res.status_code == 200
    assert ws_res.headers.get("content-encoding") == "gzip"
    assert ws_res.headers.get("cache-control") == "no-store"

    # 2. Live PWA routes (/sw.js, /manifest.webmanifest, /icons/*.png) & dist/assets/*
    sw = client.get("/sw.js")
    assert sw.status_code == 200
    assert sw.headers.get("content-type") == "application/javascript; charset=utf-8"
    assert sw.headers.get("cache-control") == "no-cache"
    assert sw.headers.get("service-worker-allowed") == "/"

    mf = client.get("/manifest.webmanifest")
    assert mf.status_code == 200
    assert mf.headers.get("content-type") == "application/manifest+json; charset=utf-8"
    assert mf.headers.get("cache-control") == "no-cache"
    assert mf.json().get("display") == "standalone"

    for icon_name in ("icon-192.png", "icon-512.png", "icon-512-maskable.png", "apple-touch-icon.png"):
        icon_res = client.get(f"/icons/{icon_name}")
        assert icon_res.status_code == 200, icon_name
        assert icon_res.headers.get("content-type") == "image/png"
        assert icon_res.content.startswith(b"\x89PNG\r\n\x1a\n")
        assert "max-age=86400" in icon_res.headers.get("cache-control", "")

    assert client.get("/icons/..%2Fmanifest.webmanifest").status_code == 404
    assert client.get("/icons/nonexistent.png").status_code == 404

    dist_dir = ROOT / "dist"
    if dist_dir.exists():
        index_res = client.get("/")
        assert index_res.status_code == 200
        assert index_res.headers.get("cache-control") == "no-cache"

        assets = list((dist_dir / "assets").glob("*")) if (dist_dir / "assets").exists() else []
        if assets:
            asset = client.get(f"/assets/{assets[0].name}", headers={"Accept-Encoding": "gzip"})
            assert asset.status_code == 200
            assert "immutable" in asset.headers.get("cache-control", "")

    # 3. Direct middleware test for /sw.js, /manifest.webmanifest, /assets/*, /icons/*.png
    (tmp_path / "assets").mkdir()
    (tmp_path / "icons").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><html><body>ok</body></html>")
    (tmp_path / "sw.js").write_text("self.addEventListener('fetch', () => {});")
    (tmp_path / "manifest.webmanifest").write_text('{"name":"Test","display":"standalone"}')
    (tmp_path / "assets" / "app-abc123.js").write_text("console.log('ok');" * 80)
    (tmp_path / "icons" / "icon-192.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)

    mini = FastAPI()
    mini.add_middleware(PWAHeadersMiddleware)
    mini.add_middleware(GZipMiddleware, minimum_size=500)
    mini.mount("/", StaticFiles(directory=tmp_path, html=True))
    with TestClient(mini) as mc:
        r_sw = mc.get("/sw.js")
        assert r_sw.status_code == 200
        assert r_sw.headers["content-type"] == "application/javascript; charset=utf-8"
        assert r_sw.headers["cache-control"] == "no-cache"
        assert r_sw.headers["service-worker-allowed"] == "/"

        r_mf = mc.get("/manifest.webmanifest")
        assert r_mf.status_code == 200
        assert r_mf.headers["content-type"] == "application/manifest+json; charset=utf-8"
        assert r_mf.headers["cache-control"] == "no-cache"

        r_js = mc.get("/assets/app-abc123.js", headers={"Accept-Encoding": "gzip"})
        assert r_js.status_code == 200
        assert r_js.headers.get("content-encoding") == "gzip"
        assert "immutable" in r_js.headers["cache-control"]

        r_png = mc.get("/icons/icon-192.png")
        assert r_png.status_code == 200
        assert r_png.headers["content-type"] == "image/png"
        assert "max-age=86400" in r_png.headers["cache-control"]


def test_profile_workspace_password_and_logout_for_all_roles(client):
    role_cases = [
        ("admin", "admin", True, True),
        ("oksana", "accountant", True, True),
        ("master", "master", True, False),
        ("moscow", "regional", False, False),
    ]
    for prefix, expected_role, has_settings, has_in_transit in role_cases:
        ws = login(client, prefix)
        u = ws["user"]
        assert u["role"] == expected_role
        assert u["email"] == f"{prefix}@factory.local"
        assert u["name"] and u["role_name"]
        assert ("settings" in ws) is has_settings
        assert ("in_transit" in ws) is has_in_transit
        if expected_role == "regional":
            assert u["warehouse_id"] == 6 and u["city"] == "Москва" and u["warehouse_name"]
        else:
            assert ws["settings"]["open_month"]

        # Wrong old password and too-short new password rejected with 422
        assert client.post("/api/password", json={"old": "WrongPass!1", "new": "ValidPass!2026"}).status_code == 422
        assert client.post("/api/password", json={"old": "Ivanovo!2026", "new": "short"}).status_code == 422

        # Valid password change rotates session and keeps current client authenticated
        prev_cookie = client.cookies.get("factory_session")
        new_pw = f"Rotate!{prefix}2026"
        assert client.post("/api/password", json={"old": "Ivanovo!2026", "new": new_pw}).status_code == 200
        assert client.get("/api/workspace").status_code == 200
        with TestClient(app, cookies={"factory_session": prev_cookie}) as stale:
            assert stale.get("/api/workspace").status_code == 401
        # Restore default password
        assert client.post("/api/password", json={"old": new_pw, "new": "Ivanovo!2026"}).status_code == 200

        # Logout invalidates active session cleanly
        active_cookie = client.cookies.get("factory_session")
        assert client.post("/api/logout").status_code == 200
        assert client.get("/api/workspace").status_code == 401
        with TestClient(app, cookies={"factory_session": active_cookie}) as logged_out:
            assert logged_out.get("/api/workspace").status_code == 401

    # Also verify vector logo icon.svg is served cleanly
    svg_res = client.get("/icons/icon.svg")
    assert svg_res.status_code == 200
    assert "image/svg+xml" in svg_res.headers.get("content-type", "")
    assert "<svg" in svg_res.text


def test_hourly_loader_work_and_loader_rate_settings(client):
    login(client, "master")
    assert client.put("/api/settings", json={"loader_rate": "80.00"}).status_code == 403
    login(client, "moscow")
    assert client.put("/api/settings", json={"loader_rate": "80.00"}).status_code == 403

    ws = login(client, "oksana")
    assert ws["settings"]["loader_rate"] == "6000"
    cutter = next(p for p in ws["staff"] if p["stage"] == "cut" and p["active"])
    packer = next(p for p in ws["staff"] if p["stage"] == "pack" and p["active"])

    # Empty report with neither lines nor hourly_works rejected with 422
    assert client.post("/api/reports", json={"date": today(), "stage": "pack", "lines": [], "hourly_works": []}).status_code == 422

    # 1. Hourly-only report (30 min at 60 RUB/hr = 30 RUB = 3000 kopecks)
    month_before = client.get(f"/api/month?month={today()[:7]}").json()["wages"]
    ov_before = client.get(f"/api/overview?day={today()}").json()["wages"]
    hourly_only = client.post("/api/reports?post=true", json={
        "date": today(), "stage": "pack", "lines": [],
        "hourly_works": [{"staff_id": cutter["id"], "minutes": 30, "work_type": "loader"}],
    })
    assert hourly_only.status_code == 200, hourly_only.text
    hdoc = hourly_only.json()
    assert hdoc["wages"] == 3000
    assert hdoc["hourly_minutes"] == 30
    assert hdoc["hourly_works"][0]["amount"] == 3000
    assert client.get(f"/api/overview?day={today()}").json()["wages"] == ov_before + 3000
    assert client.get(f"/api/month?month={today()[:7]}").json()["wages"] == month_before + 3000

    # 2. Mixed report (cut work + packer as loader for 90 min = 90 RUB = 9000 kopecks)
    mixed = client.post("/api/reports?post=true", json={
        "date": today(), "stage": "cut",
        "lines": [{"item_id": 100, "quantity": 2, "assignments": [{"staff_id": cutter["id"], "quantity": 2}]}],
        "hourly_works": [{"staff_id": packer["id"], "minutes": 90, "work_type": "loader"}],
    })
    assert mixed.status_code == 200, mixed.text
    mdoc = mixed.json()
    piece_pay = mdoc["lines"][0]["assignments"][0]["rate"] * 2
    assert mdoc["wages"] == piece_pay + 9000

    # Staff detail includes hourly_rows & summary
    packer_detail = client.get(f"/api/staff/{packer['id']}").json()
    assert any(h["id"] == mdoc["id"] and h["minutes"] == 90 and h["amount"] == 9000 for h in packer_detail["hourly_rows"])
    assert packer_detail["summary"]["hourly_amount"] >= 9000

    # Correction copies hourly_works into replacement draft & removes corrected hourly wages from month
    corr = client.post(f"/api/reports/{hdoc['id']}/correct", json={"reason": "Уточнение часов грузчика"})
    assert corr.status_code == 200, corr.text
    assert corr.json()["hourly_works"][0]["minutes"] == 30
    assert client.get(f"/api/month?month={today()[:7]}").json()["wages"] == month_before + piece_pay + 9000

    # Updating loader_rate via PUT /api/settings changes subsequent calculation
    updated_settings = client.put("/api/settings", json={"loader_rate": "120.00"})
    assert updated_settings.status_code == 200 and updated_settings.json()["loader_rate"] == "12000"
    prev = client.post("/api/reports/preview", json={
        "date": today(), "stage": "pack", "lines": [],
        "hourly_works": [{"staff_id": packer["id"], "minutes": 45}],
    })
    assert prev.status_code == 200 and prev.json()["hourly_works"][0]["amount"] == 9000
    assert client.put("/api/settings", json={"loader_rate": "60.00"}).status_code == 200


def test_staff_travel_and_payroll_adjustments_and_executive_xlsx(client):
    login(client, "oksana")
    # Create staff with travel compensation (no production accrual yet!)
    new_emp = client.post("/api/staff", json={
        "name": "Тестовый Проездной", "stage": "pack", "position": "Упаковщик",
        "hired_on": "2025-01-10", "active": True, "travel_eligible": True, "travel_amount": "2500.00",
    })
    assert new_emp.status_code == 200, new_emp.text
    sid = new_emp.json()["id"]
    all_staff = client.get("/api/staff").json()
    emp_rec = next(s for s in all_staff if s["id"] == sid)
    assert emp_rec["travel_eligible"] == 1 and emp_rec["travel_amount"] == 250000

    # Employee with 0 accrual still appears in payroll because travel > 0
    month_str = today()[:7]
    start_str = f"{month_str}-01"
    pay_rows = client.get("/api/payroll", params={"start": start_str, "end": today(), "search": "Проездной"}).json()
    assert len(pay_rows) == 1
    assert pay_rows[0]["accrual"] == 0 and pay_rows[0]["travel"] == 250000 and pay_rows[0]["net_total"] == 250000

    # Save debt, advance, ndfl and travel override via PUT /api/payroll/adjustments
    adj = client.put("/api/payroll/adjustments", json={
        "month": month_str, "staff_id": sid, "travel": "3000.00",
        "debt": "500.00", "advance": "1000.00", "ndfl": "390.00", "memo": "Проверка ведомости",
    })
    assert adj.status_code == 200, adj.text
    row = adj.json()
    assert row["travel"] == 300000 and row["debt"] == 50000 and row["advance"] == 100000 and row["ndfl"] == 39000
    assert row["net_total"] == 300000 - 50000 - 100000 - 39000

    # Verify executive 7-column Excel + bold footer totals + #,##0.00 format
    res = client.get("/api/payroll", params={"start": start_str, "end": today(), "xlsx": "true"})
    assert res.status_code == 200
    wb = load_workbook(io.BytesIO(res.content), data_only=True)
    ws_sheet = wb.active
    rows = list(ws_sheet.values)
    assert list(rows[0]) == ["Сотрудник", "Начисление, ₽", "Проезд, ₽", "Долг, ₽", "Аванс, ₽", "НДФЛ, ₽", "Итого, ₽"]
    assert rows[-1][0] == "Итого"
    assert ws_sheet.cell(row=ws_sheet.max_row, column=1).font.bold is True
    assert ws_sheet.cell(row=ws_sheet.max_row, column=7).number_format == "#,##0.00"
    for col_idx in range(1, 7):
        expected_sum = round(sum(r[col_idx] for r in rows[1:-1]), 2)
        assert round(rows[-1][col_idx], 2) == expected_sum

    # Role guard: master & regional cannot access PUT /api/payroll/adjustments
    login(client, "master")
    assert client.put("/api/payroll/adjustments", json={"month": month_str, "staff_id": sid, "debt": "10"}).status_code == 403
    login(client, "moscow")
    assert client.put("/api/payroll/adjustments", json={"month": month_str, "staff_id": sid, "debt": "10"}).status_code == 403


def test_named_specs_and_report_spec_selection(client):
    ws = login(client, "oksana")
    cutter = next(p for p in ws["staff"] if p["stage"] == "cut" and p["active"])
    created = client.post("/api/catalog", json={
        "sku": "SPEC-SEL-01", "name": "Пододеяльник тест", "size": "Евро", "category": "Постельное бельё",
        "price": "1890.00", "spec_name": "Стандарт", "cut": "20.00", "sew": "60.00", "pack": "10.00",
        "norms": [{"item_id": 1, "stage": "cut", "quantity": "2.000"}],
    })
    assert created.status_code == 200, created.text
    pid = created.json()["id"]
    spec1 = client.get(f"/api/catalog/{pid}").json()["versions"][0]
    assert spec1["name"] == "Стандарт"

    v2 = client.post(f"/api/catalog/{pid}/versions", json={
        "spec_name": "Без полиэстера", "cut": "35.00", "sew": "70.00", "pack": "15.00",
        "norms": [{"item_id": 2, "stage": "cut", "quantity": "2.500"}],
    })
    assert v2.status_code == 200, v2.text
    spec2_id = v2.json()["id"]

    # Workspace and GET /api/catalog return specs with names
    ws2 = client.get("/api/workspace").json()
    prod_specs = [s for s in ws2["specs"] if s["product_id"] == pid]
    assert {s["name"] for s in prod_specs} == {"Стандарт", "Без полиэстера"}
    cat = client.get("/api/catalog").json()
    cat_item = next(i for i in cat["items"] if i["id"] == pid)
    assert len(cat_item["specs"]) == 2

    # Explicitly select older spec1 ("Стандарт") in a report -> uses spec1 norm (item 1) and rate (20 RUB)
    rep = client.post("/api/reports?post=true", json={
        "date": today(), "stage": "cut",
        "lines": [{"item_id": pid, "quantity": 3, "spec_id": spec1["id"], "assignments": [{"staff_id": cutter["id"], "quantity": 3}]}],
    })
    assert rep.status_code == 200, rep.text
    rdoc = rep.json()
    assert rdoc["lines"][0]["spec_id"] == spec1["id"]
    assert rdoc["lines"][0]["spec_name"] == "Стандарт"
    assert rdoc["lines"][0]["materials"][0]["item_id"] == 1
    assert rdoc["wages"] == 6000

    # Selecting another product's spec fails with 422
    other_spec = next(s["id"] for s in ws2["specs"] if s["product_id"] == 100)
    bad = client.post("/api/reports/preview", json={
        "date": today(), "stage": "cut",
        "lines": [{"item_id": pid, "quantity": 1, "spec_id": other_spec}],
    })
    assert bad.status_code == 422
    assert spec2_id != spec1["id"]


def test_idempotent_migration_on_existing_db_copy(tmp_path):
    import sqlite3
    from contextlib import closing
    from app.db import ROOT, SCHEMA, migrate

    live_db = ROOT / "data" / "factory.sqlite3"
    copy_db = tmp_path / "factory_copy.sqlite3"
    if live_db.exists():
        with closing(sqlite3.connect(f"file:{live_db}?mode=ro", uri=True)) as src:
            with closing(sqlite3.connect(copy_db)) as dst:
                src.backup(dst)
        with closing(sqlite3.connect(copy_db)) as db:
            db.row_factory = sqlite3.Row
            docs_before = db.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
            moves_before = db.execute("SELECT COUNT(*) FROM movements").fetchone()[0]
            db.executescript(SCHEMA)
            migrate(db)
            migrate(db)  # Idempotent second run
            db.commit()
            assert db.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == docs_before
            assert db.execute("SELECT COUNT(*) FROM movements").fetchone()[0] == moves_before
            assert db.execute("SELECT value FROM settings WHERE key='loader_rate'").fetchone()[0] == "6000"
            assert db.execute("SELECT COUNT(*) FROM specs WHERE TRIM(name)=''").fetchone()[0] == 0
            staff_cols = {r["name"] for r in db.execute("PRAGMA table_info(staff)")}
            assert {"travel_eligible", "travel_amount"}.issubset(staff_cols)
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            assert {"hourly_works", "payroll_adjustments"}.issubset(tables)
