// Таймлайн: «Месяц / Квартал» (сетка + панель-инспектор) и «Год» (список сотрудников + поповер).
(function() {
  'use strict';

  const VS = window.VS;
  const { data, derived, ui, esc, ST } = VS;
  const QUARTER_NAMES = ['I', 'II', 'III', 'IV'];

  // ================== ПЕРИОД ==================
  function period() {
    const isM = ui.zoom === 'month';
    const m0 = isM ? ui.month : Math.floor(ui.month / 3) * 3;
    const m1 = isM ? m0 + 1 : m0 + 3;
    const QS = VS.monthStartDoy(m0), QE = VS.monthStartDoy(m1) - 1;
    const QL = QE - QS + 1;
    return { isM, m0, m1, QS, QE, QL, pq: i => (i - QS) / QL * 100 };
  }

  VS.step = function(d) {
    if (ui.zoom === 'month') ui.month = Math.max(0, Math.min(11, ui.month + d));
    else ui.month = Math.max(0, Math.min(11, Math.floor(ui.month / 3) * 3 + d * 3));
    VS.render();
  };

  const todayDoy = () => { const t = VS.todayIso(); return t.startsWith(String(VS.YEAR)) ? VS.doy(t) : null; };
  const shown = v => ui.statusFilter[VS.statusKey(v.status)];
  const dayNum = i => +VS.isoOfDoy(i).slice(8, 10);

  // Дни конфликта сотрудника (для меток над строкой): [{s,e}] в индексах дней
  function conflictMarks(empId) {
    const out = [];
    derived.conflicts.forEach(c => {
      if (!c.ids.includes(empId)) return;
      if (c.type === 'pair') { out.push({ s: VS.doy(c.s), e: VS.doy(c.e) }); return; }
      // группа: пересечение серии с отпусками именно этого сотрудника
      data.vacations.filter(v => v.employeeId === empId && c.vacIds.includes(v.id)).forEach(v => {
        const s = v.start > c.s ? v.start : c.s, e = v.end < c.e ? v.end : c.e;
        if (s <= e) out.push({ s: VS.doy(s), e: VS.doy(e) });
      });
    });
    return out;
  }

  // Множество индексов рабочих дней с конфликтом
  function conflictDays() {
    const set = new Set();
    derived.conflicts.forEach(c => {
      for (let d = c.s; d <= c.e; d = VS.addDays(d, 1)) if (VS.isWorkingDay(d)) set.add(VS.doy(d));
    });
    return set;
  }

  // Квартальная занятость: доля человеко-дней отсутствия
  VS.quarterStats = function() {
    const active = data.vacations.filter(VS.isActive);
    const n = data.employees.length;
    return [0, 1, 2, 3].map(q => {
      const s = VS.monthStartDoy(q * 3), e = VS.monthStartDoy(q * 3 + 3) - 1;
      const sIso = VS.isoOfDoy(s), eIso = VS.isoOfDoy(e);
      const inQ = active.filter(v => v.start >= sIso && v.start <= eIso);
      let pd = 0;
      active.forEach(v => { const a = Math.max(VS.doy(v.start), s), b = Math.min(VS.doy(v.end), e); if (a <= b) pd += b - a + 1; });
      const pct = n ? pd / (n * (e - s + 1)) * 100 : 0;
      return { label: 'Q' + (q + 1), long: QUARTER_NAMES[q] + ' квартал', count: inQ.length, days: inQ.reduce((a, v) => a + VS.vacDays(v), 0), pct, pctLabel: pct.toFixed(1) + '%', bar: Math.min(100, pct * 5) };
    });
  };

  function chipsHtml() {
    return `<div class="chips">${VS.ST_KEYS.map(k => `<button type="button" class="chip ${ui.statusFilter[k] ? '' : 'off'}" data-act="chip" data-k="${k}"><span class="sw ${ST[k].cls}"></span>${ST[k].label}</button>`).join('')}</div>`;
  }
  function zoomHtml() {
    return `<div class="seg">${[['month', 'Месяц'], ['quarter', 'Квартал'], ['year', 'Год']].map(([k, l]) => `<button type="button" class="${ui.zoom === k ? 'on' : ''}" data-act="zoom" data-z="${k}">${l}</button>`).join('')}</div>`;
  }

  function emptyHtml() {
    return `<div class="tl-empty">
      <div>Сотрудников пока нет. Добавьте их вручную или импортируйте из CSV.</div>
      <div style="display:flex;gap:8px"><button type="button" class="btn btn-primary" data-act="emp-add">+ Сотрудник</button><button type="button" class="btn" data-act="csv" data-k="import-employees">Импорт сотрудников</button></div>
    </div>`;
  }

  // ================== 1a: МЕСЯЦ / КВАРТАЛ ==================
  function renderA() {
    const P = period();
    const { QS, QE, QL, pq, isM, m0 } = P;
    const td = todayDoy();
    const label = isM ? `${VS.MONTHS[m0]} ${VS.YEAR}` : `${QUARTER_NAMES[m0 / 3]} квартал ${VS.YEAR}`;

    // шапка дат
    let ticks = '', months = '', stripes = '';
    for (let i = QS; i <= QE; i++) {
      const iso = VS.isoOfDoy(i), wd = VS.weekdayMon(iso);
      const hol = VS.isHoliday(iso), we = wd >= 5, pre = VS.isPreHoliday(iso), isT = i === td;
      const L = pq(i), W = 100 / QL;
      if (isM) {
        const cls = isT ? 'today' : hol ? 'hol' : we ? 'we' : '';
        ticks += `<div class="tick-m ${cls}" style="left:${L}%;width:${W}%">${dayNum(i)}<br>${VS.DOW[wd]}</div>`;
      } else if (wd === 6 || hol || isT) {
        ticks += `<div class="tick-q ${isT ? 'today' : hol ? 'hol' : ''}" style="left:${L}%;width:${W}%">${dayNum(i)}</div>`;
      }
      const bg = hol ? 'hol' : we ? 'we' : pre ? 'pre' : '';
      if (bg) stripes += `<div class="${bg}" style="left:${L}%;width:${W}%"></div>`;
    }
    if (!isM) {
      for (let m = m0; m < m0 + 3; m++) {
        const s = VS.monthStartDoy(m), e = VS.monthStartDoy(m + 1);
        months += `<div class="month-q" style="left:${pq(s)}%;width:${(e - s) / QL * 100}%">${VS.MONTHS[m]}</div>`;
      }
    }
    if (td != null && td >= QS && td <= QE) stripes += `<div class="today-line" style="left:${pq(td) + 50 / QL}%"></div>`;

    // загрузка по дням
    const counts = new Array(QL).fill(0);
    data.vacations.filter(VS.isActive).forEach(v => {
      const a = Math.max(VS.doy(v.start), QS), b = Math.min(VS.doy(v.end), QE);
      for (let i = a; i <= b; i++) counts[i - QS]++;
    });
    const cdays = conflictDays();
    const load = counts.map((n, k) => {
      const i = QS + k;
      const cls = cdays.has(i) ? 'c' : n ? 'n' : '';
      return `<div class="${cls}" style="height:${Math.max(1, n * 6)}px" title="${VS.fmtDay(VS.isoOfDoy(i))}: ${n}"></div>`;
    }).join('');

    // строки
    const draft = ui.draft;
    const emps = VS.visibleEmployees();
    const rows = emps.map(emp => {
      const b = VS.balance(emp.id);
      const bars = data.vacations.filter(v => v.employeeId === emp.id && shown(v) && VS.doy(v.end) >= QS && VS.doy(v.start) <= QE).map(v => {
        const vs = VS.doy(v.start), ve = VS.doy(v.end);
        const s = Math.max(vs, QS), e = Math.min(ve, QE), w = (e - s + 1) / QL * 100;
        const k = VS.statusKey(v.status);
        const edit = draft && draft.vacId === v.id;
        return `<div class="bar ${ST[k].cls} ${edit ? 'active-edit' : ''}" data-vac="${v.id}" style="left:${pq(s)}%;width:${w}%" title="${esc(emp.name)} · ${VS.fmtRange(v.start, v.end)} · ${ST[k].label} · ${VS.vacDays(v)} дн">`
          + (vs >= QS ? '<span class="h h-l"></span>' : '') + (w > 6 ? `${dayNum(s)}–${dayNum(e)}` : '') + (ve <= QE ? '<span class="h h-r"></span>' : '') + '</div>';
      }).join('');
      const marks = conflictMarks(emp.id).filter(m => m.e >= QS && m.s <= QE).map(m => {
        const s = Math.max(m.s, QS), e = Math.min(m.e, QE);
        return `<div class="cmark" style="left:${pq(s)}%;width:${(e - s + 1) / QL * 100}%"></div>`;
      }).join('');
      const isSelRow = draft && draft.empId === emp.id;
      return `<div class="tl-r ${isSelRow ? 'sel' : ''} ${ui.flashEmp === emp.id ? 'flash' : ''}" data-row-emp="${emp.id}">
        <div class="tl-name"><a data-act="open-emp" data-id="${emp.id}" title="${esc(emp.name)}">${esc(emp.name)}</a><span class="tl-left ${b.left <= 0 ? 'neg' : ''}">${b.left} дн</span></div>
        <div class="tl-track" data-emp="${emp.id}">${bars}${selBoxHtml(emp.id, P)}${marks}</div>
      </div>`;
    }).join('');

    const body = !data.employees.length ? emptyHtml()
      : !emps.length ? `<div class="tl-empty">Никто не найден по запросу «${esc(ui.search)}»</div>`
      : `<div class="tl-stripes">${stripes}</div>${rows}`;

    return `<div class="tl-a">
      <div class="tl-main">
        <div class="tl-toolbar">
          <div class="period">
            <button type="button" class="btn-icon" data-act="step" data-d="-1" aria-label="Назад">‹</button>
            <span class="period-label">${label}</span>
            <button type="button" class="btn-icon" data-act="step" data-d="1" aria-label="Вперёд">›</button>
          </div>
          ${zoomHtml()}
          <div class="spacer"></div>
          ${chipsHtml()}
        </div>
        <div class="tl-scroll" data-keep-scroll="tl">
          <div class="tl-head">
            <div class="tl-row2 tl-dates">
              <div class="tl-dates-left"><span>Сотрудник</span><span>Остаток</span></div>
              <div class="tl-dates-right">${months}${ticks}</div>
            </div>
            <div class="tl-row2 tl-load">
              <div class="tl-load-left">Отсутствуют в день</div>
              <div class="tl-load-bars">${load}</div>
            </div>
          </div>
          <div class="tl-body" id="tl-body">${body}</div>
        </div>
      </div>
      ${panelHtml()}
    </div>`;
  }

  function selBoxHtml(empId, P) {
    const d = ui.draft;
    if (!d || d.empId !== empId || !d.start) return '';
    if (d.vacId != null) {
      const v = data.vacations.find(x => x.id === d.vacId);
      if (v && v.start === d.start && v.end === d.end) return '';
    }
    const end = d.phase === 'end' ? d.start : d.end;
    let s = VS.doy(d.start), e = VS.doy(end);
    if (e < P.QS || s > P.QE) return '';
    s = Math.max(s, P.QS); e = Math.min(e, P.QE);
    const label = d.phase === 'done' ? `${dayNum(s)}–${dayNum(e)}` : '';
    return `<div class="selbox" style="left:${P.pq(s)}%;width:${(e - s + 1) / P.QL * 100}%">${label}</div>`;
  }

  // ================== ПАНЕЛЬ ==================
  function panelHtml() {
    const nConf = derived.conflicts.length;
    const tabs = [['vac', 'Отпуск'], ['conf', 'Конфликты · ' + nConf], ['sum', 'Сводка']]
      .map(([k, l]) => `<button type="button" class="${ui.panelTab === k ? 'on' : ''}" data-act="ptab" data-k="${k}">${l}</button>`).join('');
    const body = ui.panelTab === 'conf' ? confTabHtml() : ui.panelTab === 'sum' ? sumTabHtml() : vacTabHtml();
    return `<aside class="panel"><div class="ptabs">${tabs}</div>${body}</aside>`;
  }

  const emptyDraft = () => ({ empId: null, start: null, end: null, status: 'P', vacId: null, phase: 'end' });

  function vacTabHtml() {
    const d = ui.draft || emptyDraft();
    const m = VS.draftMetrics(d);
    const emp = d.empId != null ? VS.emp(d.empId) : null;
    const hint = !d.start ? 'Кликните по строке сотрудника: день начала, затем окончания. Можно протянуть мышью.'
      : d.phase === 'end' ? 'Теперь кликните по дню окончания в той же строке'
      : d.vacId != null ? 'Края полосы на таймлайне можно перетаскивать' : 'Проверьте расчёт и сохраните отпуск';
    const opts = `<option value="">— выберите сотрудника —</option>` + data.employees.map(e => `<option value="${e.id}" ${d.empId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
    const pc = n => m.total ? Math.max(0, n / m.total * 100) : 0;
    const counts = d.status === 'P' || d.status === 'U';
    const balance = emp ? `<div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-2)"><span>Баланс на ${VS.YEAR}</span><span class="mono">${m.total} дн</span></div>
        <div class="balbar"><div class="u" style="width:${pc(m.used)}%"></div><div class="p" style="width:${pc(m.plan)}%"></div><div class="t ${m.after < 0 ? 'over' : ''}" style="width:${counts ? Math.min(pc(m.vac), 100) : 0}%"></div></div>
        <div class="balnums">
          <div><b>${m.used}</b>использовано</div><div><b>${m.plan}</b>в плане</div><div><b>${counts ? m.vac : 0}</b>этот отпуск</div><div><b class="${m.after < 0 ? 'neg' : ''}">${m.after}</b>останется</div>
        </div>
      </div>` : '';
    const warns = VS.vacationWarnings(d);
    if (emp && counts && m.after < 0) warns.push({ title: `Превышение баланса на ${-m.after} дн`, text: 'Сократите период или увеличьте лимит сотрудника.' });
    const warnHtml = warns.map(w => `<div class="warn"><div class="warn-title">${esc(w.title)}</div><div class="warn-text">${esc(w.text)}</div></div>`).join('');
    const statuses = VS.ST_KEYS.map(k => `<button type="button" class="${d.status === k ? 'on' : ''}" data-act="f-status" data-k="${k}">${ST[k].short}</button>`).join('');
    return `<div class="pbody">
      <div style="display:flex;flex-direction:column;gap:4px"><div class="ptitle">${d.vacId != null ? 'Отпуск' : 'Новый отпуск'}</div><div class="phint">${hint}</div></div>
      <label class="field"><span class="field-label">Сотрудник</span><select class="input" id="f-emp" data-change="f-emp">${opts}</select></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label class="field"><span class="field-label">С</span><input class="input mono" id="f-from" data-change="f-date" data-w="from" placeholder="ДД.ММ.ГГГГ" value="${d.start ? VS.fmtNum(d.start) : ''}"></label>
        <label class="field"><span class="field-label">По</span><input class="input mono" id="f-to" data-change="f-date" data-w="to" placeholder="${d.phase === 'end' && d.start ? '—' : 'ДД.ММ.ГГГГ'}" value="${d.end && d.phase === 'done' ? VS.fmtNum(d.end) : ''}"></label>
      </div>
      <div style="display:flex;gap:6px">${[7, 14, 21].map(n => `<button type="button" class="btn btn-sm" data-act="quick" data-n="${n}">+ ${n / 7} нед.</button>`).join('')}</div>
      <div class="card calc">
        <div><span>Календарных дней</span><span>${m.cal}</span></div>
        <div><span>Праздники (не считаются)</span><span>−${m.hol}</span></div>
        <div><span>Отпускных дней</span><span>${m.vac}</span></div>
      </div>
      ${balance}
      ${warnHtml}
      <div class="field"><span class="field-label">Статус</span><div class="seg-status">${statuses}</div></div>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn btn-primary btn-lg" style="flex:1;justify-content:center" data-act="f-save">Сохранить отпуск</button>
        <button type="button" class="btn btn-strong btn-lg" data-act="f-cancel">Отмена</button>
      </div>
      ${d.vacId != null ? '<button type="button" class="btn-dashed" style="color:var(--err-text)" data-act="f-delete">Удалить отпуск</button>' : ''}
    </div>`;
  }

  function confTabHtml() {
    const list = derived.conflicts.map((c, i) => `<div class="conf-card">
        <div class="names">${esc(VS.conflictTitle(c))}</div>
        <div class="row"><span class="period-txt">${VS.fmtRange(c.s, c.e)}</span><a data-act="show-conf" data-i="${i}">Показать</a></div>
      </div>`).join('') || '<div class="empty-note">Конфликтов нет</div>';
    const pairs = data.pairs.map(([a, b]) => `<div class="list-row"><span>${esc(VS.empShort(a))} ↔ ${esc(VS.empShort(b))}</span><button type="button" class="btn-x" data-act="pair-del" data-a="${a}" data-b="${b}" title="Удалить пару">×</button></div>`).join('') || '<div class="empty-note">Пар пока нет</div>';
    return `<div class="pbody tight">
      <div class="ptitle">Конфликты</div>
      <div class="phint">Пересечения отпусков в несовместимых парах и превышение лимитов групп.${data.checks.workdaysOnly ? ' Выходные не учитываются.' : ''}</div>
      ${list}
      <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:8px">
        <div class="section-title">Несовместимые пары</div>
        ${pairs}
        <button type="button" class="btn-dashed" data-act="pair-add">+ Добавить пару</button>
        <a data-act="go-rules" style="font-size:12px">Все правила →</a>
      </div>
    </div>`;
  }

  function sumTabHtml() {
    const total = data.employees.reduce((a, e) => a + e.totalVacationDays, 0);
    let used = 0, plan = 0;
    data.employees.forEach(e => { const b = VS.balance(e.id); used += b.used; plan += b.plan; });
    const kpis = [[used, 'дней использовано'], [plan, 'дней в плане'], [total - used - plan, 'не распределено'], [(total ? Math.round(used / total * 100) : 0) + '%', 'использование']];
    const qs = VS.quarterStats().map(q => `<div class="qrow"><span class="mono muted">${q.label}</span><div class="qbar"><div style="width:${q.bar}%"></div></div><span class="mono" style="text-align:right">${q.pctLabel}</span></div>`).join('');
    return `<div class="pbody" style="gap:16px">
      <div class="ptitle">Сводка ${VS.YEAR}</div>
      <div class="kpis">${kpis.map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
      <div style="display:flex;flex-direction:column;gap:10px"><div class="section-title">Занятость по кварталам</div>${qs}</div>
      <a data-act="report" style="font-size:13px">Полный отчёт по сотрудникам →</a>
    </div>`;
  }

  // ================== 1b: ГОД ==================
  function renderB() {
    const YD = VS.YEAR_DAYS, py = i => i / YD * 100;
    const td = todayDoy();
    const emps = VS.visibleEmployees();
    const sorted = ui.yearSort === 'used'
      ? [...emps].sort((a, b) => { const x = VS.balance(a.id), y = VS.balance(b.id); return (y.used / (y.total || 1)) - (x.used / (x.total || 1)); })
      : emps;

    const list = sorted.map(e => {
      const b = VS.balance(e.id), t = b.total || 1;
      return `<div class="emp-item ${ui.yearSelEmp === e.id ? 'on' : ''}" data-act="yr-sel" data-id="${e.id}">
        <div class="top"><span>${esc(e.name)}</span><span>${b.used} / ${b.total}</span></div>
        <div class="minibar"><div class="u" style="width:${Math.min(100, b.used / t * 100)}%"></div><div class="p" style="width:${Math.min(100, b.plan / t * 100)}%"></div></div>
      </div>`;
    }).join('');

    // загрузка по неделям: число уникальных отсутствующих
    const active = data.vacations.filter(VS.isActive);
    const weeks = []; let wmax = 0;
    for (let w = 0; w * 7 < YD; w++) {
      const s = VS.isoOfDoy(w * 7), e = VS.isoOfDoy(Math.min(YD - 1, w * 7 + 6));
      const n = new Set(active.filter(v => v.start <= e && v.end >= s).map(v => v.employeeId)).size;
      wmax = Math.max(wmax, n);
      weeks.push({ n, s, e, past: td != null && w * 7 + 6 < td });
    }
    const weeksHtml = weeks.map(w => `<div class="${w.n >= 4 ? 'c' : w.n ? 'n' : ''} ${w.past ? 'past' : ''}" style="height:${Math.max(2, wmax ? w.n / wmax * 44 : 2)}px" title="${VS.fmtRange(w.s, w.e)}: ${w.n}"></div>`).join('');

    const curM = td != null ? +VS.isoOfDoy(td).slice(5, 7) - 1 : -1;
    const months = VS.MONTHS_SHORT.map((l, k) => {
      const s = VS.monthStartDoy(k), e = VS.monthStartDoy(k + 1);
      return `<div class="${k === curM ? 'cur' : ''}" style="left:${py(s)}%;width:${(e - s) / YD * 100}%">${l}</div>`;
    }).join('');
    const lines = VS.MONTHS_SHORT.slice(1).map((_, k) => `<div style="left:${py(VS.monthStartDoy(k + 1))}%"></div>`).join('')
      + (td != null ? `<div class="today-line" style="left:${py(td)}%"></div>` : '');

    const rows = emps.map(emp => {
      const bars = data.vacations.filter(v => v.employeeId === emp.id && shown(v) && VS.doy(v.end) >= 0 && VS.doy(v.start) < YD).map(v => {
        const s = Math.max(0, VS.doy(v.start)), e = Math.min(YD - 1, VS.doy(v.end));
        const k = VS.statusKey(v.status);
        return `<div class="ybar ${ST[k].cls} ${ui.popVacId === v.id ? 'on' : ''}" data-act="yr-bar" data-id="${v.id}" style="left:${py(s)}%;width:${(e - s + 1) / YD * 100}%" title="${VS.fmtRange(v.start, v.end)} · ${ST[k].label}"></div>`;
      }).join('');
      const marks = conflictMarks(emp.id).filter(m => m.e >= 0 && m.s < YD).map(m => {
        const s = Math.max(0, m.s), e = Math.min(YD - 1, m.e);
        return `<div class="cmark" style="left:${py(s)}%;width:${(e - s + 1) / YD * 100}%"></div>`;
      }).join('');
      return `<div class="yr-r ${ui.yearSelEmp === emp.id ? 'on' : ''}" data-row-emp="${emp.id}">
        <div class="yr-name"><a data-act="open-emp" data-id="${emp.id}" title="${esc(emp.name)}">${esc(emp.name)}</a></div>
        <div class="yr-track" data-act="yr-track" data-emp="${emp.id}">${bars}${marks}</div>
      </div>`;
    }).join('');

    const qs = VS.quarterStats().map(q => `<div class="card yr-q">
        <div class="top"><b>${q.long}</b><span>${q.pctLabel}</span></div>
        <div class="qbar"><div style="width:${q.bar}%"></div></div>
        <div class="bot"><span><b>${q.count}</b> отп.</span><span><b>${q.days}</b> дн.</span></div>
      </div>`).join('');
    const confs = derived.conflicts.map((c, i) => `<div class="row" data-act="show-conf" data-i="${i}"><span>${esc(VS.conflictTitle(c))}</span><span>${VS.fmtRange(c.s, c.e)}</span></div>`).join('') || '<div class="empty-note">Конфликтов нет</div>';

    const sortLabel = ui.yearSort === 'used' ? 'исп. / всего ▾' : 'по имени ▾';
    return `<div class="tl-b">
      <aside class="emp-aside">
        <div class="emp-aside-top">
          <input type="search" class="search" id="yr-search" data-input="search" placeholder="Найти сотрудника…" value="${esc(ui.search)}" autocomplete="off">
          <div class="emp-aside-head"><b>Сотрудники</b><button type="button" data-act="yr-sort" title="Сортировка: по имени или по доле использованных дней">${sortLabel}</button></div>
        </div>
        <div class="emp-list" data-keep-scroll="yr-list">${list}<button type="button" class="btn-dashed" data-act="emp-add">+ Сотрудник</button></div>
        <div class="data-block">
          <div class="section-title" style="font-size:12px">Данные</div>
          <div class="btns">
            <button type="button" class="btn btn-xs" data-act="open-menu">Импорт CSV</button>
            <button type="button" class="btn btn-xs" data-act="export-all">Экспорт</button>
            <button type="button" class="btn btn-xs" data-act="open-menu">Шаблоны</button>
          </div>
          <div style="font-size:11px;color:var(--text-3)">Хранится в этом браузере</div>
        </div>
      </aside>
      <div class="yr-main" data-keep-scroll="yr-main">
        <div class="yr-head"><div class="y">${VS.YEAR}</div>${zoomHtml()}<div class="spacer"></div>${chipsHtml()}</div>
        ${!data.employees.length ? `<div class="card">${emptyHtml()}</div>` : `<div class="card yr-card">
          <div class="yr-g yr-load">
            <div class="yr-load-left"><span>Отсутствуют</span><span>по неделям, макс. ${wmax}</span></div>
            <div class="yr-load-bars">${weeksHtml}</div>
          </div>
          <div class="yr-g yr-months"><div></div><div class="yr-months-track">${months}</div></div>
          <div class="yr-rows" id="yr-rows">
            <div class="yr-lines">${lines}</div>
            ${rows || `<div class="tl-empty">Никто не найден по запросу «${esc(ui.search)}»</div>`}
            ${popoverHtml(emps)}
          </div>
        </div>`}
        <div class="yr-bottom">${qs}<div class="card yr-conf"><div class="section-title" style="font-size:12px">Конфликты <span class="mono err">${derived.conflicts.length}</span></div>${confs}</div></div>
      </div>
    </div>`;
  }

  function popoverHtml(emps) {
    if (ui.popVacId == null) return '';
    const v = data.vacations.find(x => x.id === ui.popVacId);
    const idx = v ? emps.findIndex(e => e.id === v.employeeId) : -1;
    if (!v || idx < 0) { ui.popVacId = null; return ''; }
    const pd = ui.popDraft;
    const d = { empId: v.employeeId, start: pd.start, end: pd.end, status: pd.status, vacId: v.id };
    const m = VS.draftMetrics(d);
    const left = VS.balance(v.employeeId).left;
    const warns = VS.vacationWarnings(d);
    if ((pd.status === 'P' || pd.status === 'U') && m.after < 0) warns.push({ title: `Превышение баланса на ${-m.after} дн` });
    const leftPct = Math.min(Math.max(0, VS.doy(pd.start)) / VS.YEAR_DAYS * 100, 66);
    const statuses = VS.ST_KEYS.map(k => `<button type="button" class="${pd.status === k ? 'on' : ''}" data-act="p-status" data-k="${k}">${ST[k].short}</button>`).join('');
    return `<div class="popover" style="top:${(idx + 1) * 30 + 6}px;left:calc(180px + (100% - 180px) * ${leftPct / 100} - 40px)">
      <div class="pop-head"><div><b>${esc(VS.emp(v.employeeId).name)}</b><span>${VS.fmtRange(pd.start, pd.end)}</span></div><button type="button" class="btn-x" data-act="p-close" aria-label="Закрыть">×</button></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <input class="input input-sm mono" id="p-from" data-change="p-date" data-w="from" value="${VS.fmtNum(pd.start)}" aria-label="С">
        <input class="input input-sm mono" id="p-to" data-change="p-date" data-w="to" value="${VS.fmtNum(pd.end)}" aria-label="По">
      </div>
      <div class="seg-status sm">${statuses}</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-2)"><span>${m.vac} отпускных дн.</span><span>остаток ${left} дн</span></div>
      ${warns.map(w => `<div class="pop-warn">${esc(w.title)}${w.text ? ' · ' + esc(w.text) : ''}</div>`).join('')}
      <div style="display:flex;gap:6px">
        <button type="button" class="btn btn-primary" style="flex:1;justify-content:center" data-act="p-save">Сохранить</button>
        <button type="button" class="btn btn-danger-text" data-act="p-delete">Удалить</button>
      </div>
    </div>`;
  }

  // ================== ДЕЙСТВИЯ ==================
  const ensureDraft = () => (ui.draft = ui.draft || emptyDraft());

  // Если дата вне текущего периода — перелистываем к ней
  function revealIso(iso) {
    if (!iso || !iso.startsWith(String(VS.YEAR)) || ui.zoom === 'year') return;
    const P = period(), i = VS.doy(iso);
    if (i < P.QS || i > P.QE) ui.month = +iso.slice(5, 7) - 1;
  }

  Object.assign(VS.act, {
    'step': el => VS.step(Number(el.dataset.d)),
    'zoom': el => { ui.zoom = el.dataset.z; ui.popVacId = null; VS.render(); },
    'chip': el => { const k = el.dataset.k; ui.statusFilter[k] = ui.statusFilter[k] ? 0 : 1; VS.render(); },
    'ptab': el => { ui.panelTab = el.dataset.k; VS.render(); },
    'open-emp': el => VS.go('employee', { employeeId: Number(el.dataset.id) }),
    'emp-add': () => VS.employeeModal(null),
    'csv': el => VS.csvAction(el.dataset.k),
    'search': el => { ui.search = el.value; VS.render(); },
    'report': () => VS.reportModal(),
    'go-rules': () => VS.go('rules'),
    'pair-add': () => VS.pairModal(null),
    'pair-del': el => VS.removePair(Number(el.dataset.a), Number(el.dataset.b)),
    'show-conf': el => {
      const c = derived.conflicts[Number(el.dataset.i)];
      if (c) VS.showOnTimeline(c.s, c.ids[0]);
    },
    'open-menu': () => { document.getElementById('data-menu').classList.remove('hidden'); },
    'export-all': () => { VS.exportEmployeesCsv(); setTimeout(VS.exportVacationsCsv, 300); },

    // форма в панели
    'f-emp': el => { const d = ensureDraft(); d.empId = el.value ? Number(el.value) : null; VS.render(); },
    'f-date': el => {
      const d = ensureDraft();
      const raw = el.value.trim();
      if (!raw) {
        if (el.dataset.w === 'from') { d.start = null; d.end = null; d.phase = 'end'; } else if (d.start) { d.end = d.start; d.phase = 'end'; }
        VS.render(); return;
      }
      const iso = VS.parseHuman(raw);
      if (!iso) { VS.toast('Дата в формате ДД.ММ.ГГГГ', true); VS.render(); return; }
      if (el.dataset.w === 'from') {
        d.start = iso;
        if (d.phase === 'done' && d.end) { if (d.end < iso) d.end = iso; } else d.end = iso;
      } else {
        if (!d.start) d.start = iso;
        d.end = iso;
        if (d.end < d.start) { const t = d.start; d.start = d.end; d.end = t; }
        d.phase = 'done';
      }
      revealIso(d.start);
      VS.render();
    },
    'quick': el => {
      const d = ensureDraft();
      if (!d.start) { VS.toast('Сначала выберите дату начала', true); return; }
      d.end = VS.addDays(d.start, Number(el.dataset.n) - 1);
      d.phase = 'done';
      VS.render();
    },
    'f-status': el => { ensureDraft().status = el.dataset.k; VS.render(); },
    'f-cancel': () => { ui.draft = null; VS.render(); },
    'f-delete': () => { if (ui.draft && ui.draft.vacId != null) VS.deleteVacation(ui.draft.vacId); },
    'f-save': () => saveDraft(ui.draft) && (ui.draft = null, VS.commit(ui._saveMsg)),

    // режим «Год»
    'yr-sel': el => { const id = Number(el.dataset.id); ui.yearSelEmp = ui.yearSelEmp === id ? null : id; VS.render(); },
    'yr-sort': () => { ui.yearSort = ui.yearSort === 'used' ? 'name' : 'used'; VS.render(); },
    'yr-bar': el => {
      const v = data.vacations.find(x => x.id === Number(el.dataset.id));
      if (!v) return;
      ui.popVacId = v.id; ui.yearSelEmp = v.employeeId;
      ui.popDraft = { start: v.start, end: v.end, status: VS.statusKey(v.status) };
      VS.render();
    },
    'yr-track': (el, e) => {
      // клик по пустому месту года — переходим в месяц и начинаем выделение с этого дня
      const r = el.getBoundingClientRect();
      const i = Math.max(0, Math.min(VS.YEAR_DAYS - 1, Math.floor((e.clientX - r.left) / r.width * VS.YEAR_DAYS)));
      const iso = VS.isoOfDoy(i);
      ui.zoom = 'month'; ui.month = +iso.slice(5, 7) - 1; ui.panelTab = 'vac'; ui.popVacId = null;
      ui.draft = { empId: Number(el.dataset.emp), start: iso, end: iso, status: 'P', vacId: null, phase: 'end' };
      VS.render();
    },
    'p-close': () => { ui.popVacId = null; VS.render(); },
    'p-status': el => { ui.popDraft.status = el.dataset.k; VS.render(); },
    'p-date': el => {
      const iso = VS.parseHuman(el.value);
      if (!iso) { VS.toast('Дата в формате ДД.ММ.ГГГГ', true); VS.render(); return; }
      const pd = ui.popDraft;
      if (el.dataset.w === 'from') pd.start = iso; else pd.end = iso;
      if (pd.end < pd.start) { const t = pd.start; pd.start = pd.end; pd.end = t; }
      VS.render();
    },
    'p-save': () => {
      const v = data.vacations.find(x => x.id === ui.popVacId);
      if (!v) return;
      const pd = ui.popDraft;
      if (saveDraft({ empId: v.employeeId, start: pd.start, end: pd.end, status: pd.status, vacId: v.id, phase: 'done' })) { ui.popVacId = null; VS.commit(ui._saveMsg); }
    },
    'p-delete': () => { if (ui.popVacId != null) VS.deleteVacation(ui.popVacId); }
  });

  // Проверка и сохранение черновика. true — данные изменены, нужен commit
  function saveDraft(d) {
    if (!d || d.empId == null || !VS.emp(d.empId)) { VS.toast('Выберите сотрудника', true); return false; }
    if (!d.start) { VS.toast('Выберите дату начала', true); return false; }
    if (d.phase === 'end') { VS.toast('Укажите дату окончания', true); return false; }
    // даты отпуска — только в пределах рабочего года (из PR #2)
    if (!d.start.startsWith(String(VS.YEAR)) || !d.end.startsWith(String(VS.YEAR))) { VS.toast(`Даты должны быть в пределах ${VS.YEAR} года`, true); return false; }
    const metrics = VS.calcVacationMetrics(d.start, d.end);
    if (!metrics) { VS.toast('Неверный диапазон дат', true); return false; }
    const m = VS.draftMetrics(d);
    if ((d.status === 'P' || d.status === 'U') && m.after < 0
      && !confirm(`Превышение баланса на ${-m.after} дн (лимит ${m.total}). Всё равно сохранить?`)) return false;
    const emp = VS.emp(d.empId);
    const fields = { employeeId: emp.id, name: emp.name, start: d.start, end: d.end, days: metrics.vacationDays, workingDays: metrics.workingDays, status: ST[d.status].value };
    const ex = d.vacId != null ? data.vacations.find(v => v.id === d.vacId) : null;
    if (ex) { Object.assign(ex, fields); ui._saveMsg = 'Отпуск обновлён'; }
    else { data.vacations.push({ id: VS.newId(), ...fields }); ui._saveMsg = 'Отпуск создан'; }
    return true;
  }

  // ================== МЫШЬ: выделение, перетаскивание краёв ==================
  let drag = null;

  function dayAt(x) {
    const r = drag.rect;
    return drag.QS + Math.max(0, Math.min(drag.QL - 1, Math.floor((x - r.left) / r.width * drag.QL)));
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    const track = e.target.closest('.tl-track');
    if (!track) return;
    e.preventDefault();
    const P = period();
    const handle = e.target.closest('.h'), bar = e.target.closest('.bar');
    drag = { track, rect: track.getBoundingClientRect(), QS: P.QS, QL: P.QL, pq: P.pq, empId: Number(track.dataset.emp), moved: false };
    if (bar) {
      const v = data.vacations.find(x => x.id === Number(bar.dataset.vac));
      Object.assign(drag, { mode: handle ? 'resize' : 'bar', vac: v, bar, edge: handle && handle.classList.contains('h-l') ? 'l' : 'r', s: VS.doy(v.start), e: VS.doy(v.end) });
    } else {
      drag.mode = 'sel';
      drag.anchor = dayAt(e.clientX);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!drag) return;
    const d = dayAt(e.clientX);
    if (drag.mode === 'sel') {
      if (d === drag.anchor && !drag.moved) return;
      drag.moved = true;
      const prev = ui.draft && ui.draft.vacId == null ? ui.draft.status : 'P';
      ui.draft = { empId: drag.empId, start: VS.isoOfDoy(Math.min(d, drag.anchor)), end: VS.isoOfDoy(Math.max(d, drag.anchor)), status: prev, vacId: null, phase: 'done' };
      // перерисовываем только рамку выделения
      document.querySelectorAll('#tl-body .selbox').forEach(n => n.remove());
      drag.track.insertAdjacentHTML('beforeend', selBoxHtml(drag.empId, period()));
    } else if (drag.mode === 'resize') {
      const vs = VS.doy(drag.vac.start), ve = VS.doy(drag.vac.end);
      const s = drag.edge === 'l' ? Math.min(d, ve) : vs;
      const en = drag.edge === 'r' ? Math.max(d, vs) : ve;
      if (s === drag.s && en === drag.e) return;
      drag.s = s; drag.e = en; drag.moved = true;
      const cs = Math.max(s, drag.QS), ce = Math.min(en, drag.QS + drag.QL - 1);
      drag.bar.style.left = drag.pq(cs) + '%';
      drag.bar.style.width = (ce - cs + 1) / drag.QL * 100 + '%';
      const txt = [...drag.bar.childNodes].find(n => n.nodeType === 3);
      const label = `${dayNum(cs)}–${dayNum(ce)}`;
      if (txt) txt.textContent = label;
    }
  }

  function onMouseUp(e) {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    const g = drag; drag = null;
    if (!g) return;
    ui.panelTab = 'vac';
    if (g.mode === 'sel') {
      if (!g.moved) {
        const d = ui.draft, day = VS.isoOfDoy(g.anchor);
        if (d && d.vacId == null && d.empId === g.empId && d.phase === 'end' && d.start) {
          if (day < d.start) { d.end = d.start; d.start = day; } else d.end = day;
          d.phase = 'done';
        } else {
          ui.draft = { empId: g.empId, start: day, end: day, status: d && d.vacId == null ? d.status : 'P', vacId: null, phase: 'end' };
        }
      }
      VS.render();
    } else if (g.mode === 'resize' && g.moved) {
      const v = g.vac;
      v.start = VS.isoOfDoy(g.s); v.end = VS.isoOfDoy(g.e);
      if (ui.draft && ui.draft.vacId === v.id) { ui.draft.start = v.start; ui.draft.end = v.end; }
      VS.commit(`Даты изменены: ${VS.fmtRange(v.start, v.end)}`);
    } else {
      // клик по полосе — открыть в панели
      const v = g.vac;
      ui.draft = { empId: v.employeeId, start: v.start, end: v.end, status: VS.statusKey(v.status), vacId: v.id, phase: 'done' };
      VS.render();
    }
  }

  // Закрытие поповера кликом вне его
  document.addEventListener('click', e => {
    if (ui.view !== 'timeline' || ui.zoom !== 'year' || ui.popVacId == null) return;
    if (!document.body.contains(e.target)) return; // элемент уже перерисован другим обработчиком
    if (e.target.closest('.popover') || e.target.closest('.ybar') || e.target.closest('.modal-back')) return;
    ui.popVacId = null;
    VS.render();
  });

  VS.views.timeline = {
    render: () => ui.zoom === 'year' ? renderB() : renderA(),
    after: root => {
      const body = root.querySelector('#tl-body');
      if (body) body.addEventListener('mousedown', onMouseDown);
    }
  };
})();
