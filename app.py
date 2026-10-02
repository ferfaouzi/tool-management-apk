"""Gestion des outils - serveur web léger (Flask + SQLite).

Pensé pour tourner sur un Raspberry Pi 3 : un seul fichier serveur, une base
SQLite locale, aucune dépendance front-end externe. Tous les postes (PC,
tablettes, application Android) se connectent au même serveur et partagent
donc les mêmes données en temps réel.
"""

import csv
import io
import json
import os
import secrets
import sqlite3
from datetime import datetime
from functools import wraps

from flask import Flask, Response, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("TM_DB", os.path.join(BASE_DIR, "data", "outils.db"))
API_KEY = os.environ.get("TM_API_KEY", "")

# Hiérarchie : type -> types de parent autorisés (None = racine possible)
TYPES = {
    "societe": {"label": "Société", "parents": [None]},
    "site": {"label": "Site", "parents": ["societe"]},
    "zone": {"label": "Zone", "parents": ["site"]},
    "ligne": {"label": "Ligne", "parents": ["zone"]},
    "machine": {"label": "Machine", "parents": ["ligne"]},
    "outil": {"label": "Outil", "parents": ["machine", None]},
    "module": {"label": "Module", "parents": ["outil"]},
    "posage": {"label": "Posage", "parents": ["module", "outil"]},
    "article": {
        "label": "Article / pièce de rechange",
        "parents": ["machine", "outil", "module", "posage", None],
    },
}

FIELDS = [
    "nom", "code", "emplacement", "adresse", "localisation", "process",
    "objectif", "nb_coups", "coups_max", "motif", "statut", "description",
    "reference", "fournisseur", "quantite", "stock_min",
]
INT_FIELDS = {"nb_coups", "coups_max", "quantite", "stock_min"}

DEFAULT_LISTES = {
    "statut": ["En service", "En maintenance", "À l'arrêt", "Hors service", "En stock"],
    "motif": [
        "Création", "Maintenance préventive", "Maintenance corrective", "Usure",
        "Casse", "Changement de série", "Réglage", "Remplacement de pièce",
        "Inventaire", "Autre",
    ],
    "process": [
        "Emboutissage", "Découpe", "Soudure", "Usinage", "Injection",
        "Assemblage", "Peinture", "Contrôle", "Conditionnement",
    ],
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS entites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    parent_id INTEGER REFERENCES entites(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    code TEXT DEFAULT '',
    emplacement TEXT DEFAULT '',
    adresse TEXT DEFAULT '',
    localisation TEXT DEFAULT '',
    process TEXT DEFAULT '',
    objectif TEXT DEFAULT '',
    nb_coups INTEGER DEFAULT 0,
    coups_max INTEGER DEFAULT 0,
    motif TEXT DEFAULT '',
    statut TEXT DEFAULT 'En service',
    description TEXT DEFAULT '',
    reference TEXT DEFAULT '',
    fournisseur TEXT DEFAULT '',
    quantite INTEGER DEFAULT 0,
    stock_min INTEGER DEFAULT 0,
    cree_le TEXT,
    modifie_le TEXT
);
CREATE INDEX IF NOT EXISTS idx_entites_parent ON entites(parent_id);
CREATE INDEX IF NOT EXISTS idx_entites_type ON entites(type);
CREATE TABLE IF NOT EXISTS historique (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entite_id INTEGER,
    entite_nom TEXT,
    entite_type TEXT,
    action TEXT,
    details TEXT,
    motif TEXT,
    utilisateur TEXT,
    date TEXT
);
CREATE TABLE IF NOT EXISTS listes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    categorie TEXT NOT NULL,
    valeur TEXT NOT NULL,
    UNIQUE(categorie, valeur)
);
CREATE TABLE IF NOT EXISTS config (
    cle TEXT PRIMARY KEY,
    valeur TEXT
);
"""


def now():
    return datetime.now().isoformat(timespec="seconds")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def init_db(path=None):
    path = path or DB_PATH
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    db = sqlite3.connect(path)
    db.executescript(SCHEMA)
    db.execute("PRAGMA journal_mode = WAL")
    for cat, valeurs in DEFAULT_LISTES.items():
        if not db.execute("SELECT 1 FROM listes WHERE categorie=?", (cat,)).fetchone():
            db.executemany(
                "INSERT INTO listes(categorie, valeur) VALUES (?, ?)",
                [(cat, v) for v in valeurs],
            )
    if not db.execute("SELECT 1 FROM config WHERE cle='admin_password'").fetchone():
        db.execute(
            "INSERT INTO config VALUES ('admin_password', ?)",
            (generate_password_hash(os.environ.get("TM_ADMIN_PASSWORD", "admin")),),
        )
    if not db.execute("SELECT 1 FROM config WHERE cle='version'").fetchone():
        db.execute("INSERT INTO config VALUES ('version', '0')")
    if not db.execute("SELECT 1 FROM config WHERE cle='secret_key'").fetchone():
        db.execute("INSERT INTO config VALUES ('secret_key', ?)", (secrets.token_hex(32),))
    db.commit()
    secret = db.execute("SELECT valeur FROM config WHERE cle='secret_key'").fetchone()[0]
    db.close()
    return secret


def bump_version(db):
    db.execute("UPDATE config SET valeur = CAST(valeur AS INTEGER) + 1 WHERE cle='version'")


def log(db, entite, action, details="", motif=""):
    db.execute(
        "INSERT INTO historique(entite_id, entite_nom, entite_type, action, details, motif, utilisateur, date)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (
            entite["id"] if entite else None,
            entite["nom"] if entite else "",
            entite["type"] if entite else "",
            action,
            details,
            motif,
            "admin" if session.get("admin") else ("machine" if _has_api_key() else "lecteur"),
            now(),
        ),
    )


def _has_api_key():
    key = request.headers.get("X-API-Key") or request.args.get("api_key")
    return bool(API_KEY) and key == API_KEY


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("admin"):
            return jsonify({"erreur": "Mode administrateur requis"}), 403
        return fn(*args, **kwargs)

    return wrapper


def row(r):
    return dict(r) if r else None


def create_app(db_path=None):
    global DB_PATH
    if db_path:
        DB_PATH = db_path
    secret = init_db(DB_PATH)

    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.secret_key = os.environ.get("TM_SECRET_KEY", secret)
    app.config["JSON_AS_ASCII"] = False
    app.json.ensure_ascii = False
    app.json.sort_keys = False

    @app.teardown_appcontext
    def close_db(_exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.after_request
    def cors(resp):
        # Permet à l'application Android (WebView) d'appeler l'API du Pi
        origin = request.headers.get("Origin")
        if origin:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Credentials"] = "true"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        return resp

    # ---------- Pages ----------
    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/manifest.json")
    def manifest():
        return send_from_directory(app.static_folder, "manifest.json")

    # ---------- Méta / synchronisation ----------
    @app.get("/api/meta")
    def meta():
        db = get_db()
        listes = {}
        for r in db.execute("SELECT categorie, valeur FROM listes ORDER BY categorie, id"):
            listes.setdefault(r["categorie"], []).append(r["valeur"])
        return jsonify({
            "types": TYPES,
            "listes": listes,
            "admin": bool(session.get("admin")),
            "version": _version(db),
        })

    def _version(db):
        return int(db.execute("SELECT valeur FROM config WHERE cle='version'").fetchone()[0])

    @app.get("/api/version")
    def version():
        return jsonify({"version": _version(get_db())})

    # ---------- Authentification ----------
    @app.post("/api/login")
    def login():
        data = request.get_json(silent=True) or {}
        db = get_db()
        h = db.execute("SELECT valeur FROM config WHERE cle='admin_password'").fetchone()[0]
        if check_password_hash(h, data.get("password", "")):
            session["admin"] = True
            session.permanent = True
            return jsonify({"admin": True})
        return jsonify({"erreur": "Mot de passe incorrect"}), 401

    @app.post("/api/logout")
    def logout():
        session.pop("admin", None)
        return jsonify({"admin": False})

    @app.post("/api/password")
    @admin_required
    def change_password():
        data = request.get_json(silent=True) or {}
        nouveau = data.get("password", "")
        if len(nouveau) < 4:
            return jsonify({"erreur": "Mot de passe trop court (4 caractères minimum)"}), 400
        db = get_db()
        db.execute(
            "UPDATE config SET valeur=? WHERE cle='admin_password'",
            (generate_password_hash(nouveau),),
        )
        db.commit()
        return jsonify({"ok": True})

    # ---------- Entités ----------
    @app.get("/api/entites")
    def list_entites():
        db = get_db()
        sql = "SELECT * FROM entites"
        args, where = [], []
        if request.args.get("type"):
            where.append("type=?")
            args.append(request.args["type"])
        if request.args.get("parent_id"):
            where.append("parent_id=?")
            args.append(request.args["parent_id"])
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY type, nom COLLATE NOCASE"
        return jsonify([dict(r) for r in db.execute(sql, args)])

    @app.get("/api/entites/<int:eid>")
    def get_entite(eid):
        db = get_db()
        e = row(db.execute("SELECT * FROM entites WHERE id=?", (eid,)).fetchone())
        if not e:
            return jsonify({"erreur": "Introuvable"}), 404
        e["enfants"] = [dict(r) for r in db.execute(
            "SELECT * FROM entites WHERE parent_id=? ORDER BY type, nom", (eid,))]
        e["historique"] = [dict(r) for r in db.execute(
            "SELECT * FROM historique WHERE entite_id=? ORDER BY id DESC LIMIT 100", (eid,))]
        return jsonify(e)

    def _clean(data, partial=False):
        out = {}
        for f in FIELDS:
            if f in data:
                v = data[f]
                if f in INT_FIELDS:
                    try:
                        v = int(v or 0)
                    except (TypeError, ValueError):
                        raise ValueError(f"Le champ « {f} » doit être un nombre entier")
                    if v < 0:
                        raise ValueError(f"Le champ « {f} » ne peut pas être négatif")
                else:
                    v = str(v or "").strip()
                out[f] = v
        if not partial and not out.get("nom"):
            raise ValueError("Le nom est obligatoire")
        if "nom" in out and not out["nom"]:
            raise ValueError("Le nom est obligatoire")
        return out

    def _check_parent(db, typ, parent_id, self_id=None):
        allowed = TYPES[typ]["parents"]
        if parent_id in (None, "", 0):
            if None not in allowed:
                raise ValueError(f"Un(e) {TYPES[typ]['label']} doit être rattaché(e) à : "
                                 + ", ".join(TYPES[p]["label"] for p in allowed if p))
            return None
        parent = db.execute("SELECT * FROM entites WHERE id=?", (parent_id,)).fetchone()
        if not parent:
            raise ValueError("Parent introuvable")
        if parent["type"] not in allowed:
            raise ValueError(f"Un(e) {TYPES[typ]['label']} ne peut pas être rattaché(e) à un(e) "
                             f"{TYPES[parent['type']]['label']}")
        # Empêche les boucles
        p = parent
        while p is not None and self_id is not None:
            if p["id"] == self_id:
                raise ValueError("Rattachement circulaire impossible")
            p = db.execute("SELECT * FROM entites WHERE id=?", (p["parent_id"],)).fetchone() \
                if p["parent_id"] else None
        return int(parent_id)

    @app.post("/api/entites")
    @admin_required
    def create_entite():
        data = request.get_json(silent=True) or {}
        typ = data.get("type")
        if typ not in TYPES:
            return jsonify({"erreur": "Type inconnu"}), 400
        db = get_db()
        try:
            vals = _clean(data)
            parent_id = _check_parent(db, typ, data.get("parent_id"))
        except ValueError as exc:
            return jsonify({"erreur": str(exc)}), 400
        vals.setdefault("statut", "En service")
        cols = ["type", "parent_id", "cree_le", "modifie_le"] + list(vals)
        params = [typ, parent_id, now(), now()] + list(vals.values())
        cur = db.execute(
            f"INSERT INTO entites({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", params)
        e = db.execute("SELECT * FROM entites WHERE id=?", (cur.lastrowid,)).fetchone()
        log(db, e, "Création", "", vals.get("motif", ""))
        bump_version(db)
        db.commit()
        return jsonify(dict(e)), 201

    @app.put("/api/entites/<int:eid>")
    @admin_required
    def update_entite(eid):
        db = get_db()
        old = db.execute("SELECT * FROM entites WHERE id=?", (eid,)).fetchone()
        if not old:
            return jsonify({"erreur": "Introuvable"}), 404
        data = request.get_json(silent=True) or {}
        try:
            vals = _clean(data, partial=True)
            if "parent_id" in data:
                vals["parent_id"] = _check_parent(db, old["type"], data.get("parent_id"), eid)
        except ValueError as exc:
            return jsonify({"erreur": str(exc)}), 400
        changes = [f"{k}: {old[k]!s} → {v!s}" for k, v in vals.items()
                   if str(old[k] if old[k] is not None else "") != str(v if v is not None else "")]
        if vals:
            vals["modifie_le"] = now()
            db.execute(
                f"UPDATE entites SET {', '.join(k + '=?' for k in vals)} WHERE id=?",
                list(vals.values()) + [eid])
        e = db.execute("SELECT * FROM entites WHERE id=?", (eid,)).fetchone()
        if changes:
            log(db, e, "Modification", "; ".join(changes), data.get("motif", ""))
            bump_version(db)
        db.commit()
        return jsonify(dict(e))

    @app.delete("/api/entites/<int:eid>")
    @admin_required
    def delete_entite(eid):
        db = get_db()
        e = db.execute("SELECT * FROM entites WHERE id=?", (eid,)).fetchone()
        if not e:
            return jsonify({"erreur": "Introuvable"}), 404
        n = db.execute(
            "WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT x.id FROM entites x JOIN d ON x.parent_id=d.id)"
            " SELECT COUNT(*) - 1 FROM d", (eid,)).fetchone()[0]
        motif = (request.get_json(silent=True) or {}).get("motif", "") or request.args.get("motif", "")
        log(db, e, "Suppression", f"{n} élément(s) rattaché(s) supprimé(s)" if n else "", motif)
        db.execute("DELETE FROM entites WHERE id=?", (eid,))
        bump_version(db)
        db.commit()
        return jsonify({"ok": True, "supprimes": n + 1})

    # ---------- Compteur de coups (synchronisation machines) ----------
    @app.post("/api/entites/<int:eid>/coups")
    def coups(eid):
        """Incrémente ou remet à zéro le compteur de coups.

        Utilisable depuis l'interface (admin) ou par une machine / un automate
        avec l'en-tête X-API-Key (variable d'environnement TM_API_KEY).
        Corps JSON : {"increment": 1} ou {"valeur": 1234} ou {"reset": true, "motif": "..."}
        Le compteur est propagé aux éléments rattachés (outil, module, posage, articles).
        """
        if not (session.get("admin") or _has_api_key()):
            return jsonify({"erreur": "Mode administrateur ou clé API requis"}), 403
        db = get_db()
        e = db.execute("SELECT * FROM entites WHERE id=?", (eid,)).fetchone()
        if not e:
            return jsonify({"erreur": "Introuvable"}), 404
        data = request.get_json(silent=True) or {}
        motif = data.get("motif", "")
        try:
            if data.get("reset"):
                db.execute("UPDATE entites SET nb_coups=0, modifie_le=? WHERE id=?", (now(), eid))
                log(db, e, "Remise à zéro compteur", f"{e['nb_coups']} → 0", motif)
            elif "valeur" in data:
                v = int(data["valeur"])
                if v < 0:
                    raise ValueError
                db.execute("UPDATE entites SET nb_coups=?, modifie_le=? WHERE id=?", (v, now(), eid))
                log(db, e, "Compteur", f"{e['nb_coups']} → {v}", motif)
            else:
                inc = int(data.get("increment", 1))
                if inc < 0:
                    raise ValueError
                propager = data.get("propager", True)
                ids = [eid]
                if propager:
                    ids = [r[0] for r in db.execute(
                        "WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT x.id FROM entites x"
                        " JOIN d ON x.parent_id=d.id) SELECT id FROM d", (eid,))]
                db.executemany(
                    "UPDATE entites SET nb_coups = nb_coups + ?, modifie_le=? WHERE id=?",
                    [(inc, now(), i) for i in ids])
        except (TypeError, ValueError):
            return jsonify({"erreur": "Valeur invalide"}), 400
        bump_version(db)
        db.commit()
        return jsonify(dict(db.execute("SELECT * FROM entites WHERE id=?", (eid,)).fetchone()))

    # ---------- Tableau de bord ----------
    @app.get("/api/dashboard")
    def dashboard():
        db = get_db()
        compte = {t: 0 for t in TYPES}
        for r in db.execute("SELECT type, COUNT(*) n FROM entites GROUP BY type"):
            compte[r["type"]] = r["n"]
        statuts = {r["statut"] or "—": r["n"] for r in db.execute(
            "SELECT statut, COUNT(*) n FROM entites WHERE type IN ('machine','outil','module','posage')"
            " GROUP BY statut")}
        alertes = []
        for r in db.execute(
                "SELECT * FROM entites WHERE coups_max > 0 AND nb_coups >= coups_max * 0.9"
                " ORDER BY CAST(nb_coups AS REAL) / coups_max DESC"):
            r = dict(r)
            r["niveau"] = "critique" if r["nb_coups"] >= r["coups_max"] else "attention"
            r["alerte"] = "Limite de coups atteinte" if r["niveau"] == "critique" else "Limite de coups proche (≥ 90 %)"
            alertes.append(r)
        for r in db.execute(
                "SELECT * FROM entites WHERE type='article' AND stock_min > 0 AND quantite <= stock_min"):
            r = dict(r)
            r["niveau"] = "critique" if r["quantite"] == 0 else "attention"
            r["alerte"] = f"Stock bas ({r['quantite']} / min {r['stock_min']})"
            alertes.append(r)
        for r in db.execute(
                "SELECT * FROM entites WHERE statut IN ('Hors service', 'À l''arrêt', 'En maintenance')"
                " AND type IN ('machine','outil','module','posage')"):
            r = dict(r)
            r["niveau"] = "critique" if r["statut"] == "Hors service" else "info"
            r["alerte"] = r["statut"]
            alertes.append(r)
        top = [dict(r) for r in db.execute(
            "SELECT * FROM entites WHERE type IN ('machine','outil','module','posage') AND nb_coups > 0"
            " ORDER BY nb_coups DESC LIMIT 10")]
        hist = [dict(r) for r in db.execute("SELECT * FROM historique ORDER BY id DESC LIMIT 25")]
        return jsonify({"compte": compte, "statuts": statuts, "alertes": alertes,
                        "top_coups": top, "historique": hist, "version": _version(db)})

    @app.get("/api/historique")
    def historique():
        db = get_db()
        limit = min(int(request.args.get("limit", 200)), 2000)
        return jsonify([dict(r) for r in db.execute(
            "SELECT * FROM historique ORDER BY id DESC LIMIT ?", (limit,))])

    # ---------- Listes déroulantes (admin) ----------
    @app.post("/api/listes")
    @admin_required
    def add_liste():
        data = request.get_json(silent=True) or {}
        cat, val = (data.get("categorie") or "").strip(), (data.get("valeur") or "").strip()
        if not cat or not val:
            return jsonify({"erreur": "Catégorie et valeur obligatoires"}), 400
        db = get_db()
        db.execute("INSERT OR IGNORE INTO listes(categorie, valeur) VALUES (?, ?)", (cat, val))
        bump_version(db)
        db.commit()
        return jsonify({"ok": True}), 201

    @app.delete("/api/listes")
    @admin_required
    def del_liste():
        data = request.get_json(silent=True) or {}
        db = get_db()
        db.execute("DELETE FROM listes WHERE categorie=? AND valeur=?",
                   (data.get("categorie"), data.get("valeur")))
        bump_version(db)
        db.commit()
        return jsonify({"ok": True})

    # ---------- Export / sauvegarde ----------
    @app.get("/api/export.csv")
    def export_csv():
        db = get_db()
        rows = db.execute(
            "SELECT e.*, p.nom AS parent_nom FROM entites e LEFT JOIN entites p ON p.id=e.parent_id"
            " ORDER BY e.type, e.nom").fetchall()
        buf = io.StringIO()
        cols = ["id", "type", "parent_id", "parent_nom"] + FIELDS + ["cree_le", "modifie_le"]
        w = csv.writer(buf, delimiter=";")
        w.writerow(cols)
        for r in rows:
            w.writerow([r[c] for c in cols])
        return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": "attachment; filename=outils.csv"})

    @app.get("/api/sauvegarde")
    @admin_required
    def backup():
        db = get_db()
        data = {
            "entites": [dict(r) for r in db.execute("SELECT * FROM entites ORDER BY id")],
            "listes": [dict(r) for r in db.execute("SELECT categorie, valeur FROM listes")],
            "date": now(),
        }
        return Response(json.dumps(data, ensure_ascii=False, indent=1), mimetype="application/json",
                        headers={"Content-Disposition": "attachment; filename=sauvegarde-outils.json"})

    @app.post("/api/restauration")
    @admin_required
    def restore():
        data = request.get_json(silent=True) or {}
        ents = data.get("entites")
        if not isinstance(ents, list):
            return jsonify({"erreur": "Fichier de sauvegarde invalide"}), 400
        db = get_db()
        cols = ["id", "type", "parent_id"] + FIELDS + ["cree_le", "modifie_le"]
        db.execute("PRAGMA foreign_keys = OFF")
        db.execute("DELETE FROM entites")
        db.executemany(
            f"INSERT INTO entites({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [[e.get(c) for c in cols] for e in ents if e.get("type") in TYPES])
        for li in data.get("listes", []):
            db.execute("INSERT OR IGNORE INTO listes(categorie, valeur) VALUES (?, ?)",
                       (li.get("categorie"), li.get("valeur")))
        log(db, None, "Restauration", f"{len(ents)} élément(s) restauré(s)")
        bump_version(db)
        db.commit()
        db.execute("PRAGMA foreign_keys = ON")
        return jsonify({"ok": True, "entites": len(ents)})

    @app.post("/api/demo")
    @admin_required
    def demo():
        """Charge un jeu de données d'exemple (si la base est vide)."""
        db = get_db()
        if db.execute("SELECT COUNT(*) FROM entites").fetchone()[0]:
            return jsonify({"erreur": "La base n'est pas vide"}), 400
        _load_demo(db)
        bump_version(db)
        db.commit()
        return jsonify({"ok": True})

    return app


def _load_demo(db):
    def add(typ, parent, nom, **kw):
        kw.setdefault("statut", "En service")
        cols = ["type", "parent_id", "nom", "cree_le", "modifie_le"] + list(kw)
        cur = db.execute(
            f"INSERT INTO entites({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [typ, parent, nom, now(), now()] + list(kw.values()))
        return cur.lastrowid

    s = add("societe", None, "Ma Société", adresse="12 rue de l'Industrie", localisation="Tunis",
            objectif="Production pièces métalliques")
    site = add("site", s, "Usine Nord", adresse="Zone industrielle", localisation="Ben Arous")
    z = add("zone", site, "Atelier Presse", emplacement="Bâtiment A")
    li = add("ligne", z, "Ligne 1", process="Emboutissage", objectif="1200 pièces / poste")
    m = add("machine", li, "Presse 400T", code="PR-400", emplacement="L1-P1", process="Emboutissage",
            nb_coups=152340, coups_max=500000)
    o = add("outil", m, "Outil capot AV", code="OT-101", emplacement="L1-P1",
            process="Emboutissage", nb_coups=48200, coups_max=50000, objectif="Capot avant")
    mo = add("module", o, "Module découpe", code="MD-11", nb_coups=48200, coups_max=60000)
    add("posage", mo, "Posage 1", code="PS-111", nb_coups=48200, coups_max=100000)
    add("article", o, "Poinçon Ø12", reference="PN-12-HSS", fournisseur="Fournisseur X",
        quantite=2, stock_min=4, emplacement="Magasin A3", statut="En stock")
    add("article", m, "Joint vérin", reference="JV-400", quantite=10, stock_min=3,
        emplacement="Magasin B1", statut="En stock")
    m2 = add("machine", li, "Presse 250T", code="PR-250", emplacement="L1-P2",
             process="Découpe", nb_coups=90100, coups_max=300000, statut="En maintenance",
             motif="Maintenance préventive")
    add("outil", m2, "Outil support", code="OT-102", nb_coups=12000, coups_max=80000)
    db.execute(
        "INSERT INTO historique(entite_id, entite_nom, entite_type, action, details, motif, utilisateur, date)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (None, "Données d'exemple", "", "Création", "Jeu de démonstration chargé", "", "admin", now()))


app = create_app()

if __name__ == "__main__":
    host = os.environ.get("TM_HOST", "0.0.0.0")
    port = int(os.environ.get("TM_PORT", "8080"))
    try:
        from waitress import serve

        print(f"Gestion des outils : http://{host}:{port}")
        serve(app, host=host, port=port, threads=4)
    except ImportError:
        app.run(host=host, port=port)
