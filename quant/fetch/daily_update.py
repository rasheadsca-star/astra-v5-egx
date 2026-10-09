#!/usr/bin/env python3
"""تحديث بيانات EGX اليومي بعد الإغلاق (Idempotent + حارس حداثة + تحقق + provenance + تقرير حالة).

الاستخدام:
  python fetch/daily_update.py                 تشغيل عادي (يُستدعى من GitHub Actions)
  python fetch/daily_update.py --force         تجاوز SKIP_EARLY / ALREADY_CURRENT
  python fetch/daily_update.py --no-yahoo      بدون المصدر الاحتياطي
  python fetch/daily_update.py --dry-run       تحقق وتقرير دون كتابة تاريخ ولا تشغيل المحرك
  python fetch/daily_update.py --no-stage1     تحديث التاريخ فقط

ترتيب المصادر: 1) حزم الجلسة session_pack في data/inbox. 2) أي fallback خارجي لا يُفعّل إلا إذا سمح به سجل المصادر المركزي config/data-source-registry.json.
الحالة النهائية finalStatus: SUCCESS | PARTIAL | WAITING_DATA | FAILED | ALREADY_CURRENT  ->  data/daily-data-update-status.json
المبدأ: مشكلة بيانات ≠ إشارة سيئة. لا استبدال لبيانات صحيحة، ولا مسح للمرشحين، ولا ترتيب جديد على بيانات قديمة."""
import os, sys, re, json, glob, shutil, math, datetime as dt, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(ROOT)
try:
    from zoneinfo import ZoneInfo; CAI = ZoneInfo("Africa/Cairo")
except Exception: CAI = None

DEFAULTS = dict(close_time="14:30", grace_min=45, min_last_trade="12:30", success_coverage=0.95, min_coverage=0.80,
                jump_quarantine=0.22, jump_warn=0.12, prev_close_tol=0.01, yahoo_conflict=0.15, keep_backups=3)
TIER = {"official": 4, "precise": 3, "yahoo_daily_unverified": 2, "supplemental_unverified": 1}
SYM = re.compile(r"^[A-Z0-9]{2,10}$")

def yahoo_automated_access_allowed():
    """Policy gate: Yahoo automated web collection is disabled unless the central registry explicitly permits it."""
    p = os.path.join(REPO_ROOT, "config", "data-source-registry.json")
    try:
        reg = json.load(open(p, encoding="utf-8"))
        src = next((x for x in reg.get("sources", []) if x.get("id") == "YAHOO_FINANCE_PUBLIC_WEB"), None)
        return bool(src and src.get("enabled") is True and src.get("automatedAccessAllowed") is True)
    except Exception:
        return False

# ---------------- تقويم الجلسات ----------------
def now_cairo(): return dt.datetime.now(CAI) if CAI else dt.datetime.utcnow() + dt.timedelta(hours=3)
def is_trading_day(d, holidays): return d.weekday() in (6, 0, 1, 2, 3) and d.isoformat() not in holidays      # أحد–خميس
def prev_trading_day(d, holidays):
    d -= dt.timedelta(days=1)
    while not is_trading_day(d, holidays): d -= dt.timedelta(days=1)
    return d
def trading_days_between(a, b, holidays):
    """الجلسات في (a, b]."""
    out, d = [], a + dt.timedelta(days=1)
    while d <= b:
        if is_trading_day(d, holidays): out.append(d)
        d += dt.timedelta(days=1)
    return out
def expected_session(now, holidays, cfg):
    """آخر جلسة يُفترض اكتمالها (بعد الإغلاق + grace). يرجع (التاريخ, early) حيث early=True إذا اليوم جلسة تداول لم تنتهِ بعد."""
    hh, mm = map(int, cfg["close_time"].split(":")); close = dt.datetime.combine(now.date(), dt.time(hh, mm)) + dt.timedelta(minutes=cfg["grace_min"])
    today = now.date(); naive = now.replace(tzinfo=None)
    if is_trading_day(today, holidays):
        return (today, False) if naive >= close else (prev_trading_day(today, holidays), True)
    d = today
    while not is_trading_day(d, holidays): d -= dt.timedelta(days=1)
    return d, False

# ---------------- قراءة المخزن ----------------
def trust_of(row):
    if row.get("officialVerified") is True: tier = TIER["official"]
    else: tier = TIER.get(row.get("_tier") or "", None) or tier_from_status(row.get("validationStatus"))
    c = row.get("confidence"); return (tier, (c or {}).get("overall", 0) if isinstance(c, dict) else 0)
def tier_from_status(v):
    v = v or ""
    if v == "precise_public_source_session_confirmed": return TIER["precise"]
    if v == "yahoo_daily_unverified": return TIER["yahoo_daily_unverified"]
    if v in ("", "supplemental_unverified"): return TIER["supplemental_unverified"]
    return 2.5            # حالات تحقق أخرى موجودة في المخزن القديم: بين yahoo والدقيق

def hard_ineligible(meta):
    why = []
    if meta.get("eligibleForDecision") is False: why.append("eligibleForDecision=false")
    if str(meta.get("instrumentStatus") or "").lower() in ("delisted", "suspended", "inactive"): why.append("instrument_status")
    if str(meta.get("historyStatus") or "").startswith(("inactive", "current_session_only")): why.append("history_status")
    if any(("delist" in str(w).lower() or "شطب" in str(w)) for w in meta.get("warnings") or []): why.append("delisting_warning")
    return why

def load_universe(hist_dir):
    uni, bad = {}, {}
    for f in sorted(glob.glob(os.path.join(hist_dir, "*.json"))):
        x = json.load(open(f, encoding="utf-8")); t = x.get("ticker") or os.path.basename(f)[:-5]; s = x.get("sessions") or []
        meta = {k: v for k, v in x.items() if k != "sessions"}; w = hard_ineligible(meta)
        info = dict(file=f, last_date=s[-1]["date"] if s else None, last_close=s[-1]["close"] if s else None, n=len(s), dates={r["date"]: trust_of(r) for r in s})
        (bad if w else uni)[t] = dict(info, why=w)
    return uni, bad

# ---------------- المصادر ----------------
def read_pack(path):
    d = json.load(open(path, encoding="utf-8")); rows = d.get("rows") or []
    for r in rows: r["_origin"] = os.path.basename(path)
    return rows

def parse_market_time(s):
    """'29 September 01:28 PM market time' أو '01:29 PM market time' -> (day, month_name, time) أي جزء قد يكون None."""
    if not s: return None, None, None
    m = re.search(r"(?:(\d{1,2})\s+([A-Za-z]+)\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)", s, re.I)
    if not m: return None, None, None
    h = int(m.group(3)) % 12 + (12 if m.group(5).upper() == "PM" else 0)
    return (int(m.group(1)) if m.group(1) else None), (m.group(2) if m.group(2) else None), dt.time(h, int(m.group(4)))

def yahoo_rows(symbols, session, fetcher, last_close, cfg):
    """مصدر احتياطي للرموز الناقصة فقط. fetcher(symbol) -> JSON خام لـ Yahoo (قابل للحقن في الاختبار)."""
    rows, failed = [], []
    for t in symbols:
        try:
            r = fetcher(t)["chart"]["result"][0]; q = r["indicators"]["quote"][0]
            for i, ts in enumerate(r["timestamp"]):
                local = dt.datetime.fromtimestamp(ts, dt.timezone.utc); d = local.date()
                if d != session or None in (q["close"][i], q["high"][i], q["low"][i], q["volume"][i]): continue
                lc = last_close.get(t)
                if lc and abs(q["close"][i]/lc - 1) > cfg["yahoo_conflict"]: failed.append((t, "yahoo_price_conflict")); break
                rows.append(dict(symbol=t, date=d.isoformat(), open=q["open"][i] or q["close"][i], high=q["high"][i], low=q["low"][i], close=q["close"][i], volume=q["volume"][i],
                                 source="yahoo_daily", primarySource="yahoo", sourceSessionDate=d.isoformat(), sourceMarketTime=None, sourceUrl=f"https://finance.yahoo.com/quote/{t}.CA",
                                 fetchedAt=dt.datetime.now(dt.timezone.utc).isoformat(), validationStatus="yahoo_daily_unverified", warnings=[], _origin="yahoo"))
        except Exception as e: failed.append((t, "fetch_error:" + str(e)[:40]))
    return rows, failed

# ---------------- التحقق ----------------
def num(x):
    try:
        v = float(x); return None if (math.isnan(v) or math.isinf(v)) else v
    except (TypeError, ValueError): return None

def validate_rows(rows, session, uni, bad_uni, cfg, holidays):
    """يرجع (accepted: {ticker: row}, quarantined: [dict])."""
    acc, quar = {}, []
    sd = session.isoformat(); prev_sess = prev_trading_day(session, holidays).isoformat(); minlt = dt.time(*map(int, cfg["min_last_trade"].split(":")))
    def q(r, why): quar.append(dict(symbol=r.get("symbol"), date=r.get("date"), reason=why, origin=r.get("_origin"), close=r.get("close")))
    for r in rows:
        t = str(r.get("symbol") or "").strip().upper(); r["symbol"] = t
        if not SYM.match(t): q(r, "invalid_symbol"); continue
        if t in bad_uni: q(r, "instrument_ineligible:" + ",".join(bad_uni[t]["why"])); continue
        if t not in uni: q(r, "unknown_symbol_identity_guard"); continue
        if r.get("date") != sd: q(r, "date_not_expected_session"); continue
        if r.get("sourceSessionDate") not in (None, sd): q(r, "source_session_date_mismatch"); continue
        o, h, l, c, v = (num(r.get(k)) for k in ("open", "high", "low", "close", "volume"))
        if c is None or c <= 0: q(r, "close_invalid"); continue
        if v is None or v < 0: q(r, "volume_missing_or_negative"); continue
        if None in (o, h, l) or not (l <= o <= h and l <= c <= h): q(r, "ohlc_inconsistent"); continue
        day, mon, tm = parse_market_time(r.get("sourceMarketTime"))
        if day is not None and day != session.day: q(r, "market_time_date_mismatch"); continue
        if tm is not None and tm < minlt: q(r, "latest_timestamp_too_early"); continue
        info = uni[t]; prior = [d for d in info["dates"] if d < sd]; lc = None
        if prior:
            lc = info["last_close"] if info["last_date"] < sd else None
            if lc is None:                      # الجلسة موجودة سلفاً: قارن بما قبلها
                lc = None
        flags = list(r.get("warnings") or [])
        if lc:
            jump = c/lc - 1; r["_jump"] = round(jump*100, 2); r["_prevTrusted"] = lc
            if abs(jump) > cfg["jump_quarantine"]: q(r, f"jump_{jump*100:+.1f}pct_possible_corporate_action"); continue
            if abs(jump) > cfg["jump_warn"]: flags.append("large_move_review")
            pc = num(r.get("previousClose"))
            if pc and info["last_date"] == prev_sess and abs(pc/lc - 1) > cfg["prev_close_tol"]: flags.append("previous_close_mismatch")
        r["warnings"] = flags
        if t in acc:                           # تكرار في نفس الدفعة: الأعلى ثقة يبقى
            keep = acc[t] if trust_of(acc[t]) >= trust_of(r) else r; drop = r if keep is acc[t] else acc[t]; q(drop, "duplicate_in_batch"); acc[t] = keep
        else: acc[t] = r
    return acc, quar

# ---------------- الكتابة (Idempotent + write-then-rename) ----------------
def build_row(r):
    st = r.get("validationStatus") or "supplemental_unverified"
    vol = num(r.get("volume")); vol = int(vol) if vol is not None and float(vol).is_integer() else vol
    row = dict(ticker=r["symbol"], date=r["date"], sourceSessionDate=r.get("sourceSessionDate") or r["date"], sourceMarketTime=r.get("sourceMarketTime"), sourceSessionEvidence=r.get("sourceSessionEvidence"),
               open=num(r["open"]), high=num(r["high"]), low=num(r["low"]), close=num(r["close"]), adjustedClose=num(r["close"]), volume=vol, currency="EGP",
               source=r.get("source"), primarySource=r.get("primarySource"), officialVerified=bool(r.get("officialVerified")), verifiedBy=r.get("verifiedBy") or [],
               sourceUrls=dict(primary=r.get("sourceUrl"), verification=[]), fetchedAt=r.get("fetchedAt"), validatedAt=r.get("validatedAt"),
               confidence=r.get("confidence") if isinstance(r.get("confidence"), dict) else None, validationStatus=st, warnings=r.get("warnings") or [],
               priceTruthMode=r.get("priceTruthMode"))
    if num(r.get("valueTraded")) is not None: row["valueTraded"] = num(r["valueTraded"])          # لا نخترع القيمة
    if r.get("_prevTrusted") is not None: row["previousTrustedClose"] = r["_prevTrusted"]; row["jumpPct"] = r["_jump"]
    return {k: v for k, v in row.items() if v is not None or k in ("confidence", "sourceSessionEvidence", "sourceMarketTime")}

def atomic_write(path, obj):
    tmp = path + ".tmp"; open(tmp, "w", encoding="utf-8").write(json.dumps(obj, ensure_ascii=False, indent=2) + "\n"); os.replace(tmp, path)

def apply_rows(accepted, uni, backup_dir, source_label, now_iso, dry_run=False):
    stats = dict(inserted=0, replaced=0, kept_existing=0, files_changed=0)
    for t, r in accepted.items():
        f = uni[t]["file"]; x = json.load(open(f, encoding="utf-8")); s = x.get("sessions") or []; new = build_row(r); idx = next((i for i, e in enumerate(s) if e["date"] == new["date"]), None)
        if idx is not None:
            if trust_of(new) > trust_of(s[idx]): s[idx] = new; stats["replaced"] += 1
            else: stats["kept_existing"] += 1; continue                       # لا تُضعف صفاً موجوداً ولا تُعد الكتابة
        else: s.append(new); s.sort(key=lambda e: e["date"]); stats["inserted"] += 1
        x["sessions"] = s; x["lastSession"] = s[-1]["date"]; x["availableSessions"] = x["sessionsCount"] = len(s); x["updatedAt"] = now_iso; x["lastUpdateSource"] = source_label
        if not dry_run:
            os.makedirs(backup_dir, exist_ok=True); shutil.copy2(f, os.path.join(backup_dir, os.path.basename(f))) if not os.path.exists(os.path.join(backup_dir, os.path.basename(f))) else None
            atomic_write(f, x)
        stats["files_changed"] += 1
    return stats

def prune_backups(base, keep):
    runs = sorted(d for d in glob.glob(os.path.join(base, "*")) if os.path.isdir(d))
    for d in runs[:-keep] if keep else runs: shutil.rmtree(d, ignore_errors=True)

# ---------------- Stage 1 (المحرك) ----------------
def default_stage1(root, fast=None):
    fast = (os.environ.get("EGX_FAST") == "1") if fast is None else fast          # الافتراضي: تشغيل كامل مع Placebo
    r = subprocess.run([sys.executable, os.path.join(root, "engine", "egx_engine.py")] + (["--fast"] if fast else []), cwd=root, capture_output=True, text=True, env=dict(os.environ, PYTHONIOENCODING="utf-8"))
    if r.returncode: raise RuntimeError("engine failed: " + (r.stderr or r.stdout)[-300:])
    return json.load(open(os.path.join(root, "data", "signals.json"), encoding="utf-8"))

def pub_gate(doc):
    """قابل للنشر فقط إذا البيانات حديثة ويوجد على الأقل توصية بدرجة A (دليل إحصائي كافٍ). المرشحون يُولَّدون دائماً بصرف النظر عن هذه البوابة."""
    return bool((not doc.get("stale")) and any(r.get("tier") == "A" for r in doc.get("recommendations", [])))

def prior_candidates(root):
    try: return len(json.load(open(os.path.join(root, "data", "signals.json"), encoding="utf-8")).get("recommendations", []))
    except Exception: return 0

# ---------------- التشغيل ----------------
def run(root=ROOT, now=None, cfg=None, holidays=None, force=False, no_yahoo=False, dry_run=False, no_stage1=False, yahoo_fetcher=None, stage1=None, inbox=None, hist_dir=None):
    sp = os.path.join(root, "config", "sources.json"); src_cfg = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else {}
    cfg = {**DEFAULTS, **src_cfg.get("thresholds", {}), **(cfg or {})}; now = now or now_cairo(); hist_dir = hist_dir or os.path.join(root, "data", "history"); inbox = inbox or os.path.join(root, "data", "inbox")
    if holidays is None:
        hp = os.path.join(root, "config", "holidays.json"); holidays = set(json.load(open(hp))) if os.path.exists(hp) else set()
    status_path = os.path.join(root, "data", "daily-data-update-status.json")
    exp, early = expected_session(now, holidays, cfg); expd = exp.isoformat()
    st = dict(expectedSession=expd, actualAcceptedSession=None, generatedAt=dt.datetime.now(dt.timezone.utc).isoformat(), guard=None, sourceSessionReady=False, latestTimestamp=None, coveragePct=0.0,
              universeCount=0, acceptedRows=0, staleRows=0, failedRows=0, realFetch=False, primarySource=None, fallbackUsed=False, historyUpdated=False, stage1Prepared=False,
              preparedCandidateCount=prior_candidates(root), originalRecommendationCount=prior_candidates(root), publicationEligible=False, finalStatus="FAILED",
              sourceBreakdown={}, sessionsApplied=[], sessionsSkipped=[], staleSymbols=[], failedSymbols=[], quarantinedCount=0, notes=[])
    try:
        uni, bad = load_universe(hist_dir); st["universeCount"] = len(uni)
        last_dates = sorted(i["last_date"] for i in uni.values() if i["last_date"]); stored_latest = last_dates[-1] if last_dates else None
        median_last = last_dates[len(last_dates)//2] if last_dates else None                       # نافذة المعلّق تبدأ من الوسيط (متينة ضد سهم متقدم/ميّت)
        cov_now = (sum(1 for i in uni.values() if i["last_date"] and i["last_date"] >= expd) / len(uni)) if uni else 0
        current = cov_now >= cfg["success_coverage"]
        if current and not force:
            st.update(guard="SKIP_EARLY" if early else "NOOP_ALREADY_CURRENT", finalStatus="ALREADY_CURRENT", actualAcceptedSession=stored_latest, coveragePct=round(100*cov_now, 1), sourceSessionReady=True)
            if early: st["notes"].append("قبل الإغلاق + فترة السماح؛ الجلسة السابقة محدّثة")
            return finish(st, status_path, dry_run)
        start = dt.date.fromisoformat(median_last) if median_last else exp - dt.timedelta(days=30)
        pending = trading_days_between(start, exp, holidays) or [exp]
        # --- جمع صفوف الحزم ---
        packs = sorted(glob.glob(os.path.join(inbox, "*.json"))); all_rows = []
        for p in packs:
            try: all_rows += read_pack(p)
            except Exception as e: st["notes"].append(f"pack_unreadable:{os.path.basename(p)}:{str(e)[:40]}")
        st["primarySource"] = "session_pack" if packs else None; st["realFetch"] = bool(packs)
        run_id = now.strftime("%Y%m%dT%H%M%S"); backup_dir = os.path.join(root, "data", "backups", run_id); all_quar = []; applied_any = False; last_ok_cov = 0.0
        for sess in pending:
            sd = sess.isoformat(); rows = [r for r in all_rows if r.get("date") == sd]
            acc, quar = validate_rows(rows, sess, uni, bad, cfg, holidays)
            fallback = False
            missing = [t for t in uni if t not in acc and (uni[t]["dates"].get(sd) is None)]
            if not no_yahoo and yahoo_fetcher is not None and missing and (len(acc)/max(len(uni), 1) < cfg["success_coverage"]):
                lc = {t: uni[t]["last_close"] for t in uni}; yr, yf = yahoo_rows(missing, sess, yahoo_fetcher, lc, cfg); a2, q2 = validate_rows(yr, sess, uni, bad, cfg, holidays)
                for t, r in a2.items(): acc.setdefault(t, r)
                quar += q2; fallback = bool(a2); st["failedSymbols"] += [f"{t}:{w}" for t, w in yf]; st["realFetch"] = True
                if fallback: st["fallbackUsed"] = True
            have = {t for t in uni if sd in uni[t]["dates"]} | set(acc)
            cov = len(have)/max(len(uni), 1); all_quar += quar
            tms = [parse_market_time(r.get("sourceMarketTime"))[2] for r in acc.values()]; tms = [x for x in tms if x]
            same_sess = len(acc)
            if sess == exp: st["latestTimestamp"] = f"{sd}T{max(tms).strftime('%H:%M')} (earliest {min(tms).strftime('%H:%M')})" if tms else None; st["sourceSessionReady"] = same_sess > 0; st["acceptedRows"] = same_sess; st["coveragePct"] = round(100*cov, 1)
            if not acc: continue                                                                # لا صفوف معتمدة جديدة لهذه الجلسة: لا تطبيق ولا ضجيج
            if cov < cfg["min_coverage"]:
                st["sessionsSkipped"].append(dict(session=sd, reason="low_coverage", coveragePct=round(100*cov, 1), accepted=same_sess)); continue
            stats = apply_rows(acc, uni, backup_dir, "daily_update:" + (st["primarySource"] or "yahoo"), now.isoformat(), dry_run)
            for t, r in acc.items(): uni[t]["dates"][sd] = trust_of(r); uni[t]["last_date"] = max(uni[t]["last_date"] or sd, sd); uni[t]["last_close"] = r["close"] if uni[t]["last_date"] == sd else uni[t]["last_close"]
            st["sessionsApplied"].append(dict(session=sd, coveragePct=round(100*cov, 1), accepted=same_sess, **stats)); applied_any = applied_any or stats["files_changed"] > 0 or same_sess > 0
            if sess == exp: last_ok_cov = cov
            for r in acc.values(): st["sourceBreakdown"][r.get("primarySource") or r.get("source") or "unknown"] = st["sourceBreakdown"].get(r.get("primarySource") or r.get("source") or "unknown", 0) + 1
        st["quarantinedCount"] = len(all_quar); st["failedRows"] = len(all_quar)
        got_exp = any(a["session"] == expd for a in st["sessionsApplied"])
        st["actualAcceptedSession"] = max([a["session"] for a in st["sessionsApplied"]], default=stored_latest)
        st["historyUpdated"] = any(a["inserted"] + a["replaced"] > 0 for a in st["sessionsApplied"]) and not dry_run
        st["staleSymbols"] = sorted(t for t in uni if (uni[t]["last_date"] or "") < expd); st["staleRows"] = len(st["staleSymbols"])
        if not dry_run and all_quar:
            os.makedirs(os.path.join(root, "data", "quarantine"), exist_ok=True); atomic_write(os.path.join(root, "data", "quarantine", f"{expd}.json"), dict(session=expd, generatedAt=st["generatedAt"], rows=all_quar))
        if not got_exp and cov_now >= cfg["min_coverage"]:                                       # الجلسة مطبّقة سابقاً بتغطية كافية ولا صفوف جديدة
            old = {}
            try: old = json.load(open(status_path, encoding="utf-8"))
            except Exception: pass
            if old.get("actualAcceptedSession") == expd:                                          # حافظ على نتائج Stage 1 السابقة (لا تذبذب في التقرير)
                for k in ("stage1Prepared", "preparedCandidateCount", "originalRecommendationCount", "publicationEligible", "historyUpdated", "sessionsApplied", "sourceBreakdown", "latestTimestamp", "primarySource", "realFetch", "quarantinedCount", "failedRows", "acceptedRows"):
                    if k in old: st[k] = old[k]
            st.update(guard="NOOP_NO_NEW_ROWS", finalStatus="PARTIAL", actualAcceptedSession=expd, coveragePct=round(100*cov_now, 1), sourceSessionReady=True)
            st["staleSymbols"] = sorted(t for t in uni if (uni[t]["last_date"] or "") < expd); st["staleRows"] = len(st["staleSymbols"])
            st["notes"].append("لا صفوف جديدة؛ الجلسة مطبّقة بتغطية %.1f%%" % (100*cov_now))
            if force and not dry_run and not no_stage1:
                doc = (stage1 or (lambda: default_stage1(root)))(); n = len(doc.get("recommendations", [])); st.update(stage1Prepared=True, preparedCandidateCount=n, originalRecommendationCount=n, publicationEligible=pub_gate(doc))
            return finish(st, status_path, dry_run)
        if not got_exp:
            st.update(guard="WAITING_DATA", finalStatus="WAITING_DATA"); st["notes"].append("لا بيانات معتمدة لجلسة %s (مصدر قديم/ناقص/تغطية منخفضة). لم تُستبدل أي بيانات ولم يُعاد الترتيب." % expd)
            return finish(st, status_path, dry_run)
        if not dry_run:                                                                       # الحزم المعالجة تُنقل للأرشيف (تدقيق) ولا تُعاد معالجتها
            pdir = os.path.join(inbox, "processed"); os.makedirs(pdir, exist_ok=True)
            for pth in packs:
                if os.path.exists(pth): shutil.move(pth, os.path.join(pdir, os.path.basename(pth)))
        st["guard"] = "APPLY"; st["finalStatus"] = "SUCCESS" if last_ok_cov >= cfg["success_coverage"] and not st["sessionsSkipped"] else "PARTIAL"
        if not dry_run and not no_stage1:
            try:
                doc = (stage1 or (lambda: default_stage1(root)))(); n = len(doc.get("recommendations", []))
                st.update(stage1Prepared=True, preparedCandidateCount=n, originalRecommendationCount=n)
                st["publicationEligible"] = pub_gate(doc)                                          # بوابة النشر مستقلة عن توليد المرشحين
            except Exception as e:
                st["notes"].append("stage1_error:" + str(e)[:120]); st["finalStatus"] = "PARTIAL"
        if not dry_run: prune_backups(os.path.join(root, "data", "backups"), cfg["keep_backups"])
    except Exception as e:
        st["finalStatus"] = "FAILED"; st["notes"].append("exception:" + repr(e)[:200])
    return finish(st, status_path, dry_run)

def finish(st, path, dry_run):
    """لا يُعاد كتابة التقرير إذا لم يتغير شيء سوى generatedAt (تجنّب commits فارغة 3 مرات يومياً)."""
    if dry_run: return st
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        old = json.load(open(path, encoding="utf-8")); strip = lambda d: {k: v for k, v in d.items() if k != "generatedAt"}
        if strip(old) == strip(st): return st
    except Exception: pass
    atomic_write(path, st); return st

if __name__ == "__main__":
    a = set(sys.argv[1:]); fetch = None
    _sp = os.path.join(ROOT, "config", "sources.json")
    _legacy_yahoo_on = json.load(open(_sp, encoding="utf-8")).get("yahoo_fallback", True) if os.path.exists(_sp) else True
    _registry_yahoo_allowed = yahoo_automated_access_allowed()
    _yahoo_on = _legacy_yahoo_on and _registry_yahoo_allowed
    if "--no-yahoo" not in a and _yahoo_on:
        import urllib.request
        def fetch(t):
            req = urllib.request.Request(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}.CA?range=5d&interval=1d", headers={"User-Agent": "Mozilla/5.0"}); return json.load(urllib.request.urlopen(req, timeout=20))
    forced_no_yahoo = "--no-yahoo" in a or not _yahoo_on
    s = run(force="--force" in a, no_yahoo=forced_no_yahoo, dry_run="--dry-run" in a, no_stage1="--no-stage1" in a, yahoo_fetcher=fetch)
    if not _registry_yahoo_allowed:
        note="Yahoo automated fallback disabled by config/data-source-registry.json compliance policy"
        if note not in s.get("notes", []): s.setdefault("notes", []).append(note)
    print(json.dumps({k: s[k] for k in ("expectedSession", "actualAcceptedSession", "guard", "finalStatus", "coveragePct", "universeCount", "acceptedRows", "staleRows", "quarantinedCount", "historyUpdated", "stage1Prepared", "preparedCandidateCount", "publicationEligible", "notes")}, ensure_ascii=False, indent=1))
    sys.exit({"SUCCESS": 0, "PARTIAL": 0, "ALREADY_CURRENT": 0, "WAITING_DATA": 0, "FAILED": 1}[s["finalStatus"]])
