// Оболочка: состояние интерфейса, навигация, шапка, меню «Данные · CSV», модалки, тосты, горячие клавиши.
(function() {
  'use strict';

  const VS = window.VS;
  const { data, derived, esc } = VS;
  const $ = (sel, root = document) => root.querySelector(sel);

  const today = VS.todayIso();
  const startMonth = +today.slice(0, 4) === VS.YEAR ? +today.slice(5, 7) - 1 : 0;

  // ================== СОСТОЯНИЕ ИНТЕРФЕЙСА ==================
  VS.ui = {
    view: 'timeline',           // 'timeline' | 'rules' | 'calendar' | 'employee'
    employeeId: null,
    zoom: 'month',              // 'month' | 'quarter' | 'year'
    month: startMonth,          // 0–11
    statusFilter: { P: 1, U: 1, R: 1, C: 1 },
    search: '',
    draft: null,                // {empId, start, end, status, vacId, phase: 'end'|'done'}
    panelTab: 'vac',            // 'vac' | 'conf' | 'sum'
    popVacId: null,             // поповер в режиме «Год»
    popDraft: null,             // {start, end, status}
    yearSelEmp: null,
    yearSort: 'name',           // 'name' | 'used'
    calYear: VS.YEAR,
    flashEmp: null
  };
  const ui = VS.ui;

  VS.views = {};   // name → { render(): html, after?(root) }
  VS.act = {};     // data-act="name" → fn(el, event)

  // ================== ТОСТ ==================
  VS.toast = function(message, isErr) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('err', !!isErr);
    el.classList.remove('hidden');
    clearTimeout(VS.toast._t);
    VS.toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
  };

  // ================== ОТРИСОВКА ==================
  VS.render = function() {
    const root = $('#view');
    // сохраняем фокус и позицию курсора в поле, чтобы перерисовка не мешала вводу
    const ae = document.activeElement;
    const focusId = ae && root.contains(ae) && ae.id ? ae.id : null;
    const caret = focusId && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
    const scrollers = {};
    root.querySelectorAll('[data-keep-scroll]').forEach(el => { scrollers[el.dataset.keepScroll] = [el.scrollTop, el.scrollLeft]; });

    const view = VS.views[ui.view] || VS.views.timeline;
    root.innerHTML = view.render();

    root.querySelectorAll('[data-keep-scroll]').forEach(el => {
      const s = scrollers[el.dataset.keepScroll];
      if (s) { el.scrollTop = s[0]; el.scrollLeft = s[1]; }
    });
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus(); if (caret) try { el.setSelectionRange(caret[0], caret[1]); } catch (e) { /* поле без выделения */ } }
    }
    // view мог смениться во время отрисовки (например, карточка удалённого сотрудника)
    const shown = VS.views[ui.view] || view;
    if (shown.after) shown.after(root);
    renderHeader();
  };

  function renderHeader() {
    document.querySelectorAll('#nav [data-nav]').forEach(b => {
      const v = ui.view === 'employee' ? 'timeline' : ui.view;
      b.classList.toggle('on', b.dataset.nav === v);
    });
    const onTl = ui.view === 'timeline';
    const c = derived.conflicts.length;
    $('#counters').innerHTML = onTl ? `
      <span>${data.employees.length} ${VS.plural(data.employees.length, ['сотрудник', 'сотрудника', 'сотрудников'])}</span>
      <span>${data.vacations.length} ${VS.plural(data.vacations.length, ['отпуск', 'отпуска', 'отпусков'])}</span>
      <span class="${c ? 'err' : ''}">${c} ${VS.plural(c, ['конфликт', 'конфликта', 'конфликтов'])}</span>` : '';
    // в режиме «Год» поиск есть в левой колонке — в шапке его не дублируем
    $('#emp-search').classList.toggle('hidden', !onTl || ui.zoom === 'year');
    const s = $('#emp-search');
    if (document.activeElement !== s && s.value !== ui.search) s.value = ui.search;
  }

  // Сохранить данные, пересчитать и перерисовать
  VS.commit = function(message) {
    VS.recalc();
    VS.save();
    VS.render();
    if (message) VS.toast(message);
  };

  VS.go = function(view, opts = {}) {
    ui.view = view;
    if (view === 'employee') ui.employeeId = opts.employeeId;
    ui.popVacId = null;
    VS.closeMenu();
    VS.render();
    $('#view').scrollTop = 0;
  };

  // Сотрудники с учётом поиска
  VS.visibleEmployees = function() {
    const q = ui.search.trim().toLowerCase();
    return data.employees.filter(e => !q || e.name.toLowerCase().includes(q));
  };

  // ================== НОВЫЙ ОТПУСК ==================
  VS.newVacation = function(empId) {
    ui.view = 'timeline';
    if (ui.zoom === 'year') ui.zoom = 'month';
    ui.popVacId = null;
    ui.panelTab = 'vac';
    ui.draft = { empId: empId != null ? empId : null, start: null, end: null, status: 'P', vacId: null, phase: 'end' };
    VS.render();
    if (empId == null) { const sel = $('#f-emp'); if (sel) sel.focus(); }
  };

  // Открыть существующий отпуск на таймлайне (месяц, панель справа)
  VS.openVacation = function(vacId) {
    const v = data.vacations.find(x => x.id === vacId);
    if (!v) return;
    ui.view = 'timeline';
    if (ui.zoom === 'year') ui.zoom = 'month';
    if (v.start.startsWith(String(VS.YEAR))) ui.month = +v.start.slice(5, 7) - 1;
    ui.panelTab = 'vac';
    ui.draft = { empId: v.employeeId, start: v.start, end: v.end, status: VS.statusKey(v.status), vacId: v.id, phase: 'done' };
    VS.render();
  };

  // Показать период на таймлайне
  VS.showOnTimeline = function(iso, empId) {
    ui.view = 'timeline';
    if (ui.zoom === 'year') ui.zoom = 'month';
    if (iso && iso.startsWith(String(VS.YEAR))) ui.month = +iso.slice(5, 7) - 1;
    ui.flashEmp = empId != null ? empId : null;
    if (empId != null && ui.search && !VS.visibleEmployees().some(e => e.id === empId)) ui.search = '';
    VS.render();
    if (empId != null) {
      const row = document.querySelector(`[data-row-emp="${empId}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
      setTimeout(() => { ui.flashEmp = null; const r = document.querySelector(`[data-row-emp="${empId}"]`); if (r) r.classList.remove('flash'); }, 1600);
    }
  };

  VS.deleteVacation = function(vacId) {
    if (!confirm('Удалить отпуск?')) return false;
    data.vacations = data.vacations.filter(v => v.id !== vacId);
    if (ui.draft && ui.draft.vacId === vacId) ui.draft = null;
    if (ui.popVacId === vacId) ui.popVacId = null;
    VS.commit('Отпуск удалён');
    return true;
  };

  // ================== МОДАЛКИ ==================
  VS.openModal = function({ title, body, wide, onMount }) {
    VS.closeModal();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.id = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-label="${esc(title)}">
      <div class="modal-head"><b>${esc(title)}</b><button type="button" class="btn-x" data-modal-close aria-label="Закрыть">×</button></div>
      ${body}</div>`;
    back.addEventListener('mousedown', e => { if (e.target === back) VS.closeModal(); });
    back.addEventListener('click', e => { if (e.target.closest('[data-modal-close]')) VS.closeModal(); });
    document.body.appendChild(back);
    if (onMount) onMount(back.querySelector('.modal'));
    const first = back.querySelector('input, select');
    if (first) first.focus();
    return back;
  };
  VS.closeModal = function() { const m = $('#modal-back'); if (m) m.remove(); };

  // Правила ФИО (из PR #2): пробелы схлопываются, 3–120 символов, только буквы, пробелы, дефисы, апострофы
  const NAME_PATTERN = /^[A-Za-zА-Яа-яЁёІіЇїЄєҐґ'’\- ]+$/;
  const normalizeName = s => String(s || '').replace(/\s+/g, ' ').trim();
  function nameError(name, selfId) {
    if (name.length < 3) return 'ФИО: минимум 3 символа';
    if (name.length > 120) return 'ФИО: максимальная длина 120 символов';
    if (/<|>|&lt;|&gt;|javascript:|on\w+=/i.test(name)) return 'ФИО: недопустимые символы';
    if (!NAME_PATTERN.test(name)) return 'ФИО: используйте только буквы, пробелы и дефисы';
    const lower = name.toLowerCase();
    if (data.employees.some(x => x.id !== selfId && x.name.toLowerCase() === lower)) return 'ФИО: такой сотрудник уже существует';
    return null;
  }

  // Сотрудник: добавить / изменить
  VS.employeeModal = function(empId) {
    const e = empId != null ? VS.emp(empId) : null;
    const groups = data.groups.map(g => `<label><input type="checkbox" value="${g.id}" ${e && g.memberIds.includes(e.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('');
    VS.openModal({
      title: e ? 'Изменить сотрудника' : 'Новый сотрудник',
      body: `<form id="m-emp" class="modal-form" style="display:flex;flex-direction:column;gap:14px" novalidate>
        <div class="field"><span class="field-label">ФИО</span><input class="input" id="m-name" maxlength="120" value="${e ? esc(e.name) : ''}" placeholder="Например, Иванов Иван Иванович"></div>
        <div class="field"><span class="field-label">Отпускных дней в ${VS.YEAR}</span><input class="input mono" id="m-total" type="number" min="1" max="366" value="${e ? e.totalVacationDays : 28}"></div>
        ${data.groups.length ? `<div class="field"><span class="field-label">Группы</span><div class="checklist">${groups}</div></div>` : ''}
        <div class="modal-actions"><button type="submit" class="btn btn-primary btn-lg">Сохранить</button><button type="button" class="btn btn-strong btn-lg" data-modal-close>Отмена</button></div>
      </form>`,
      onMount: m => m.querySelector('form').addEventListener('submit', ev => {
        ev.preventDefault();
        const nameEl = m.querySelector('#m-name'), totalEl = m.querySelector('#m-total');
        const name = normalizeName(nameEl.value), total = Number(totalEl.value);
        const nameErr = nameError(name, e ? e.id : null);
        nameEl.classList.toggle('is-invalid', !!nameErr);
        const okTotal = Number.isInteger(total) && total >= 1 && total <= 366;
        totalEl.classList.toggle('is-invalid', !okTotal);
        if (nameErr) { VS.toast(nameErr, true); return; }
        if (!okTotal) { VS.toast('Отпускные дни: целое число от 1 до 366', true); return; }
        const gids = [...m.querySelectorAll('.checklist input:checked')].map(i => Number(i.value));
        let id;
        if (e) { e.name = name; e.totalVacationDays = total; id = e.id; }
        else { id = VS.newId(); data.employees.push({ id, name, totalVacationDays: total, usedVacationDays: 0 }); }
        data.groups.forEach(g => {
          const has = g.memberIds.includes(id), want = gids.includes(g.id);
          if (want && !has) g.memberIds.push(id);
          if (!want && has) g.memberIds = g.memberIds.filter(x => x !== id);
        });
        VS.closeModal();
        VS.commit(e ? 'Сотрудник обновлён' : 'Сотрудник добавлен');
      })
    });
  };

  VS.confirmDeleteEmployee = function(id) {
    const e = VS.emp(id);
    if (!e || !confirm(`Удалить сотрудника «${e.name}» и все его отпуска?`)) return false;
    VS.deleteEmployee(id);
    if (ui.draft && ui.draft.empId === id) ui.draft = null;
    if (ui.view === 'employee' && ui.employeeId === id) ui.view = 'timeline';
    VS.commit('Сотрудник удалён');
    return true;
  };

  // Несовместимая пара; fixedId — предвыбранный первый сотрудник
  VS.pairModal = function(fixedId) {
    if (data.employees.length < 2) { VS.toast('Нужно минимум два сотрудника', true); return; }
    const opts = sel => data.employees.map(e => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
    VS.openModal({
      title: 'Несовместимая пара',
      body: `<form style="display:flex;flex-direction:column;gap:14px" novalidate>
        <div class="field"><span class="field-label">Сотрудник 1</span><select class="input" id="m-a">${opts(fixedId != null ? fixedId : data.employees[0].id)}</select></div>
        <div class="field"><span class="field-label">Сотрудник 2</span><select class="input" id="m-b"><option value="">— выберите —</option>${opts(null)}</select></div>
        <div class="modal-actions"><button type="submit" class="btn btn-primary btn-lg">Добавить пару</button><button type="button" class="btn btn-strong btn-lg" data-modal-close>Отмена</button></div>
      </form>`,
      onMount: m => {
        if (fixedId != null) m.querySelector('#m-b').focus();
        m.querySelector('form').addEventListener('submit', ev => {
          ev.preventDefault();
          const a = Number(m.querySelector('#m-a').value), b = Number(m.querySelector('#m-b').value);
          if (!a || !b) { VS.toast('Выберите двух сотрудников', true); return; }
          if (a === b) { VS.toast('Нельзя выбрать одного и того же сотрудника', true); return; }
          if (VS.isPair(a, b)) { VS.toast('Такая пара уже существует', true); return; }
          data.pairs.push([a, b]);
          VS.closeModal();
          VS.commit('Пара добавлена');
        });
      }
    });
  };

  VS.removePair = function(a, b) {
    data.pairs = data.pairs.filter(p => !((p[0] === a && p[1] === b) || (p[0] === b && p[1] === a)));
    VS.commit('Пара удалена');
  };

  // Полный отчёт по сотрудникам
  VS.reportModal = function() {
    const rows = data.employees.map(e => {
      const b = VS.balance(e.id);
      const pct = b.total ? Math.round(b.used / b.total * 100) : 0;
      return `<tr><td><a data-act="open-emp" data-id="${e.id}">${esc(e.name)}</a></td><td class="num">${b.total}</td><td class="num">${b.plan}</td><td class="num">${b.used}</td><td class="num ${b.left < 0 ? 'err' : ''}">${b.left}</td><td class="num">${pct}%</td></tr>`;
    }).join('');
    VS.openModal({
      title: 'Отчёт по сотрудникам · ' + VS.YEAR, wide: true,
      body: data.employees.length ? `<table class="report"><thead><tr><th>Сотрудник</th><th class="num">Всего</th><th class="num">В плане</th><th class="num">Использовано</th><th class="num">Остаток</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty-note">Сотрудников пока нет</div>',
      onMount: m => m.addEventListener('click', ev => {
        const a = ev.target.closest('[data-act="open-emp"]');
        if (a) { VS.closeModal(); VS.go('employee', { employeeId: Number(a.dataset.id) }); }
      })
    });
  };

  // ================== МЕНЮ «ДАННЫЕ · CSV» ==================
  VS.closeMenu = () => $('#data-menu').classList.add('hidden');

  const importDone = (msg, isErr) => { if (isErr) VS.toast(msg, true); else { ui.draft = null; VS.commit(msg); } };

  VS.csvAction = function(kind) {
    VS.closeMenu();
    switch (kind) {
      case 'import-employees': $('#file-employees').click(); break;
      case 'import-vacations': $('#file-vacations').click(); break;
      case 'import-holidays': $('#file-holidays').click(); break;
      case 'export-employees': VS.exportEmployeesCsv(); break;
      case 'export-vacations': VS.exportVacationsCsv(); break;
      case 'export-holidays': VS.exportHolidaysCsv(ui.view === 'calendar' ? ui.calYear : VS.YEAR); break;
      case 'clear':
        if (!confirm('Очистить все данные системы отпусков (сотрудники, отпуска, правила, правки календаря)?')) return;
        VS.clearAll(); ui.draft = null; ui.popVacId = null; ui.view = 'timeline';
        VS.render(); VS.toast('Данные очищены');
        break;
    }
  };

  function bindFile(id, fn) {
    $(id).addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) fn(file, importDone);
      e.target.value = '';
    });
  }

  // ================== СОБЫТИЯ ==================
  function bindGlobal() {
    $('#nav').addEventListener('click', e => {
      const b = e.target.closest('[data-nav]');
      if (b) VS.go(b.dataset.nav);
    });
    $('#emp-search').addEventListener('input', e => { ui.search = e.target.value; VS.render(); });
    $('#new-vac-btn').addEventListener('click', () => VS.newVacation(ui.view === 'employee' ? ui.employeeId : null));
    $('#data-menu-btn').addEventListener('click', e => { e.stopPropagation(); $('#data-menu').classList.toggle('hidden'); });
    $('#data-menu').addEventListener('click', e => {
      const b = e.target.closest('[data-csv]');
      if (b) VS.csvAction(b.dataset.csv);
      else if (e.target.closest('a')) VS.closeMenu();
    });
    document.addEventListener('mousedown', e => { if (!e.target.closest('.menu-wrap')) VS.closeMenu(); });
    bindFile('#file-employees', VS.importEmployeesCsv);
    bindFile('#file-vacations', VS.importVacationsCsv);
    bindFile('#file-holidays', VS.importHolidaysCsv);

    // Делегирование действий внутри #view
    const root = $('#view');
    root.addEventListener('click', e => {
      const el = e.target.closest('[data-act]');
      if (el && root.contains(el) && VS.act[el.dataset.act]) { e.preventDefault(); VS.act[el.dataset.act](el, e); }
    });
    root.addEventListener('change', e => {
      const el = e.target.closest('[data-change]');
      if (el && VS.act[el.dataset.change]) VS.act[el.dataset.change](el, e);
    });
    root.addEventListener('input', e => {
      const el = e.target.closest('[data-input]');
      if (el && VS.act[el.dataset.input]) VS.act[el.dataset.input](el, e);
    });
    root.addEventListener('keydown', e => {
      // Enter в поле даты применяет значение
      if (e.key === 'Enter' && e.target.matches('[data-change]')) { e.preventDefault(); e.target.blur(); }
    });

    // Горячие клавиши
    document.addEventListener('keydown', e => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape') {
        if ($('#modal-back')) { VS.closeModal(); return; }
        if (!$('#data-menu').classList.contains('hidden')) { VS.closeMenu(); return; }
        if (typing) { t.blur(); return; }
        if (ui.view === 'timeline' && (ui.popVacId != null || ui.draft)) { ui.popVacId = null; ui.draft = null; VS.render(); }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || $('#modal-back')) return;
      if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') { e.preventDefault(); VS.newVacation(ui.view === 'employee' ? ui.employeeId : null); }
      if (ui.view === 'timeline' && ui.zoom !== 'year' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault(); VS.step(e.key === 'ArrowLeft' ? -1 : 1);
      }
    });
  }

  VS.start = async function() {
    await VS.load();
    bindGlobal();
    VS.render();
  };
})();
