// Ядро: состояние, хранилище (localStorage), расчёты, конфликты, проверки, CSV.
// Подключается обычным <script> (file:// блокирует ES-модули), всё складывается в window.VS.
(function() {
  'use strict';

  const VS = window.VS = {};

  // ================== КОНСТАНТЫ ==================
  const YEAR = VS.YEAR = 2026;

  const KEYS = {
    employees: 'employees',
    vacations: 'vacations',
    conflictGroups: 'conflictGroups', // старый формат «групп пересечений», только для миграции
    groups: 'groups',
    pairs: 'pairs',
    blackouts: 'blackouts',
    checks: 'checks',
    holidays: 'holidays'
  };

  // Строки статусов храним как раньше (без «ё») — для совместимости с localStorage и CSV
  const ST = VS.ST = {
    P: { value: 'Запланирован', label: 'Запланирован', short: 'План', cls: 'st-P' },
    U: { value: 'Использован', label: 'Использован', short: 'Исп.', cls: 'st-U' },
    R: { value: 'Перенесен', label: 'Перенесён', short: 'Перен.', cls: 'st-R' },
    C: { value: 'Отменен', label: 'Отменён', short: 'Отм.', cls: 'st-C' }
  };
  VS.ST_KEYS = ['P', 'U', 'R', 'C'];
  VS.statusKey = value => VS.ST_KEYS.find(k => ST[k].value === value) || 'P';

  VS.MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  VS.MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  VS.MONTHS_GEN = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  VS.DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

  const FALLBACK_HOLIDAYS = {
    holiday: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11',
      '2026-02-23', '2026-03-08', '2026-05-01', '2026-05-09', '2026-06-12', '2026-11-04', '2026-12-31'],
    preholiday: ['2026-04-30', '2026-05-08', '2026-06-11', '2026-11-03']
  };

  const DEFAULT_CHECKS = { min14: true, leftover: true, workdaysOnly: true, afterHolidays: false };

  // ================== СОСТОЯНИЕ ДАННЫХ ==================
  const data = VS.data = {
    employees: [],   // {id, name, totalVacationDays, usedVacationDays}
    vacations: [],   // {id, employeeId, name, start, end, days, workingDays, status}
    groups: [],      // {id, name, maxConcurrent, memberIds[]}
    pairs: [],       // [idA, idB]
    blackouts: [],   // {id, name, start, end}
    checks: { ...DEFAULT_CHECKS },
    holidays: {},    // {[year]: {[iso]: 'holiday'|'preholiday'}} — правки пользователя
    baseHolidays: {} // {[year]: {...}} — из templates/holidays.csv (или резервные значения)
  };

  // Производные данные, пересчитываются в recalc()
  const derived = VS.derived = { conflicts: [], issues: [], byEmp: new Map() };

  // ================== УТИЛИТЫ ==================
  VS.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let idCounter = 0;
  VS.newId = () => Date.now() * 100 + (idCounter++ % 100);

  // «А, Б и В»
  VS.joinRu = arr => arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' и ' + arr[arr.length - 1];

  // Русское склонение: plural(5, ['конфликт','конфликта','конфликтов'])
  VS.plural = (n, forms) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  };

  // ================== ДАТЫ ==================
  // Все расчёты по дням — через UTC, чтобы часовой пояс не сдвигал даты
  const DAY = 864e5;
  const pad = n => String(n).padStart(2, '0');
  VS.isoFromYMD = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  VS.utcOf = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  VS.isoFromUtc = t => { const dt = new Date(t); return VS.isoFromYMD(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()); };
  VS.addDays = (iso, n) => VS.isoFromUtc(VS.utcOf(iso) + n * DAY);
  VS.diffDays = (a, b) => Math.round((VS.utcOf(b) - VS.utcOf(a)) / DAY);
  VS.isValidIso = iso => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };
  // Индекс дня в году YEAR (0 = 1 января). Может быть <0 или >364 для дат вне года
  VS.doy = iso => Math.round((VS.utcOf(iso) - Date.UTC(YEAR, 0, 1)) / DAY);
  VS.isoOfDoy = i => VS.isoFromUtc(Date.UTC(YEAR, 0, 1) + i * DAY);
  VS.daysInYear = y => (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY;
  VS.YEAR_DAYS = VS.daysInYear(YEAR);
  VS.monthStartDoy = m => m > 11 ? VS.YEAR_DAYS : Math.round((Date.UTC(YEAR, m, 1) - Date.UTC(YEAR, 0, 1)) / DAY);
  VS.weekdayMon = iso => (new Date(VS.utcOf(iso)).getUTCDay() + 6) % 7; // пн=0 … вс=6
  VS.isWeekend = iso => VS.weekdayMon(iso) >= 5;

  VS.fmtNum = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };       // 19.10.2026
  VS.fmtShort = iso => { const [, m, d] = iso.split('-'); return `${d}.${m}`; };                                       // 19.10
  VS.fmtDay = iso => { const [, m, d] = iso.split('-').map(Number); return `${d} ${VS.MONTHS_GEN[m - 1]}`; };          // 19 окт
  VS.fmtRange = (s, e) => {
    const [, ms, ds] = s.split('-').map(Number), [, me, de] = e.split('-').map(Number);
    if (s === e) return VS.fmtDay(s);
    if (ms === me) return `${ds}–${de} ${VS.MONTHS_GEN[me - 1]}`;
    return `${VS.fmtDay(s)} – ${VS.fmtDay(e)}`;
  };
  VS.fmtRangeNum = (s, e) => `${VS.fmtShort(s)} – ${VS.fmtNum(e)}`;
  // ДД.ММ.ГГГГ → ISO; null, если не распознано
  VS.parseHuman = str => {
    const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(str || '');
    if (!m) return null;
    const iso = `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
    return VS.isValidIso(iso) ? iso : null;
  };
  VS.todayIso = () => { const t = new Date(); return VS.isoFromYMD(t.getFullYear(), t.getMonth(), t.getDate()); };

  // ================== ПРОИЗВОДСТВЕННЫЙ КАЛЕНДАРЬ ==================
  VS.holidayMap = year => data.holidays[year] || data.baseHolidays[year] || {};
  VS.dayType = iso => VS.holidayMap(+iso.slice(0, 4))[iso] || '';
  VS.isHoliday = iso => VS.dayType(iso) === 'holiday';
  VS.isPreHoliday = iso => VS.dayType(iso) === 'preholiday';
  VS.isWorkingDay = iso => !VS.isWeekend(iso) && !VS.isHoliday(iso);

  // Устанавливает тип дня ('' | 'holiday' | 'preholiday') с копированием базы при первой правке
  VS.setDayType = (iso, type) => {
    const year = +iso.slice(0, 4);
    if (!data.holidays[year]) data.holidays[year] = { ...(data.baseHolidays[year] || {}) };
    if (type) data.holidays[year][iso] = type; else delete data.holidays[year][iso];
  };

  function parseHolidaysCsvText(text) {
    const map = {};
    text.split(/\r?\n/).slice(1).forEach(line => {
      const [date, type] = line.split(/[,;]/).map(s => (s || '').trim());
      if (VS.isValidIso(date) && (type === 'holiday' || type === 'preholiday')) map[date] = type;
    });
    return map;
  }

  function splitByYear(map) {
    const out = {};
    Object.keys(map).forEach(iso => { const y = +iso.slice(0, 4); (out[y] = out[y] || {})[iso] = map[iso]; });
    return out;
  }

  async function loadBaseHolidays() {
    try {
      const resp = await fetch('templates/holidays.csv');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      data.baseHolidays = splitByYear(parseHolidaysCsvText(await resp.text()));
    } catch (e) {
      // file:// не даёт fetch — используем резервный список (совпадает с holidays.csv)
      const map = {};
      FALLBACK_HOLIDAYS.holiday.forEach(d => map[d] = 'holiday');
      FALLBACK_HOLIDAYS.preholiday.forEach(d => map[d] = 'preholiday');
      data.baseHolidays = splitByYear(map);
    }
  }

  // Отпускные дни: календарные минус праздники (выходные считаются — как раньше)
  VS.calcVacationMetrics = (startIso, endIso) => {
    if (!VS.isValidIso(startIso) || !VS.isValidIso(endIso) || endIso < startIso) return null;
    const calendarDays = VS.diffDays(startIso, endIso) + 1;
    let holidayDays = 0;
    for (let i = 0; i < calendarDays; i++) if (VS.isHoliday(VS.addDays(startIso, i))) holidayDays++;
    const vacationDays = calendarDays - holidayDays;
    return { calendarDays, holidayDays, vacationDays, workingDays: vacationDays };
  };

  // ================== ХРАНИЛИЩЕ ==================
  const readJson = (key, def) => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : def; }
    catch (e) { console.error('Ошибка чтения localStorage', key, e); return def; }
  };

  VS.load = async function() {
    await loadBaseHolidays();
    data.employees = readJson(KEYS.employees, []);
    data.vacations = readJson(KEYS.vacations, []);
    data.groups = readJson(KEYS.groups, []);
    data.blackouts = readJson(KEYS.blackouts, []);
    data.checks = { ...DEFAULT_CHECKS, ...readJson(KEYS.checks, {}) };
    data.holidays = readJson(KEYS.holidays, {});

    // Миграция: «группы пересечений» → несовместимые пары (только если pairs ещё нет).
    // Старый ключ conflictGroups не удаляем — чтобы можно было откатиться на прежнюю версию.
    const pairsRaw = localStorage.getItem(KEYS.pairs);
    if (pairsRaw === null) {
      const legacy = readJson(KEYS.conflictGroups, []);
      // дубликаты (в т.ч. A/B и B/A) схлопываем — старый алгоритм считал такую пару один раз
      const seen = new Set();
      data.pairs = legacy
        .filter(g => g && g.employee1Id != null && g.employee2Id != null && g.employee1Id !== g.employee2Id)
        .map(g => [Math.min(g.employee1Id, g.employee2Id), Math.max(g.employee1Id, g.employee2Id)])
        .filter(p => { const k = p.join('/'); if (seen.has(k)) return false; seen.add(k); return true; });
      localStorage.setItem(KEYS.pairs, JSON.stringify(data.pairs));
    } else {
      data.pairs = readJson(KEYS.pairs, []);
    }
    VS.recalc();
  };

  VS.save = function() {
    localStorage.setItem(KEYS.employees, JSON.stringify(data.employees));
    localStorage.setItem(KEYS.vacations, JSON.stringify(data.vacations));
    localStorage.setItem(KEYS.groups, JSON.stringify(data.groups));
    localStorage.setItem(KEYS.pairs, JSON.stringify(data.pairs));
    localStorage.setItem(KEYS.blackouts, JSON.stringify(data.blackouts));
    localStorage.setItem(KEYS.checks, JSON.stringify(data.checks));
    localStorage.setItem(KEYS.holidays, JSON.stringify(data.holidays));
  };

  VS.clearAll = function() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    data.employees = []; data.vacations = []; data.groups = []; data.pairs = []; data.blackouts = [];
    data.checks = { ...DEFAULT_CHECKS }; data.holidays = {};
    VS.recalc();
    VS.save();
  };

  // Удаление сотрудника с очисткой всех ссылок на него
  VS.deleteEmployee = function(id) {
    data.employees = data.employees.filter(e => e.id !== id);
    data.vacations = data.vacations.filter(v => v.employeeId !== id);
    data.pairs = data.pairs.filter(p => p[0] !== id && p[1] !== id);
    data.groups.forEach(g => { g.memberIds = g.memberIds.filter(m => m !== id); });
  };

  // ================== ВЫБОРКИ ==================
  VS.emp = id => data.employees.find(e => e.id === id);
  VS.empShort = id => {
    const e = VS.emp(id); if (!e) return '?';
    const p = e.name.trim().split(/\s+/);
    return p.length > 1 ? `${p[0]} ${p[1][0]}.` : p[0];
  };
  VS.isActive = v => v.status === ST.P.value || v.status === ST.U.value;
  VS.vacDays = v => v.days || 0;
  VS.groupsOf = id => data.groups.filter(g => g.memberIds.includes(id));
  VS.pairPartners = id => data.pairs.filter(p => p.includes(id)).map(p => p[0] === id ? p[1] : p[0]);
  VS.isPair = (a, b) => a !== b && data.pairs.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));

  // Баланс сотрудника: использовано (Использован) / в плане (Запланирован) / остаток
  VS.balance = id => {
    const e = VS.emp(id);
    const st = derived.byEmp.get(id) || { used: 0, plan: 0 };
    const total = e ? e.totalVacationDays : 0;
    return { total, used: st.used, plan: st.plan, left: total - st.used - st.plan };
  };

  // ================== ПЕРЕСЧЁТ ==================
  // Пересечение двух интервалов; при включённой проверке «выходные не считаются» —
  // только если есть общий рабочий день. Возвращает {s,e} или null
  VS.overlap = (s1, e1, s2, e2) => {
    const s = s1 > s2 ? s1 : s2, e = e1 < e2 ? e1 : e2;
    if (e < s) return null;
    if (data.checks.workdaysOnly) {
      let any = false;
      for (let d = s; d <= e; d = VS.addDays(d, 1)) if (VS.isWorkingDay(d)) { any = true; break; }
      if (!any) return null;
    }
    return { s, e };
  };

  // Нарушения лимита групп. extra — «виртуальный» отпуск (черновик) для предпросмотра
  function groupViolations(vacs) {
    const out = [];
    data.groups.forEach(g => {
      const members = new Set(g.memberIds);
      const gv = vacs.filter(v => members.has(v.employeeId) && VS.isActive(v));
      if (gv.length <= g.maxConcurrent) return;
      let minS = gv[0].start, maxE = gv[0].end;
      gv.forEach(v => { if (v.start < minS) minS = v.start; if (v.end > maxE) maxE = v.end; });
      let run = null;
      const flush = () => { if (run) out.push(run); run = null; };
      for (let d = minS; d <= maxE; d = VS.addDays(d, 1)) {
        const absent = new Set(gv.filter(v => v.start <= d && v.end >= d).map(v => v.employeeId));
        const skip = data.checks.workdaysOnly && !VS.isWorkingDay(d);
        if (absent.size > g.maxConcurrent && !skip) {
          if (!run) run = { type: 'group', groupId: g.id, s: d, e: d, ids: new Set(), peak: 0, vacIds: new Set() };
          run.e = d;
          absent.forEach(id => run.ids.add(id));
          gv.filter(v => v.start <= d && v.end >= d).forEach(v => run.vacIds.add(v.id));
          run.peak = Math.max(run.peak, absent.size);
        } else if (!skip || absent.size <= g.maxConcurrent) {
          // нерабочий день внутри серии не разрывает её, рабочий день без нарушения — разрывает
          if (!(skip && run)) flush();
        }
      }
      flush();
    });
    return out.map(r => ({ ...r, ids: [...r.ids], vacIds: [...r.vacIds] }));
  }

  function pairConflicts(vacs) {
    const out = [];
    const active = vacs.filter(VS.isActive);
    data.pairs.forEach(([a, b]) => {
      active.filter(v => v.employeeId === a).forEach(v1 => active.filter(v => v.employeeId === b).forEach(v2 => {
        const o = VS.overlap(v1.start, v1.end, v2.start, v2.end);
        if (o) out.push({ type: 'pair', a, b, s: o.s, e: o.e, ids: [a, b], vacIds: [v1.id, v2.id] });
      }));
    });
    return out;
  }

  VS.computeConflicts = vacs => [...pairConflicts(vacs), ...groupViolations(vacs)].sort((x, y) => x.s < y.s ? -1 : 1);

  VS.recalc = function() {
    // пересчитываем отпускные дни по актуальному производственному календарю
    data.vacations.forEach(v => {
      const m = VS.calcVacationMetrics(v.start, v.end);
      if (m) { v.days = m.vacationDays; v.workingDays = m.workingDays; }
      const e = VS.emp(v.employeeId); if (e) v.name = e.name;
    });
    derived.byEmp = new Map();
    data.employees.forEach(e => derived.byEmp.set(e.id, { used: 0, plan: 0 }));
    data.vacations.forEach(v => {
      const st = derived.byEmp.get(v.employeeId); if (!st) return;
      if (v.status === ST.U.value) st.used += VS.vacDays(v);
      if (v.status === ST.P.value) st.plan += VS.vacDays(v);
    });
    data.employees.forEach(e => { e.usedVacationDays = derived.byEmp.get(e.id).used; });
    derived.conflicts = VS.computeConflicts(data.vacations);
    derived.issues = VS.computeIssues();
  };

  VS.conflictTitle = c => {
    if (c.type === 'pair') return `${VS.empShort(c.a)} и ${VS.empShort(c.b)}`;
    const g = data.groups.find(x => x.id === c.groupId);
    return `${g ? g.name : 'Группа'}: ${c.ids.map(VS.empShort).join(', ')}`;
  };

  // ================== ПРОВЕРКИ ==================
  // Первая рабочая неделя января и мая: 7 дней от первого рабочего дня месяца
  VS.afterHolidayPeriods = year => [0, 4].map(m => {
    let d = VS.isoFromYMD(year, m, 1);
    for (let i = 0; i < 31 && !VS.isWorkingDay(d); i++) d = VS.addDays(d, 1);
    return { s: d, e: VS.addDays(d, 6), name: m === 0 ? 'первая рабочая неделя января' : 'первая рабочая неделя мая' };
  });

  // Предупреждения для одного отпуска (черновика или существующего)
  VS.vacationWarnings = function(draft) {
    const warns = [];
    if (!draft || draft.empId == null || !draft.start || !draft.end) return warns;
    const id = draft.empId, vid = draft.vacId;
    const others = data.vacations.filter(v => v.id !== vid);
    const status = VS.ST[draft.status] ? VS.ST[draft.status].value : ST.P.value;
    const self = { id: vid != null ? vid : -1, employeeId: id, start: draft.start, end: draft.end, status };
    const active = VS.isActive(self);

    if (active) {
      VS.pairPartners(id).forEach(o => {
        others.filter(v => v.employeeId === o && VS.isActive(v)).forEach(v => {
          const ov = VS.overlap(draft.start, draft.end, v.start, v.end);
          if (ov) warns.push({ kind: 'pair', title: 'Пересечение с ' + VS.empShort(o), text: `${VS.fmtRange(ov.s, ov.e)}. Пара отмечена как несовместимая.` });
        });
      });
      groupViolations([...others, self]).filter(r => r.ids.includes(id) && r.s <= draft.end && r.e >= draft.start).forEach(r => {
        const g = data.groups.find(x => x.id === r.groupId);
        warns.push({ kind: 'group', title: `Лимит группы «${g ? g.name : ''}»`, text: `${VS.fmtRange(r.s, r.e)}: отсутствуют ${r.peak} при лимите ${g ? g.maxConcurrent : '?'}.` });
      });
      data.blackouts.forEach(b => {
        if (draft.start <= b.end && draft.end >= b.start) warns.push({ kind: 'blackout', title: 'Запретный период: ' + b.name, text: `${VS.fmtRange(b.start, b.end)} — отпуск в эти даты не планируется.` });
      });
      if (data.checks.afterHolidays) {
        VS.afterHolidayPeriods(+draft.start.slice(0, 4)).forEach(p => {
          if (draft.start <= p.e && draft.end >= p.s) warns.push({ kind: 'after', title: 'Сразу после праздников', text: `Пересекает ${p.name} (${VS.fmtRange(p.s, p.e)}).` });
        });
      }
      const own = others.filter(v => v.employeeId === id && v.status !== ST.C.value && v.start <= draft.end && v.end >= draft.start);
      if (own.length) warns.push({ kind: 'self', title: 'Пересекается с другим отпуском', text: own.map(v => VS.fmtRange(v.start, v.end)).join(', ') });
    }
    return warns;
  };

  // Расчёт для панели: дни, баланс с учётом черновика
  VS.draftMetrics = function(draft) {
    const m = draft && draft.start && draft.end ? VS.calcVacationMetrics(draft.start, draft.end) : null;
    const res = { cal: m ? m.calendarDays : 0, hol: m ? m.holidayDays : 0, vac: m ? m.vacationDays : 0, total: 0, used: 0, plan: 0, after: 0 };
    if (draft && draft.empId != null && VS.emp(draft.empId)) {
      const b = VS.balance(draft.empId);
      let used = b.used, plan = b.plan;
      // редактируемый отпуск не считаем дважды
      const ex = draft.vacId != null ? data.vacations.find(v => v.id === draft.vacId) : null;
      if (ex && ex.status === ST.U.value) used -= VS.vacDays(ex);
      if (ex && ex.status === ST.P.value) plan -= VS.vacDays(ex);
      const counts = draft.status === 'P' || draft.status === 'U';
      Object.assign(res, { total: b.total, used, plan, after: b.total - used - plan - (counts ? res.vac : 0) });
    }
    return res;
  };

  // Самая длинная часть отпуска (Запланирован/Использован) — для проверки ст. 125 ТК РФ
  VS.longestPart = id => {
    let best = null;
    data.vacations.filter(v => v.employeeId === id && VS.isActive(v)).forEach(v => { if (!best || VS.vacDays(v) > VS.vacDays(best)) best = v; });
    return best;
  };

  VS.computeIssues = function() {
    const issues = [];
    derived.conflicts.forEach(c => {
      if (c.type === 'group') {
        const g = data.groups.find(x => x.id === c.groupId);
        issues.push({ k: 'ГРУППА', t: `${g ? g.name : 'Группа'}: ${c.peak} из ${g ? g.memberIds.length : '?'} одновременно`, d: `${VS.joinRu(c.ids.map(VS.empShort))} · ${VS.fmtRange(c.s, c.e)}`, ids: c.ids, s: c.s });
      } else {
        issues.push({ k: 'ПАРА', t: `${VS.empShort(c.a)} и ${VS.empShort(c.b)} вместе`, d: `${VS.fmtRange(c.s, c.e)} · пара несовместима`, ids: c.ids, s: c.s });
      }
    });
    if (data.checks.min14) {
      data.employees.forEach(e => {
        const parts = data.vacations.filter(v => v.employeeId === e.id && VS.isActive(v));
        if (!parts.length) return;
        if (parts.some(v => VS.vacDays(v) >= 14)) return;
        issues.push({ k: 'ТК · 14 ДНЕЙ', t: `${VS.empShort(e.id)}: нет части от 14 дней`, d: 'Части: ' + parts.map(v => `${VS.vacDays(v)} дн (${VS.fmtRange(v.start, v.end)})`).join(', '), ids: [e.id] });
      });
    }
    if (data.checks.leftover) {
      const left = data.employees.map(e => ({ e, n: VS.balance(e.id).left })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
      if (left.length) {
        const list = left.slice(0, 3).map(x => `${VS.empShort(x.e.id)} — ${x.n} дн`).join(', ') + (left.length > 3 ? ', …' : '');
        issues.push({ k: 'ОСТАТОК', t: `${left.length} ${VS.plural(left.length, ['сотрудник', 'сотрудника', 'сотрудников'])} с остатком`, d: list, ids: left.map(x => x.e.id) });
      }
    }
    data.employees.forEach(e => {
      const b = VS.balance(e.id);
      if (b.left < 0) issues.push({ k: 'ПРЕВЫШЕНИЕ', t: `${VS.empShort(e.id)}: превышение на ${-b.left} дн`, d: `Лимит ${b.total}, использовано ${b.used}, в плане ${b.plan}`, ids: [e.id] });
    });
    data.vacations.filter(VS.isActive).forEach(v => {
      data.blackouts.forEach(b => {
        if (v.start <= b.end && v.end >= b.start) issues.push({ k: 'ЗАПРЕТ', t: `${VS.empShort(v.employeeId)} в «${b.name}»`, d: `${VS.fmtRange(v.start, v.end)} пересекает ${VS.fmtRange(b.start, b.end)}`, ids: [v.employeeId], s: v.start });
      });
      if (data.checks.afterHolidays) {
        VS.afterHolidayPeriods(+v.start.slice(0, 4)).forEach(p => {
          if (v.start <= p.e && v.end >= p.s) issues.push({ k: 'ПОСЛЕ ПРАЗДНИКОВ', t: `${VS.empShort(v.employeeId)}: ${p.name}`, d: `${VS.fmtRange(v.start, v.end)} пересекает ${VS.fmtRange(p.s, p.e)}`, ids: [v.employeeId], s: v.start });
        });
      }
    });
    return issues;
  };

  // ================== CSV (логика импорта/экспорта прежняя) ==================
  function detectDelimiter(headerLine) {
    if (headerLine.includes(';')) return ';';
    if (headerLine.includes(',')) return ',';
    return ';';
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return { header: [], rows: [] };
    const delimiter = detectDelimiter(lines[0]);
    const header = lines[0].split(delimiter).map(h => h.trim());
    const rows = lines.slice(1).map(line => line.split(delimiter).map(c => c.trim()));
    return { header, rows };
  }

  function downloadCsv(filename, header, rows, delimiter = ';') {
    const esc = (val) => {
      if (val == null) return '';
      const s = String(val);
      if (s.includes(delimiter) || s.includes('"')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const text = [header, ...rows].map(row => row.map(esc).join(delimiter)).join('\r\n');
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  VS.exportEmployeesCsv = () => downloadCsv('employees_export.csv', ['name', 'totalVacationDays'], data.employees.map(e => [e.name, String(e.totalVacationDays)]));
  VS.exportVacationsCsv = () => downloadCsv('vacations_export.csv', ['employeeName', 'start', 'end', 'status'], data.vacations.map(v => [v.name, v.start, v.end, v.status]));
  // Праздники — через запятую, как templates/holidays.csv
  VS.exportHolidaysCsv = year => {
    const map = VS.holidayMap(year);
    const rows = Object.keys(map).sort((a, b) => (map[a] === map[b] ? (a < b ? -1 : 1) : map[a] === 'holiday' ? -1 : 1)).map(d => [d, map[d]]);
    downloadCsv(`holidays_${year}.csv`, ['date', 'type'], rows, ',');
  };

  const readFile = (file, cb) => { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsText(file, 'utf-8'); };

  // cb(message) — вызывается после успешного импорта
  VS.importEmployeesCsv = (file, cb) => readFile(file, text => {
    const { header, rows } = parseCsv(text);
    const idxName = header.findIndex(h => h.toLowerCase() === 'name');
    const idxTotal = header.findIndex(h => h.toLowerCase() === 'totalvacationdays');
    if (idxName === -1 || idxTotal === -1) { cb('В файле сотрудников должны быть колонки name,totalVacationDays', true); return; }
    if (!confirm('Импорт сотрудников перезапишет сотрудников, отпуска, группы и несовместимые пары. Продолжить?')) return;
    const employees = [];
    rows.forEach((cells, i) => {
      const name = cells[idxName];
      const total = Number(cells[idxTotal] || 0);
      if (!name || !total) return;
      employees.push({ id: Date.now() + i, name, totalVacationDays: total, usedVacationDays: 0 });
    });
    data.employees = employees;
    data.vacations = [];
    data.groups = [];
    data.pairs = [];
    cb('Список сотрудников импортирован, отпуска и правила очищены');
  });

  VS.importVacationsCsv = (file, cb) => readFile(file, text => {
    const { header, rows } = parseCsv(text);
    const idx = k => header.findIndex(h => h.toLowerCase() === k);
    const idxName = idx('employeename'), idxStart = idx('start'), idxEnd = idx('end'), idxStatus = idx('status');
    if (idxName === -1 || idxStart === -1 || idxEnd === -1) { cb('В файле отпусков должны быть колонки employeeName,start,end,status', true); return; }
    if (!confirm('Импорт отпусков перезапишет все текущие отпуска. Продолжить?')) return;
    const vacations = [];
    let skipped = 0;
    rows.forEach((cells, i) => {
      const name = cells[idxName], startIso = cells[idxStart], endIso = cells[idxEnd];
      // «Перенесён» → «Перенесен»: в данных статусы хранятся без «ё»
      const rawStatus = ((idxStatus !== -1 && cells[idxStatus]) || '').trim().replace(/ё/g, 'е').replace(/Ё/g, 'Е');
      const status = VS.ST_KEYS.some(k => ST[k].value === rawStatus) ? rawStatus : ST.P.value;
      if (!name || !startIso || !endIso) { skipped++; return; }
      const emp = data.employees.find(e => e.name === name);
      if (!emp) { skipped++; return; }
      const m = VS.calcVacationMetrics(startIso, endIso);
      if (!m) { skipped++; return; }
      vacations.push({ id: Date.now() + i, employeeId: emp.id, name: emp.name, start: startIso, end: endIso, days: m.vacationDays, workingDays: m.workingDays, status });
    });
    data.vacations = vacations;
    cb('Отпуска импортированы. Пропущено строк: ' + skipped);
  });

  VS.importHolidaysCsv = (file, cb) => readFile(file, text => {
    const byYear = splitByYear(parseHolidaysCsvText(text));
    const years = Object.keys(byYear);
    if (!years.length) { cb('В файле праздников должны быть строки date,type (holiday/preholiday)', true); return; }
    if (!confirm(`Импорт заменит производственный календарь на ${years.join(', ')} год. Продолжить?`)) return;
    years.forEach(y => { data.holidays[y] = byYear[y]; });
    cb('Праздники импортированы: ' + years.join(', '));
  });
})();
