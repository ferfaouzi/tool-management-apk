import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as appmod  # noqa: E402


@pytest.fixture
def client(tmp_path):
    a = appmod.create_app(str(tmp_path / "t.db"))
    a.config["TESTING"] = True
    return a.test_client()


def admin(c):
    assert c.post("/api/login", json={"password": "admin"}).status_code == 200


def test_lecture_seule_sans_admin(client):
    assert client.get("/api/meta").json["admin"] is False
    assert client.post("/api/entites", json={"type": "societe", "nom": "X"}).status_code == 403
    assert client.post("/api/login", json={"password": "faux"}).status_code == 401


def test_hierarchie_complete(client):
    admin(client)
    pid = None
    for t in ["societe", "site", "zone", "ligne", "machine", "outil", "module", "posage", "article"]:
        r = client.post("/api/entites", json={"type": t, "nom": t.upper(), "parent_id": pid,
                                               "emplacement": "E1", "process": "Découpe"})
        assert r.status_code == 201, r.json
        pid = r.json["id"]
    assert len(client.get("/api/entites").json) == 9


def test_parent_invalide(client):
    admin(client)
    s = client.post("/api/entites", json={"type": "societe", "nom": "S"}).json["id"]
    r = client.post("/api/entites", json={"type": "machine", "nom": "M", "parent_id": s})
    assert r.status_code == 400
    assert client.post("/api/entites", json={"type": "site", "nom": "Sans parent"}).status_code == 400
    assert client.post("/api/entites", json={"type": "societe", "nom": ""}).status_code == 400


def test_modif_suppression_historique(client):
    admin(client)
    s = client.post("/api/entites", json={"type": "societe", "nom": "S"}).json["id"]
    site = client.post("/api/entites", json={"type": "site", "nom": "Site", "parent_id": s}).json["id"]
    v0 = client.get("/api/version").json["version"]
    r = client.put(f"/api/entites/{site}", json={"nom": "Site 2", "motif": "Réglage"})
    assert r.json["nom"] == "Site 2"
    assert client.get("/api/version").json["version"] > v0
    h = client.get(f"/api/entites/{site}").json["historique"]
    assert h[0]["action"] == "Modification" and h[0]["motif"] == "Réglage"
    r = client.delete(f"/api/entites/{s}", json={"motif": "Autre"})
    assert r.json["supprimes"] == 2
    assert client.get("/api/entites").json == []


def test_coups_propagation_et_alertes(client):
    admin(client)
    ids = {}
    pid = None
    for t in ["societe", "site", "zone", "ligne", "machine", "outil"]:
        ids[t] = pid = client.post("/api/entites", json={"type": t, "nom": t, "parent_id": pid,
                                                         "coups_max": 10 if t == "outil" else 0}).json["id"]
    client.post(f"/api/entites/{ids['machine']}/coups", json={"increment": 9})
    assert client.get(f"/api/entites/{ids['outil']}").json["nb_coups"] == 9
    d = client.get("/api/dashboard").json
    assert any(a["id"] == ids["outil"] and a["niveau"] == "attention" for a in d["alertes"])
    client.post(f"/api/entites/{ids['outil']}/coups", json={"reset": True, "motif": "Maintenance préventive"})
    assert client.get(f"/api/entites/{ids['outil']}").json["nb_coups"] == 0


def test_cle_api_machine(client, monkeypatch):
    monkeypatch.setattr(appmod, "API_KEY", "secret")
    admin(client)
    s = client.post("/api/entites", json={"type": "outil", "nom": "O"}).json["id"]
    client.post("/api/logout")
    assert client.post(f"/api/entites/{s}/coups", json={"increment": 1}).status_code == 403
    r = client.post(f"/api/entites/{s}/coups", json={"increment": 3}, headers={"X-API-Key": "secret"})
    assert r.json["nb_coups"] == 3


def test_demo_export_sauvegarde(client):
    admin(client)
    assert client.post("/api/demo").status_code == 200
    csv = client.get("/api/export.csv").get_data(as_text=True)
    assert "Presse 400T" in csv
    dump = client.get("/api/sauvegarde").json
    client.delete(f"/api/entites/{dump['entites'][0]['id']}")
    assert client.post("/api/restauration", json=dump).json["entites"] == len(dump["entites"])
    assert len(client.get("/api/entites").json) == len(dump["entites"])
